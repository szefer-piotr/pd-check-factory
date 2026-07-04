"""Tests for Azure OpenAI deployment discovery."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from pdcheck_factory import azure_openai_config


def test_parse_account_name_from_endpoint() -> None:
    assert (
        azure_openai_config._parse_account_name("https://azure-openai-pdauto-dev.openai.azure.com/")
        == "azure-openai-pdauto-dev"
    )


def test_is_chat_deployment_filters_embeddings() -> None:
    assert azure_openai_config._is_chat_deployment("gpt-4o") is True
    assert azure_openai_config._is_chat_deployment("text-embedding-3-large") is False


def test_supports_temperature() -> None:
    assert azure_openai_config.supports_temperature("gpt-4o") is True
    assert azure_openai_config.supports_temperature("o4-mini") is False


def test_list_openai_deployments_falls_back_without_arm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
    monkeypatch.delenv("AZURE_SUBSCRIPTION_ID", raising=False)
    monkeypatch.delenv("AZURE_OPENAI_RESOURCE_GROUP", raising=False)

    result = azure_openai_config.list_openai_deployments()

    assert result["source"] == "fallback"
    assert result["defaultDeployment"] == "gpt-4o"
    assert result["deployments"] == [
        {
            "id": "gpt-4o",
            "modelName": "gpt-4o",
            "version": "",
            "supportsTemperature": True,
        }
    ]


def test_list_openai_deployments_from_arm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
    monkeypatch.setenv("AZURE_SUBSCRIPTION_ID", "sub-123")
    monkeypatch.setenv("AZURE_OPENAI_RESOURCE_GROUP", "rg-test")

    class FakeDeployments:
        def list(self, resource_group: str, account_name: str) -> list[Any]:
            assert resource_group == "rg-test"
            assert account_name == "example"
            return [
                SimpleNamespace(
                    name="gpt-4o",
                    properties=SimpleNamespace(
                        model=SimpleNamespace(name="gpt-4o", version="2024-08-06")
                    ),
                ),
                SimpleNamespace(
                    name="embeddings",
                    properties=SimpleNamespace(
                        model=SimpleNamespace(name="text-embedding-3-large", version="1")
                    ),
                ),
                SimpleNamespace(
                    name="gpt-4.1",
                    properties=SimpleNamespace(
                        model=SimpleNamespace(name="gpt-4.1", version="2025-01-01")
                    ),
                ),
            ]

    class FakeClient:
        deployments = FakeDeployments()

    monkeypatch.setattr("azure.identity.DefaultAzureCredential", lambda: object())
    monkeypatch.setattr(
        "azure.mgmt.cognitiveservices.CognitiveServicesManagementClient",
        lambda credential, subscription_id: FakeClient(),
    )

    result = azure_openai_config.list_openai_deployments()

    assert result["source"] == "azure"
    assert result["defaultDeployment"] == "gpt-4o"
    assert [entry["id"] for entry in result["deployments"]] == ["gpt-4.1", "gpt-4o"]
    assert result["deployments"][0]["supportsTemperature"] is True
