import { useEffect, useMemo, useState } from "react";
import { JsonViewer } from "../../components/viewers/JsonViewer";
import { MarkdownViewer } from "../../components/viewers/MarkdownViewer";
import { PdfViewer } from "../../components/viewers/PdfViewer";
import { StepPage, type StepTabDef } from "../../components/workflow/StepPage";
import {
  acrfSectionFileName,
  artifactRawPdfUrl,
  fetchArtifactJson,
  type AcrfSectionEntry,
  type AcrfSectionsManifestJson,
  type ArtifactKey
} from "../../services/artifactApi";
import { countDetail, dependencyInfos, stepNavStatus, type WorkflowStepPageContext } from "./common";

/** #/acrf-split-toc — master–detail section browser over the aCRF TOC split. */
export function AcrfSplitTocStepPage(props: WorkflowStepPageContext): JSX.Element {
  const {
    studyId,
    stepInfo,
    backendStatuses,
    isStepRunning,
    runError,
    onRun,
    goPrev,
    goNext,
    prevLabel,
    nextLabel,
    tabParam
  } = props;
  const trimmed = studyId.trim();
  const hasOutput = stepInfo?.status === "done";
  const status = stepNavStatus(stepInfo, isStepRunning, Boolean(runError));

  const [sections, setSections] = useState<AcrfSectionEntry[] | null>(null);
  const [manifestMissing, setManifestMissing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pdfPage, setPdfPage] = useState<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setSections(null);
    setManifestMissing(false);
    setSelectedIndex(0);
    if (!trimmed || !hasOutput) {
      return;
    }
    fetchArtifactJson<AcrfSectionsManifestJson>(trimmed, "acrf-sections-manifest")
      .then((manifest) => {
        if (!cancelled) {
          setSections(manifest.sections ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManifestMissing(true);
          setSections([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, hasOutput]);

  const selectedSection = sections?.[selectedIndex];

  const tabs = useMemo<StepTabDef[]>(() => {
    if (!trimmed) {
      return [];
    }
    return [
      {
        id: "sections",
        label: "Sections",
        isArtifact: true,
        render: () => {
          if (sections === null) {
            return <p className="step1-status">Loading sections…</p>;
          }
          if (sections.length === 0) {
            return (
              <p className="step7-muted">
                {manifestMissing
                  ? "No sections manifest found — the split may predate manifests. Re-run this step to regenerate it."
                  : "No sections were produced by the TOC split."}
              </p>
            );
          }
          return (
            <div className="master-detail">
              <nav className="master-detail-list" aria-label="aCRF sections">
                {sections.map((section, index) => (
                  <button
                    key={`${section.code}-${section.toc_page}-${index}`}
                    type="button"
                    className={`master-detail-item ${index === selectedIndex ? "master-detail-item-active" : ""}`}
                    onClick={() => setSelectedIndex(index)}
                  >
                    <span className="master-detail-item-title">
                      {section.code ? `${section.code} — ` : ""}
                      {section.name}
                    </span>
                    <span className="step7-muted">p. {section.toc_page}</span>
                  </button>
                ))}
              </nav>
              <div className="master-detail-content">
                {selectedSection ? (
                  <>
                    <div className="master-detail-content-header">
                      <strong>
                        {selectedSection.code ? `${selectedSection.code} — ` : ""}
                        {selectedSection.name}
                      </strong>
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => setPdfPage(selectedSection.toc_page)}
                        title="Open the aCRF PDF at this section's page"
                      >
                        View in PDF (p. {selectedSection.toc_page})
                      </button>
                    </div>
                    <MarkdownViewer
                      key={acrfSectionFileName(selectedSection)}
                      studyId={trimmed}
                      artifact={`acrf-section:${acrfSectionFileName(selectedSection)}` as ArtifactKey}
                      showOutline={false}
                      emptyMessage="Section markdown file not found."
                    />
                  </>
                ) : (
                  <p className="step7-muted">Select a section.</p>
                )}
              </div>
            </div>
          );
        }
      },
      {
        id: "manifest",
        label: "sections_manifest.json",
        isArtifact: true,
        render: () => (
          <JsonViewer studyId={trimmed} artifact="acrf-sections-manifest" emptyMessage="Manifest not generated yet." />
        )
      },
      {
        id: "full-acrf-md",
        label: "Full aCRF markdown",
        isArtifact: true,
        render: () => <MarkdownViewer studyId={trimmed} artifact="acrf-md" />
      },
      {
        id: "acrf-pdf",
        label: "aCRF PDF",
        render: () => <PdfViewer url={artifactRawPdfUrl(trimmed, "acrf")} initialPage={pdfPage} />
      }
    ];
  }, [trimmed, sections, manifestMissing, selectedIndex, selectedSection, pdfPage]);

  const zeroSectionsBanner =
    hasOutput && sections !== null && sections.length === 0 ? (
      <p className="step1-error">
        Warning: the TOC split produced 0 sections — downstream dataset summaries will be empty. Check the aCRF
        markdown quality or extractor choice.
      </p>
    ) : undefined;

  return (
    <StepPage
      title="aCRF section split"
      description="The aCRF markdown is split into one file per TOC section; each section feeds a dataset summary."
      status={status}
      statusDetail={countDetail(stepInfo)}
      onRun={onRun}
      isRunning={isStepRunning}
      dependencies={dependencyInfos(stepInfo, backendStatuses)}
      hasOutput={hasOutput}
      banner={
        <>
          {runError ? <p className="step1-error">{runError}</p> : null}
          {zeroSectionsBanner}
        </>
      }
      tabs={tabs}
      initialTabId={pdfPage !== undefined ? "acrf-pdf" : tabParam}
      onPrev={goPrev}
      onNext={goNext}
      prevLabel={prevLabel}
      nextLabel={nextLabel}
    />
  );
}
