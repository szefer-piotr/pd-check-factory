"""Azure OpenAI deployment discovery via Azure Resource Manager."""

from __future__ import annotations

import os
from typing import Any, Dict, List
from urllib.parse import urlparse

from pdcheck_factory import blob_io

_CHAT_MODEL_PREFIXES = ("gpt-", "o1", "o3", "o4", "chatgpt-")
_NO_TEMPERATURE_PREFIXES = ("o1", "o3", "o4")


def supports_temperature(model_name: str) -> bool:
    """Return False for reasoning models (o1/o3/o4) that reject temperature."""
    normalized = (model_name or "").strip().lower()
    if not normalized:
        return True
    return not normalized.startswith(_NO_TEMPERATURE_PREFIXES)


def _deployment_entry(*, deployment_id: str, model_name: str, version: str = "") -> Dict[str, Any]:
    return {
        "id": deployment_id,
        "modelName": model_name,
        "version": version,
        "supportsTemperature": supports_temperature(model_name),
    }


def _parse_account_name(endpoint: str) -> str:
    host = urlparse(endpoint.strip()).hostname or ""
    if not host:
        raise ValueError("AZURE_OPENAI_ENDPOINT must include a hostname.")
    return host.split(".", 1)[0]


def _is_chat_deployment(model_name: str) -> bool:
    normalized = (model_name or "").strip().lower()
    if not normalized:
        return False
    if "embedding" in normalized or normalized.startswith("text-embedding"):
        return False
    return normalized.startswith(_CHAT_MODEL_PREFIXES)


def _fallback_deployments(default_deployment: str) -> Dict[str, Any]:
    return {
        "deployments": [_deployment_entry(deployment_id=default_deployment, model_name=default_deployment)],
        "defaultDeployment": default_deployment,
        "source": "fallback",
    }


def list_openai_deployments() -> Dict[str, Any]:
    """List chat-capable Azure OpenAI deployments for the configured resource."""
    default_deployment = blob_io.require_env("AZURE_OPENAI_DEPLOYMENT")
    endpoint = blob_io.require_env("AZURE_OPENAI_ENDPOINT")
    subscription_id = os.getenv("AZURE_SUBSCRIPTION_ID", "").strip()
    resource_group = os.getenv("AZURE_OPENAI_RESOURCE_GROUP", "").strip()

    if not subscription_id or not resource_group:
        print(
            "[azure-openai-config] Missing AZURE_SUBSCRIPTION_ID or AZURE_OPENAI_RESOURCE_GROUP; "
            f"using fallback deployment {default_deployment!r}."
        )
        return _fallback_deployments(default_deployment)

    try:
        account_name = _parse_account_name(endpoint)
    except ValueError as exc:
        print(f"[azure-openai-config] {exc}; using fallback deployment {default_deployment!r}.")
        return _fallback_deployments(default_deployment)

    try:
        from azure.identity import DefaultAzureCredential
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
    except ImportError as exc:
        print(f"[azure-openai-config] Azure management SDK unavailable ({exc}); using fallback.")
        return _fallback_deployments(default_deployment)

    try:
        client = CognitiveServicesManagementClient(DefaultAzureCredential(), subscription_id)
        raw = client.deployments.list(resource_group, account_name)
        deployments: List[Dict[str, str]] = []
        for item in raw:
            model = getattr(getattr(item, "properties", None), "model", None)
            model_name = getattr(model, "name", "") or ""
            if not _is_chat_deployment(model_name):
                continue
            deployments.append(
                _deployment_entry(
                    deployment_id=item.name,
                    model_name=model_name,
                    version=getattr(model, "version", "") or "",
                )
            )
        deployments.sort(key=lambda entry: entry["id"].lower())
        if not deployments:
            print(
                "[azure-openai-config] No chat deployments returned from ARM; "
                f"using fallback deployment {default_deployment!r}."
            )
            return _fallback_deployments(default_deployment)

        known_ids = {entry["id"] for entry in deployments}
        resolved_default = default_deployment if default_deployment in known_ids else deployments[0]["id"]
        return {
            "deployments": deployments,
            "defaultDeployment": resolved_default,
            "source": "azure",
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[azure-openai-config] Failed to list deployments via ARM ({exc}); using fallback.")
        return _fallback_deployments(default_deployment)
