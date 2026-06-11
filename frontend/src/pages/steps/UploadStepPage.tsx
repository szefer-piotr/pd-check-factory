import { useMemo, type ReactNode } from "react";
import { PdfViewer } from "../../components/viewers/PdfViewer";
import { StepPage, type StepTabDef } from "../../components/workflow/StepPage";
import { artifactRawPdfUrl } from "../../services/artifactApi";

interface UploadStepPageProps {
  studyId: string;
  /** The existing upload UI (cards, PD spec import, action tiles) rendered as the body. */
  body: ReactNode;
  protocolUploaded: boolean;
  acrfUploaded: boolean;
  entryMode?: string;
  goNext?: () => void;
  nextLabel?: string;
  tabParam?: string;
}

/** #/upload — drag-and-drop upload cards plus full PdfViewer reference tabs. */
export function UploadStepPage({
  studyId,
  body,
  protocolUploaded,
  acrfUploaded,
  entryMode,
  goNext,
  nextLabel,
  tabParam
}: UploadStepPageProps): JSX.Element {
  const trimmed = studyId.trim();

  const tabs = useMemo<StepTabDef[]>(() => {
    if (!trimmed) {
      return [];
    }
    return [
      {
        id: "protocol-pdf",
        label: "Protocol PDF",
        isArtifact: true,
        render: () =>
          protocolUploaded ? (
            <PdfViewer url={artifactRawPdfUrl(trimmed, "protocol")} />
          ) : (
            <p className="step7-muted">Protocol PDF not uploaded yet.</p>
          )
      },
      {
        id: "acrf-pdf",
        label: "aCRF PDF",
        isArtifact: true,
        render: () =>
          acrfUploaded ? (
            <PdfViewer url={artifactRawPdfUrl(trimmed, "acrf")} />
          ) : (
            <p className="step7-muted">aCRF PDF not uploaded yet.</p>
          )
      }
    ];
  }, [trimmed, protocolUploaded, acrfUploaded]);

  const status = protocolUploaded && acrfUploaded ? "done" : "pending";

  return (
    <StepPage
      title="Upload PDFs"
      description="Upload the protocol and annotated CRF. These original PDFs are the reference everything downstream is compared against."
      status={status}
      statusDetail={
        entryMode === "imported_pd_spec" ? "entry mode: PD-spec import" : "entry mode: extracted"
      }
      hasOutput={protocolUploaded || acrfUploaded}
      controls={body}
      tabs={tabs}
      initialTabId={tabParam}
      onNext={goNext}
      nextLabel={nextLabel}
    />
  );
}
