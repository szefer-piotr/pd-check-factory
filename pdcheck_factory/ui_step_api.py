from __future__ import annotations

import cgi
import json
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Tuple
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv

from pdcheck_factory.ui_api.service import UiApiError, UiStepService, parse_json_body

_CLIENT_DISCONNECT_ERRORS = (BrokenPipeError, ConnectionResetError)


def _response_payload(*, request_id: str, data: Dict[str, Any] | None = None, error: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return {
        "ok": error is None,
        "requestId": request_id,
        "data": data,
        "error": error,
    }


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")
        handler.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        handler.end_headers()
        handler.wfile.write(body)
    except _CLIENT_DISCONNECT_ERRORS:
        return


def _file_response(
    handler: BaseHTTPRequestHandler,
    *,
    status: int,
    body: bytes,
    content_type: str,
    content_disposition: str,
) -> None:
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Content-Disposition", content_disposition)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")
        handler.send_header("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS")
        handler.end_headers()
        handler.wfile.write(body)
    except _CLIENT_DISCONNECT_ERRORS:
        return


def _inline_response(
    handler: BaseHTTPRequestHandler,
    *,
    body: bytes | None,
    content_type: str,
    content_length: int,
    file_name: str | None = None,
) -> None:
    """Serve content inline (no attachment); body=None sends headers only (HEAD)."""
    try:
        handler.send_response(HTTPStatus.OK)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(content_length))
        if file_name:
            handler.send_header("Content-Disposition", f'inline; filename="{file_name}"')
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")
        handler.send_header("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS")
        handler.end_headers()
        if body is not None:
            handler.wfile.write(body)
    except _CLIENT_DISCONNECT_ERRORS:
        return


class StepApiHandler(BaseHTTPRequestHandler):
    service = UiStepService(output_dir=Path("output"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS")
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            v1 = self._match_v1(parsed.path)
            if v1 is None:
                self.send_response(HTTPStatus.NOT_FOUND)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                return
            study_id, tail = v1
            if tail == "artifacts/text":
                qs = parse_qs(parsed.query)
                artifact = (qs.get("artifact") or [""])[0]
                meta = self.service.get_artifact_meta(study_id, artifact)
                _inline_response(
                    self,
                    body=None,
                    content_type=meta["contentType"],
                    content_length=meta["size"],
                    file_name=meta["fileName"],
                )
                return
            self.send_response(HTTPStatus.NOT_FOUND)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
        except UiApiError as exc:
            try:
                self.send_response(exc.status_code)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            except _CLIENT_DISCONNECT_ERRORS:
                return
        except Exception:  # noqa: BLE001
            try:
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            except _CLIENT_DISCONNECT_ERRORS:
                return

    def do_GET(self) -> None:  # noqa: N802
        request_id = str(uuid.uuid4())
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/api/v1/studies":
                data = self.service.list_studies()
                _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
                return
            if path == "/api/v1/config/openai-deployments":
                data = self.service.list_openai_deployments()
                _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
                return
            if path == "/api/v1/pd-taxonomy":
                data = self.service.get_pd_taxonomy()
                _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
                return

            v1 = self._match_v1(path)
            if v1 is None:
                _json_response(
                    self,
                    HTTPStatus.NOT_FOUND,
                    _response_payload(
                        request_id=request_id,
                        error={"code": "NOT_FOUND", "message": "Not found"},
                    ),
                )
                return

            study_id, tail = v1
            if tail == "artifacts/raw":
                qs = parse_qs(parsed.query)
                doc = (qs.get("doc") or [""])[0]
                pdf = self.service.get_raw_pdf(study_id, doc)
                _inline_response(
                    self,
                    body=pdf["content"],
                    content_type=pdf["contentType"],
                    content_length=len(pdf["content"]),
                    file_name=pdf["fileName"],
                )
                return
            if tail == "artifacts/text":
                qs = parse_qs(parsed.query)
                artifact = (qs.get("artifact") or [""])[0]
                payload = self.service.get_artifact_text(study_id, artifact)
                _inline_response(
                    self,
                    body=payload["content"],
                    content_type=payload["contentType"],
                    content_length=payload["size"],
                    file_name=payload["fileName"],
                )
                return
            if tail == "step1/preview":
                qs = parse_qs(parsed.query)
                full = (qs.get("full") or ["false"])[0].lower() in {"1", "true", "yes"}
                data = self.service.get_step1_preview(study_id, full=full)
            elif tail == "specifications/preview":
                data = self.service.get_specifications_preview(study_id)
            elif tail == "step1/upload-status":
                data = self.service.get_step1_upload_status(study_id)
            elif tail == "step1/run-state":
                data = self.service.get_step1_run_state(study_id)
            elif tail == "steps/status":
                data = self.service.get_status(study_id)
            elif tail == "extraction/live":
                data = self.service.get_extraction_live(study_id)
            elif tail == "import-versions":
                data = self.service.get_import_versions(study_id)
            elif tail == "step-artifact-versions":
                qs = parse_qs(parsed.query)
                step_id = (qs.get("stepId") or [""])[0]
                data = self.service.get_step_artifact_versions(study_id, step_id)
            elif tail == "summary":
                data = self.service.get_study_summary(study_id)
            elif tail == "runs":
                data = self.service.get_study_runs(study_id)
            elif tail == "step7/review-sources":
                data = self.service.get_step7_review_sources(study_id)
            elif tail == "step7/deviations":
                data = self.service.get_step7_deviations(
                    study_id, review_source=self._review_source_from_query()
                )
            elif tail == "step7/deviations/export/coding.csv":
                export_payload = self.service.export_step7_deviations_coding_csv(
                    study_id, review_source=self._review_source_from_query()
                )
                _file_response(
                    self,
                    status=HTTPStatus.OK,
                    body=export_payload["content"],
                    content_type="text/csv; charset=utf-8",
                    content_disposition=f'attachment; filename="{export_payload["fileName"]}"',
                )
                return
            elif tail == "step7/deviations/export/coding":
                export_payload = self.service.export_step7_deviations_coding_xlsx(
                    study_id, review_source=self._review_source_from_query()
                )
                _file_response(
                    self,
                    status=HTTPStatus.OK,
                    body=export_payload["content"],
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    content_disposition=f'attachment; filename="{export_payload["fileName"]}"',
                )
                return
            elif tail == "step7/deviations/export":
                export_payload = self.service.export_step7_deviations_xlsx(
                    study_id, review_source=self._review_source_from_query()
                )
                _file_response(
                    self,
                    status=HTTPStatus.OK,
                    body=export_payload["content"],
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    content_disposition=f'attachment; filename="{export_payload["fileName"]}"',
                )
                return
            elif tail.startswith("step7/deviations/") and tail.endswith("/enrichment"):
                deviation_id = tail[len("step7/deviations/") : -len("/enrichment")]
                data = self.service.get_step7_enrichment_detail(study_id, deviation_id)
            elif tail.startswith("step7/deviations/") and tail.endswith("/chat"):
                deviation_id = tail[len("step7/deviations/") : -len("/chat")]
                data = self.service.get_step7_deviation_chat(study_id, deviation_id)
            elif tail.startswith("steps/") and tail.endswith("/preview"):
                step_id = tail[len("steps/") : -len("/preview")]
                qs = parse_qs(parsed.query)
                version = (qs.get("version") or [""])[0] or None
                data = self.service.get_step_preview(study_id, step_id, version=version)
            else:
                raise UiApiError("NOT_FOUND", "Not found", 404)

            _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
        except UiApiError as exc:
            _json_response(
                self,
                exc.status_code,
                _response_payload(
                    request_id=request_id,
                    error={"code": exc.code, "message": exc.message},
                ),
            )
        except Exception as exc:  # noqa: BLE001
            _json_response(
                self,
                HTTPStatus.INTERNAL_SERVER_ERROR,
                _response_payload(
                    request_id=request_id,
                    error={"code": "INTERNAL_ERROR", "message": str(exc)},
                ),
            )

    def do_POST(self) -> None:  # noqa: N802
        request_id = str(uuid.uuid4())
        try:
            if self.path == "/api/v1/studies":
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0:
                    raise UiApiError("BAD_JSON", "Missing JSON body", 400)
                payload = parse_json_body(self.rfile.read(length))
                study_id = str(payload.get("studyId", "")).strip()
                overwrite = payload.get("overwrite") is True
                data = self.service.create_study(study_id, overwrite=overwrite)
                _json_response(self, HTTPStatus.CREATED, _response_payload(request_id=request_id, data=data))
                return

            v1 = self._match_v1(self.path)
            if v1 is None:
                raise UiApiError("NOT_FOUND", "Not found", 404)

            study_id, tail = v1
            if tail == "sync":
                data = self.service.sync_study(study_id)
            elif tail == "load":
                data = self.service.load_study(study_id)
            elif tail == "reset":
                data = self.service.reset_study(study_id)
            elif tail == "step1/upload":
                data = self._parse_step1_upload(study_id)
            elif tail == "step1/extract":
                data = self._parse_step1_extract(study_id)
            elif tail == "upload-pd-spec":
                data = self._parse_upload_pd_spec(study_id)
            elif tail == "preprocess/protocol":
                data = self.service.preprocess_protocol(study_id)
            elif tail == "preprocess/acrf":
                data = self.service.preprocess_acrf(study_id)
            elif tail == "active-deviations-source":
                data = self._parse_active_deviations_source(study_id)
            elif tail == "active-step-artifact":
                data = self._parse_active_step_artifact(study_id)
            elif tail.startswith("step7/deviations/") and tail.endswith("/refine"):
                deviation_id = tail[len("step7/deviations/") : -len("/refine")]
                data = self._parse_step7_refine(study_id, deviation_id)
            elif tail == "step7/deviations/import":
                data = self._parse_step7_deviation_import(study_id)
            elif tail == "step7/deviations":
                data = self._parse_step7_deviation_create(study_id)
            elif tail == "step7/rules":
                data = self._parse_step7_rule_create(study_id)
            elif tail == "coding/accept":
                data = self.service.accept_coding_phase(study_id)
            elif tail == "step7/review-sources/select":
                data = self._parse_step7_review_source_select(study_id)
            elif tail == "step7/deviations/accept-all":
                data = self.service.accept_step7_deviations_bulk(
                    study_id, review_source=self._review_source_from_json_body()
                )
            elif tail == "step7/pseudo-logic/generate-all":
                data = self.service.generate_step7_pseudo_logic_bulk(
                    study_id, review_source=self._review_source_from_json_body()
                )
            elif tail.startswith("step7/deviations/") and tail.endswith("/pseudo-logic"):
                deviation_id = tail[len("step7/deviations/") : -len("/pseudo-logic")]
                data = self.service.generate_step7_pseudo_logic_for_deviation(
                    study_id,
                    deviation_id,
                    review_source=self._review_source_from_json_body(),
                )
            elif tail == "runs/apply":
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0:
                    raise UiApiError("BAD_JSON", "Missing JSON body", 400)
                payload = parse_json_body(self.rfile.read(length))
                data = self.service.apply_study_run(study_id, payload)
            elif tail.startswith("steps/") and tail.endswith("/run"):
                step_id = tail[len("steps/") : -len("/run")]
                length = int(self.headers.get("Content-Length", "0"))
                llm_instructions: str | None = None
                llm_deployment: str | None = None
                force = False
                if length > 0:
                    payload = parse_json_body(self.rfile.read(length))
                    llm_instructions = str(payload.get("llmInstructions", "") or "")
                    llm_deployment = str(payload.get("llmDeployment", "") or "") or None
                    force = bool(payload.get("force", False))
                data = self.service.run_step(
                    study_id,
                    step_id,
                    llm_instructions=llm_instructions,
                    llm_deployment=llm_deployment,
                    force=force,
                )
            else:
                raise UiApiError("NOT_FOUND", "Not found", 404)

            _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
        except UiApiError as exc:
            _json_response(
                self,
                exc.status_code,
                _response_payload(
                    request_id=request_id,
                    error={"code": exc.code, "message": exc.message},
                ),
            )
        except Exception as exc:  # noqa: BLE001
            _json_response(
                self,
                HTTPStatus.INTERNAL_SERVER_ERROR,
                _response_payload(
                    request_id=request_id,
                    error={"code": "INTERNAL_ERROR", "message": str(exc)},
                ),
            )

    def do_PATCH(self) -> None:  # noqa: N802
        request_id = str(uuid.uuid4())
        try:
            v1 = self._match_v1(self.path)
            if v1 is None:
                raise UiApiError("NOT_FOUND", "Not found", 404)
            study_id, tail = v1
            if tail == "manifest":
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0:
                    raise UiApiError("BAD_JSON", "Missing JSON body", 400)
                payload = parse_json_body(self.rfile.read(length))
                data = self.service.patch_study_manifest(study_id, payload)
            elif tail.startswith("step7/deviations/"):
                deviation_id = tail[len("step7/deviations/") :]
                data = self._parse_step7_status_patch(study_id, deviation_id)
            elif tail.startswith("step7/rules/"):
                rule_id = tail[len("step7/rules/") :]
                data = self._parse_step7_rule_patch(study_id, rule_id)
            elif tail.startswith("runs/") and tail.endswith("/activate"):
                run_id = tail[len("runs/") : -len("/activate")]
                data = self.service.activate_study_run(study_id, run_id)
            else:
                raise UiApiError("NOT_FOUND", "Not found", 404)
            _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
        except UiApiError as exc:
            _json_response(
                self,
                exc.status_code,
                _response_payload(
                    request_id=request_id,
                    error={"code": exc.code, "message": exc.message},
                ),
            )
        except Exception as exc:  # noqa: BLE001
            _json_response(
                self,
                HTTPStatus.INTERNAL_SERVER_ERROR,
                _response_payload(
                    request_id=request_id,
                    error={"code": "INTERNAL_ERROR", "message": str(exc)},
                ),
            )

    def do_DELETE(self) -> None:  # noqa: N802
        request_id = str(uuid.uuid4())
        try:
            if self.path == "/api/v1/studies":
                data = self.service.delete_all_studies()
                _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
                return

            v1 = self._match_v1(self.path)
            if v1 is None:
                raise UiApiError("NOT_FOUND", "Not found", 404)
            study_id, tail = v1
            if tail == "":
                data = self.service.delete_study(study_id)
            elif tail.startswith("step7/deviations/"):
                deviation_id = tail[len("step7/deviations/") :]
                data = self.service.delete_step7_deviation(
                    study_id, deviation_id, review_source=self._review_source_from_query()
                )
            elif tail.startswith("step7/rules/"):
                rule_id = tail[len("step7/rules/") :]
                data = self.service.delete_step7_rule(study_id, rule_id)
            else:
                raise UiApiError("NOT_FOUND", "Not found", 404)
            _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
        except UiApiError as exc:
            _json_response(
                self,
                exc.status_code,
                _response_payload(
                    request_id=request_id,
                    error={"code": exc.code, "message": exc.message},
                ),
            )
        except Exception as exc:  # noqa: BLE001
            _json_response(
                self,
                HTTPStatus.INTERNAL_SERVER_ERROR,
                _response_payload(
                    request_id=request_id,
                    error={"code": "INTERNAL_ERROR", "message": str(exc)},
                ),
            )

    def _parse_step1_upload(self, study_id: str) -> Dict[str, Any]:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            raise UiApiError("VALIDATION_ERROR", "Content-Type must be multipart/form-data", 400)

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )
        protocol_item = form["protocolFile"] if "protocolFile" in form else None
        acrf_item = form["acrfFile"] if "acrfFile" in form else None
        if protocol_item is None and acrf_item is None:
            raise UiApiError(
                "VALIDATION_ERROR",
                "At least one of protocolFile or acrfFile is required",
                400,
            )

        protocol_bytes = protocol_item.file.read() if protocol_item is not None else None
        acrf_bytes = acrf_item.file.read() if acrf_item is not None else None
        protocol_name = getattr(protocol_item, "filename", None) if protocol_item is not None else None
        acrf_name = getattr(acrf_item, "filename", None) if acrf_item is not None else None
        return self.service.upload_step1_files(
            study_id,
            protocol_bytes,
            acrf_bytes,
            protocol_file_name=protocol_name,
            acrf_file_name=acrf_name,
        )

    def _parse_step1_extract(self, study_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            payload: Dict[str, Any] = {}
        else:
            payload = parse_json_body(self.rfile.read(length))
        extractor = str(payload.get("extractor", "")).strip() or None
        force = bool(payload.get("force", False))
        return self.service.run_step1_extract(study_id, extractor=extractor, force=force)

    def _review_source_from_query(self) -> str | None:
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        value = (qs.get("reviewSource") or qs.get("review_source") or [None])[0]
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _review_source_from_json_body(self) -> str | None:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return self._review_source_from_query()
        payload = parse_json_body(self.rfile.read(length))
        value = payload.get("reviewSource") or payload.get("review_source")
        if value is not None:
            text = str(value).strip()
            return text or None
        return self._review_source_from_query()

    def _parse_step7_review_source_select(self, study_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        review_source = str(payload.get("reviewSource") or payload.get("review_source") or "").strip()
        if not review_source:
            raise UiApiError("VALIDATION_ERROR", "reviewSource is required", 400)
        return self.service.set_step7_review_display_source(study_id, review_source)

    def _parse_step7_refine(self, study_id: str, deviation_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        review_source = str(payload.get("reviewSource") or payload.get("review_source") or "").strip() or None
        llm_deployment = str(payload.get("llmDeployment", "") or "") or None
        return self.service.refine_step7_deviation(
            study_id=study_id,
            deviation_id=deviation_id,
            dm_comment=str(payload.get("message", "")),
            run_revision_cycle=bool(payload.get("runRevisionCycle", True)),
            also_generate_pseudo=bool(payload.get("alsoPseudo", False)),
            review_source=review_source,
            llm_deployment=llm_deployment,
        )

    def _parse_step7_deviation_create(self, study_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        review_source = str(payload.get("reviewSource") or payload.get("review_source") or "").strip() or None
        return self.service.create_step7_deviation(study_id, payload, review_source=review_source)

    def _parse_step7_deviation_import(self, study_id: str) -> Dict[str, Any]:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            raise UiApiError("VALIDATION_ERROR", "Content-Type must be multipart/form-data", 400)
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )
        workbook_item = form["workbook"] if "workbook" in form else None
        if workbook_item is None:
            raise UiApiError("VALIDATION_ERROR", "workbook is required", 400)
        review_source = self._review_source_from_query()
        return self.service.import_step7_deviations_xlsx(
            study_id, workbook_item.file.read(), review_source=review_source
        )

    def _parse_step7_rule_create(self, study_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        return self.service.create_step7_rule(study_id, payload)

    def _parse_step7_rule_patch(self, study_id: str, rule_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        return self.service.update_step7_rule(study_id, rule_id, payload)

    def _parse_step7_status_patch(self, study_id: str, deviation_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        review_source = str(payload.get("reviewSource") or payload.get("review_source") or "").strip() or None
        if "status" in payload and not any(
            key in payload
            for key in ("text", "deviation_text", "deviationText", "rule_id", "ruleId", "paragraph_refs", "paragraphRefs")
        ):
            dm_comment: str | None = None
            if "dm_comment" in payload or "dmComment" in payload:
                dm_comment = str(payload.get("dm_comment") or payload.get("dmComment") or "")
            return self.service.update_step7_deviation(
                study_id=study_id,
                deviation_id=deviation_id,
                status=str(payload.get("status", "")),
                dm_comment=dm_comment,
                review_source=review_source,
            )
        return self.service.patch_step7_deviation_fields(
            study_id, deviation_id, payload, review_source=review_source
        )

    def _parse_upload_pd_spec(self, study_id: str) -> Dict[str, Any]:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            raise UiApiError("VALIDATION_ERROR", "Content-Type must be multipart/form-data", 400)
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )
        workbook_item = form["workbook"] if "workbook" in form else None
        if workbook_item is None:
            workbook_item = form["pdSpecFile"] if "pdSpecFile" in form else None
        if workbook_item is None:
            raise UiApiError("VALIDATION_ERROR", "workbook or pdSpecFile is required", 400)
        file_name = getattr(workbook_item, "filename", None)
        return self.service.upload_pd_spec_workbook(
            study_id,
            workbook_item.file.read(),
            file_name=file_name,
        )

    def _parse_entry_mode(self, study_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        return self.service.set_study_entry_mode(study_id, str(payload.get("entryMode", "")))

    def _parse_active_deviations_source(self, study_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        return self.service.set_active_deviations_source(
            study_id,
            str(payload.get("activeDeviationsSource", "")),
        )

    def _parse_active_step_artifact(self, study_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        return self.service.set_active_step_artifact(
            study_id,
            str(payload.get("stepId", "")),
            str(payload.get("version", "")),
        )

    def _match_v1(self, path: str) -> Tuple[str, str] | None:
        prefix = "/api/v1/studies/"
        if not path.startswith(prefix):
            return None
        rest = path[len(prefix) :].strip("/")
        if not rest:
            return None
        if "/" in rest:
            study_id, tail = rest.split("/", 1)
        else:
            study_id, tail = rest, ""
        if not study_id:
            return None
        return study_id, tail

    def log_message(self, format: str, *args: Any) -> None:
        return


def run_step_api(*, host: str, port: int, output_dir: Path) -> None:
    project_root = Path(__file__).resolve().parents[1]
    load_dotenv(project_root / ".env")
    StepApiHandler.service = UiStepService(output_dir=output_dir)
    server = ThreadingHTTPServer((host, port), StepApiHandler)
    print(f"Step API listening on http://{host}:{port}")
    server.serve_forever()
