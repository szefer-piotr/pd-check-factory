import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LlmDeploymentSelect } from "../components/ui/LlmDeploymentSelect";
import { UploadRail } from "../components/workflow/UploadRail";
import { Section } from "../components/layout/Section";
import { useStudyContext } from "../hooks/useStudyContext";
import { useStudyPipelineState } from "../hooks/useStudyPipelineState";
import { useStudySettings } from "../hooks/useStudySettings";
import {
  fetchOpenAiDeployments,
  preprocessAcrf,
  preprocessProtocol,
  uploadPdSpecWorkbook,
  uploadStep1File,
  type OpenAiDeploymentOption,
  type Step1DocumentExtractor
} from "../services/stepApi";

function uploadsReady(
  workflow: string | null | undefined,
  bothUploaded: boolean,
  pdSpecUploaded: boolean
): boolean {
  if (workflow === "map") {
    return pdSpecUploaded;
  }
  if (workflow === "enrich") {
    return bothUploaded && pdSpecUploaded;
  }
  return bothUploaded;
}

export function SetupPage(): JSX.Element {
  const { studyId, summary, refresh } = useStudyContext();
  const navigate = useNavigate();
  const workflow = summary?.workflow ?? null;
  const [deployments, setDeployments] = useState<OpenAiDeploymentOption[]>([]);
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);
  const { settings, updateSettings } = useStudySettings(studyId);
  const [pendingProtocolFile, setPendingProtocolFile] = useState<File | null>(null);
  const [pendingAcrfFile, setPendingAcrfFile] = useState<File | null>(null);
  const [pendingPdSpecFile, setPendingPdSpecFile] = useState<File | null>(null);
  const preprocessPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onStatusesChange = useCallback(() => {
    void refresh();
  }, [refresh]);

  const pipelineState = useStudyPipelineState(studyId, onStatusesChange);
  const {
    pipeline,
    setUploadSlot,
    setPreprocess,
    refreshUploadStatus,
    refreshRunState,
    isLoadingUploadStatus,
    uploadStatusError
  } = pipelineState;

  useEffect(() => {
    async function loadDeployments(): Promise<void> {
      setIsLoadingDeployments(true);
      try {
        const response = await fetchOpenAiDeployments();
        setDeployments(response.deployments);
        const patch: Partial<typeof settings> = {};
        if (!settings.extractionDeployment && response.defaultDeployment) {
          patch.extractionDeployment = response.defaultDeployment;
        }
        if (!settings.acrfSummaryDeployment && response.defaultDeployment) {
          patch.acrfSummaryDeployment = response.defaultDeployment;
        }
        if (Object.keys(patch).length > 0) {
          updateSettings(patch);
        }
      } catch {
        setDeployments([]);
      } finally {
        setIsLoadingDeployments(false);
      }
    }
    void loadDeployments();
  }, [settings.extractionDeployment, settings.acrfSummaryDeployment, updateSettings]);

  useEffect(() => {
    const needsPoll =
      pipeline.preprocess.protocol === "running" || pipeline.preprocess.acrf === "running";
    if (!needsPoll || !studyId.trim()) {
      if (preprocessPollRef.current) {
        clearInterval(preprocessPollRef.current);
        preprocessPollRef.current = null;
      }
      return;
    }
    preprocessPollRef.current = setInterval(() => {
      void refreshUploadStatus(undefined, { silent: true });
      void refreshRunState();
    }, 3000);
    return () => {
      if (preprocessPollRef.current) {
        clearInterval(preprocessPollRef.current);
        preprocessPollRef.current = null;
      }
    };
  }, [
    pipeline.preprocess.protocol,
    pipeline.preprocess.acrf,
    refreshUploadStatus,
    refreshRunState,
    studyId
  ]);

  const triggerBackgroundPreprocess = useCallback(
    (slot: "protocol" | "acrf") => {
      const trimmed = studyId.trim();
      if (!trimmed) {
        return;
      }
      setPreprocess(slot, "running");
      const run = slot === "protocol" ? preprocessProtocol : preprocessAcrf;
      void run(trimmed)
        .then(() => {
          setPreprocess(slot, "done");
          void refreshUploadStatus(trimmed);
          void refresh();
        })
        .catch(() => {
          setPreprocess(slot, "failed");
          void refreshUploadStatus(trimmed);
        });
    },
    [refresh, refreshUploadStatus, setPreprocess, studyId]
  );

  async function handleUploadSlot(slot: "protocol" | "acrf", file: File): Promise<void> {
    const trimmedStudyId = studyId.trim();
    if (!trimmedStudyId) {
      return;
    }
    if (slot === "protocol") {
      setPendingProtocolFile(file);
    } else {
      setPendingAcrfFile(file);
    }
    setUploadSlot(slot, {
      status: "uploading",
      originalFileName: file.name,
      sizeBytes: file.size
    });
    try {
      await uploadStep1File(trimmedStudyId, slot, file);
      await refreshUploadStatus(trimmedStudyId);
      await refresh();
      if (slot === "protocol") {
        setPendingProtocolFile(null);
      } else {
        setPendingAcrfFile(null);
      }
      triggerBackgroundPreprocess(slot);
    } catch (uploadError) {
      setUploadSlot(slot, {
        status: "error",
        originalFileName: file.name,
        sizeBytes: file.size,
        error: uploadError instanceof Error ? uploadError.message : "Upload failed."
      });
    }
  }

  async function handleUploadPdSpec(file: File): Promise<void> {
    const trimmedStudyId = studyId.trim();
    if (!trimmedStudyId) {
      return;
    }
    setPendingPdSpecFile(file);
    setUploadSlot("pdSpec", {
      status: "uploading",
      originalFileName: file.name,
      sizeBytes: file.size
    });
    try {
      await uploadPdSpecWorkbook(trimmedStudyId, file);
      await refreshUploadStatus(trimmedStudyId);
      await refresh();
      setPendingPdSpecFile(null);
    } catch (uploadError) {
      setUploadSlot("pdSpec", {
        status: "error",
        originalFileName: file.name,
        sizeBytes: file.size,
        error: uploadError instanceof Error ? uploadError.message : "Upload failed."
      });
    }
  }

  const showProtocol = workflow !== "map";
  const showAcrf = workflow !== "map";
  const showPdSpec = workflow === "enrich" || workflow === "map";

  const protocolSlot =
    pendingProtocolFile && pipeline.uploads.protocol.status !== "uploaded"
      ? {
          status: "selected" as const,
          originalFileName: pendingProtocolFile.name,
          sizeBytes: pendingProtocolFile.size
        }
      : pipeline.uploads.protocol;
  const acrfSlot =
    pendingAcrfFile && pipeline.uploads.acrf.status !== "uploaded"
      ? {
          status: "selected" as const,
          originalFileName: pendingAcrfFile.name,
          sizeBytes: pendingAcrfFile.size
        }
      : pipeline.uploads.acrf;
  const pdSpecSlot =
    pendingPdSpecFile && pipeline.uploads.pdSpec.status !== "uploaded"
      ? {
          status: "selected" as const,
          originalFileName: pendingPdSpecFile.name,
          sizeBytes: pendingPdSpecFile.size
        }
      : pipeline.uploads.pdSpec;

  const canContinue = uploadsReady(
    workflow,
    pipeline.bothUploaded,
    pipeline.uploads.pdSpec.status === "uploaded"
  );

  const documentExtractorOptions: Array<{ value: Step1DocumentExtractor; label: string }> = [
    { value: "opendataloader", label: "OpenDataLoader" },
    { value: "document_intelligence", label: "Document Intelligence" }
  ];

  return (
    <Section className="workflow-panel">
      <h2 className="page-title">Setup</h2>
      <p className="page-lead">Configure extraction settings and upload source documents.</p>

      <div className="setup-grid">
        <LlmDeploymentSelect
          id="setup-extraction-deployment"
          label="Extraction LLM deployment"
          value={settings.extractionDeployment}
          deployments={deployments}
          isLoading={isLoadingDeployments}
          onChange={(value) => updateSettings({ extractionDeployment: value })}
        />
        {workflow !== "map" ? (
          <LlmDeploymentSelect
            id="setup-acrf-deployment"
            label="aCRF summary LLM deployment"
            value={settings.acrfSummaryDeployment}
            deployments={deployments}
            isLoading={isLoadingDeployments}
            onChange={(value) => updateSettings({ acrfSummaryDeployment: value })}
          />
        ) : null}
        {workflow !== "map" ? (
          <>
            <label className="control-group" htmlFor="setup-protocol-extractor">
              <span className="control-label">Protocol OCR</span>
              <select
                id="setup-protocol-extractor"
                className="select"
                value={settings.protocolExtractor}
                onChange={(event) =>
                  updateSettings({ protocolExtractor: event.target.value as Step1DocumentExtractor })
                }
              >
                {documentExtractorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-group" htmlFor="setup-acrf-extractor">
              <span className="control-label">aCRF OCR</span>
              <select
                id="setup-acrf-extractor"
                className="select"
                value={settings.acrfExtractor}
                onChange={(event) =>
                  updateSettings({ acrfExtractor: event.target.value as Step1DocumentExtractor })
                }
              >
                {documentExtractorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>

      <UploadRail
        studySelected={Boolean(studyId.trim())}
        isLoadingUploadStatus={isLoadingUploadStatus}
        uploadStatusError={uploadStatusError}
        slots={[
          ...(showProtocol
            ? [
                {
                  id: "protocol" as const,
                  label: "Protocol PDF",
                  shortLabel: "Protocol",
                  inputId: "setup-protocol-upload",
                  slot: protocolSlot,
                  accept: ".pdf,application/pdf",
                  onFileSelected: (file: File) => void handleUploadSlot("protocol", file)
                }
              ]
            : []),
          ...(showAcrf
            ? [
                {
                  id: "acrf" as const,
                  label: "aCRF PDF",
                  shortLabel: "aCRF",
                  inputId: "setup-acrf-upload",
                  slot: acrfSlot,
                  accept: ".pdf,application/pdf",
                  onFileSelected: (file: File) => void handleUploadSlot("acrf", file)
                }
              ]
            : []),
          ...(showPdSpec
            ? [
                {
                  id: "pdSpec" as const,
                  label: "PD Spec XLSX",
                  shortLabel: "PD Spec",
                  inputId: "setup-pdspec-upload",
                  slot: pdSpecSlot,
                  accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  chooseLabel: "Choose workbook",
                  onFileSelected: (file: File) => void handleUploadPdSpec(file)
                }
              ]
            : [])
        ]}
      />

      <div className="setup-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={!canContinue}
          onClick={() => navigate(`/projects/${encodeURIComponent(studyId)}/summary`)}
        >
          Continue to summary
        </button>
      </div>
    </Section>
  );
}
