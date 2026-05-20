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


def _response_payload(*, request_id: str, data: Dict[str, Any] | None = None, error: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return {
        "ok": error is None,
        "requestId": request_id,
        "data": data,
        "error": error,
    }


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def _file_response(
    handler: BaseHTTPRequestHandler,
    *,
    status: int,
    body: bytes,
    content_type: str,
    content_disposition: str,
) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Content-Disposition", content_disposition)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


class StepApiHandler(BaseHTTPRequestHandler):
    service = UiStepService(output_dir=Path("output"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        request_id = str(uuid.uuid4())
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path.startswith("/api/step1/preview"):
                qs = parse_qs(parsed.query)
                study_id = (qs.get("studyId") or [""])[0]
                data = self.service.get_step1_preview(study_id)
                _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
                return
            if path == "/api/v1/studies":
                data = self.service.list_studies()
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
            if tail == "step1/preview":
                data = self.service.get_step1_preview(study_id)
            elif tail == "step1/upload-status":
                data = self.service.get_step1_upload_status(study_id)
            elif tail == "step1/run-state":
                data = self.service.get_step1_run_state(study_id)
            elif tail == "steps/status":
                data = self.service.get_status(study_id)
            elif tail == "step7/deviations":
                data = self.service.get_step7_deviations(study_id)
            elif tail == "step7/deviations/export":
                export_payload = self.service.export_step7_deviations_xlsx(study_id)
                _file_response(
                    self,
                    status=HTTPStatus.OK,
                    body=export_payload["content"],
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    content_disposition=f'attachment; filename="{export_payload["fileName"]}"',
                )
                return
            elif tail.startswith("step7/deviations/") and tail.endswith("/chat"):
                deviation_id = tail[len("step7/deviations/") : -len("/chat")]
                data = self.service.get_step7_deviation_chat(study_id, deviation_id)
            elif tail.startswith("steps/") and tail.endswith("/preview"):
                step_id = tail[len("steps/") : -len("/preview")]
                data = self.service.get_step_preview(study_id, step_id)
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
            if self.path == "/api/step1/upload":
                data = self._legacy_upload()
                _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
                return
            if self.path == "/api/step1/extract":
                data = self._legacy_extract()
                _json_response(self, HTTPStatus.OK, _response_payload(request_id=request_id, data=data))
                return

            v1 = self._match_v1(self.path)
            if v1 is None:
                raise UiApiError("NOT_FOUND", "Not found", 404)

            study_id, tail = v1
            if tail == "sync":
                data = self.service.sync_study(study_id)
            elif tail == "step1/upload":
                data = self._parse_step1_upload(study_id)
            elif tail == "step1/extract":
                data = self._parse_step1_extract(study_id)
            elif tail.startswith("step7/deviations/") and tail.endswith("/refine"):
                deviation_id = tail[len("step7/deviations/") : -len("/refine")]
                data = self._parse_step7_refine(study_id, deviation_id)
            elif tail == "step7/deviations/import":
                data = self._parse_step7_deviation_import(study_id)
            elif tail == "step7/deviations":
                data = self._parse_step7_deviation_create(study_id)
            elif tail == "step7/rules":
                data = self._parse_step7_rule_create(study_id)
            elif tail == "step7/deviations/accept-all":
                data = self.service.accept_step7_deviations_bulk(study_id)
            elif tail == "step7/pseudo-logic/generate-all":
                data = self.service.generate_step7_pseudo_logic_bulk(study_id)
            elif tail.startswith("step7/deviations/") and tail.endswith("/pseudo-logic"):
                deviation_id = tail[len("step7/deviations/") : -len("/pseudo-logic")]
                data = self.service.generate_step7_pseudo_logic_for_deviation(study_id, deviation_id)
            elif tail.startswith("steps/") and tail.endswith("/run"):
                step_id = tail[len("steps/") : -len("/run")]
                length = int(self.headers.get("Content-Length", "0"))
                llm_instructions: str | None = None
                if length > 0:
                    payload = parse_json_body(self.rfile.read(length))
                    llm_instructions = str(payload.get("llmInstructions", "") or "")
                data = self.service.run_step(study_id, step_id, llm_instructions=llm_instructions)
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
            if tail.startswith("step7/deviations/"):
                deviation_id = tail[len("step7/deviations/") :]
                data = self._parse_step7_status_patch(study_id, deviation_id)
            elif tail.startswith("step7/rules/"):
                rule_id = tail[len("step7/rules/") :]
                data = self._parse_step7_rule_patch(study_id, rule_id)
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
            v1 = self._match_v1(self.path)
            if v1 is None:
                raise UiApiError("NOT_FOUND", "Not found", 404)
            study_id, tail = v1
            if tail == "":
                data = self.service.delete_study(study_id)
            elif tail.startswith("step7/deviations/"):
                deviation_id = tail[len("step7/deviations/") :]
                data = self.service.delete_step7_deviation(study_id, deviation_id)
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

    def _legacy_upload(self) -> Dict[str, Any]:
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            },
        )
        study_id = str(form.getvalue("studyId") or "")
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

    def _legacy_extract(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        study_id = str(payload.get("studyId") or "")
        extractor = str(payload.get("extractor", "")).strip() or None
        return self.service.run_step1_extract(study_id, extractor=extractor)

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
        return self.service.run_step1_extract(study_id, extractor=extractor)

    def _parse_step7_refine(self, study_id: str, deviation_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        return self.service.refine_step7_deviation(
            study_id=study_id,
            deviation_id=deviation_id,
            dm_comment=str(payload.get("message", "")),
            run_revision_cycle=bool(payload.get("runRevisionCycle", True)),
            also_generate_pseudo=bool(payload.get("alsoPseudo", False)),
        )

    def _parse_step7_deviation_create(self, study_id: str) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise UiApiError("BAD_JSON", "Missing JSON body", 400)
        payload = parse_json_body(self.rfile.read(length))
        return self.service.create_step7_deviation(study_id, payload)

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
        return self.service.import_step7_deviations_xlsx(study_id, workbook_item.file.read())

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
        return self.service.patch_step7_deviation_fields(study_id, deviation_id, payload)

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
    load_dotenv()
    StepApiHandler.service = UiStepService(output_dir=output_dir)
    server = ThreadingHTTPServer((host, port), StepApiHandler)
    print(f"Step API listening on http://{host}:{port}")
    server.serve_forever()
