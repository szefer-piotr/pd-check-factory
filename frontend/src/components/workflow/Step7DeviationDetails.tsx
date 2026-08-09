import { useEffect, useState, type ReactNode } from "react";
import {
  acceptStep7DeviationEnriched,
  fetchPdTaxonomy,
  fetchStep7EnrichmentDetail,
  generateStep7PseudoLogic,
  updateStep7Deviation,
  updateStep7DeviationStatus,
  type Step7DeviationPayload,
  type Step7DeviationRow,
  type Step7EnrichmentDetailResponse,
  type Step7ReviewSource,
  type StepStatus
} from "../../services/stepApi";

interface Step7DeviationDetailsProps {
  studyId: string;
  reviewSource: Step7ReviewSource;
  row: Step7DeviationRow;
  alsoPseudo: boolean;
  onAlsoPseudoChange: (value: boolean) => void;
  onRowUpdated: (row: Step7DeviationRow) => void;
  onStepStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onRequestChatRefresh?: () => void;
  onClose?: () => void;
}

function refsToText(value: string[]): string {
  return value.join(", ");
}

function refsFromText(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function EnrichmentBulletList({ title, items }: { title: string; items: string[] }): JSX.Element | null {
  if (!items.length) {
    return null;
  }
  return (
    <div className="step7-tile-field">
      <h6>{title}</h6>
      <ul className="step7-enrichment-list">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="step7-evidence-body">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TileSection({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="step7-tile-section">
      <h5 className="step7-tile-section-title">{title}</h5>
      <div className="step7-tile-section-body">{children}</div>
    </section>
  );
}

export function Step7DeviationDetails({
  studyId,
  reviewSource,
  row,
  alsoPseudo,
  onAlsoPseudoChange,
  onRowUpdated,
  onStepStatusesChange,
  onRequestChatRefresh,
  onClose
}: Step7DeviationDetailsProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Step7DeviationPayload | null>(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [enrichmentDetail, setEnrichmentDetail] = useState<Step7EnrichmentDetailResponse | null>(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [enrichmentError, setEnrichmentError] = useState("");
  const [taxonomy, setTaxonomy] = useState<Record<string, string[]>>({});

  const deviationId = row.deviation_id;

  useEffect(() => {
    let cancelled = false;
    void fetchPdTaxonomy()
      .then((payload) => {
        if (!cancelled) {
          setTaxonomy(payload.categories ?? {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTaxonomy({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setError("");
    setIsEditing(false);
    setEditForm(null);
    setEnrichmentDetail(null);
    setEnrichmentError("");
  }, [deviationId]);

  async function loadEnrichmentDetail(): Promise<void> {
    if (reviewSource !== "enriched_pd_spec" || !deviationId) {
      return;
    }
    setEnrichmentLoading(true);
    setEnrichmentError("");
    try {
      const detail = await fetchStep7EnrichmentDetail(studyId.trim(), deviationId);
      setEnrichmentDetail(detail);
    } catch (err) {
      setEnrichmentDetail(null);
      setEnrichmentError(err instanceof Error ? err.message : "Failed to load enrichment details.");
    } finally {
      setEnrichmentLoading(false);
    }
  }

  useEffect(() => {
    if (reviewSource === "enriched_pd_spec" && deviationId) {
      void loadEnrichmentDetail();
    }
  }, [deviationId, reviewSource, studyId]);

  const originalText = (row.original_deviation_text ?? "").trim();
  const showOriginalText =
    reviewSource === "enriched_pd_spec" &&
    Boolean(originalText) &&
    originalText !== row.deviation_text.trim();

  const isEnrichedReview = reviewSource === "enriched_pd_spec";
  const suggestedText = (
    row.suggested_deviation_text ??
    enrichmentDetail?.suggested_deviation_text ??
    enrichmentDetail?.improved_deviation_text ??
    ""
  ).trim();
  const currentDeviationText = row.deviation_text.trim();
  const isReviewFinalized = row.status === "accepted" || row.status === "rejected";
  const canAcceptEnriched =
    isEnrichedReview && Boolean(suggestedText) && suggestedText !== currentDeviationText;
  const reviewFinalizedTitle = isReviewFinalized ? `Deviation is already ${row.status}` : undefined;

  async function handleStatusUpdate(status: Step7DeviationRow["status"]): Promise<void> {
    setError("");
    try {
      const updated = await updateStep7DeviationStatus(
        studyId.trim(),
        row.deviation_id,
        status,
        undefined,
        reviewSource
      );
      onRowUpdated(updated.row);
      onStepStatusesChange(updated.stepStatuses);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update status.");
    }
  }

  async function handleAcceptEnriched(): Promise<void> {
    if (!suggestedText) {
      setError("No enriched deviation text is available to accept.");
      return;
    }
    setError("");
    try {
      const updated = await acceptStep7DeviationEnriched(
        studyId.trim(),
        row.deviation_id,
        suggestedText,
        reviewSource
      );
      onRowUpdated(updated.row);
      onStepStatusesChange(updated.stepStatuses);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to accept enriched text.");
    }
  }

  async function handleGeneratePseudo(): Promise<void> {
    setIsBusy(true);
    setError("");
    try {
      const result = await generateStep7PseudoLogic(studyId.trim(), row.deviation_id, reviewSource);
      onRowUpdated(result.row);
      onStepStatusesChange(result.stepStatuses);
      onRequestChatRefresh?.();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to generate pseudo logic.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveEdit(): Promise<void> {
    if (!editForm) {
      return;
    }
    setError("");
    try {
      const result = await updateStep7Deviation(studyId.trim(), row.deviation_id, editForm, reviewSource);
      onRowUpdated(result.row);
      onStepStatusesChange(result.stepStatuses);
      setIsEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save deviation.");
    }
  }

  function startEdit(): void {
    setIsEditing(true);
    setEditForm({
      deviation_id: row.deviation_id,
      rule_id: row.rule_id,
      text: row.deviation_text,
      paragraph_refs: row.paragraph_refs,
      data_support_note: row.data_support_note,
      dm_comment: row.dm_comment,
      status: row.status,
      protocol_deviation_category: row.protocol_deviation_category ?? "",
      protocol_deviation_sub_category: row.protocol_deviation_sub_category ?? ""
    });
  }

  const categoryOptions = Object.keys(taxonomy);
  const subCategoryOptions =
    editForm?.protocol_deviation_category && taxonomy[editForm.protocol_deviation_category]
      ? taxonomy[editForm.protocol_deviation_category]
      : [];

  return (
    <div
      className="step7-deviation-expanded"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="step7-deviation-expanded-header">
        <div className="step7-deviation-expanded-lead">
          <div className="step7-deviation-expanded-title-row">
            <span className="step7-deviation-id">{row.deviation_id}</span>
            <span className={`step7-status step7-status-${row.status}`}>{row.status}</span>
            <p className="step7-muted step7-deviation-expanded-rule">{row.rule_title || row.rule_id}</p>
          </div>
          {isEditing && editForm ? (
            <div className="step7-form-grid">
              <textarea
                className="step7-chat-input"
                value={editForm.text}
                onChange={(event) =>
                  setEditForm((previous) => (previous ? { ...previous, text: event.target.value } : previous))
                }
              />
              <input
                className="input"
                value={refsToText(editForm.paragraph_refs)}
                onChange={(event) =>
                  setEditForm((previous) =>
                    previous ? { ...previous, paragraph_refs: refsFromText(event.target.value) } : previous
                  )
                }
                placeholder="paragraph refs"
              />
              <textarea
                className="step7-chat-input"
                value={editForm.data_support_note}
                onChange={(event) =>
                  setEditForm((previous) =>
                    previous ? { ...previous, data_support_note: event.target.value } : previous
                  )
                }
                placeholder="data support note"
              />
              <label className="step7-muted">
                Category
                <select
                  className="input"
                  value={editForm.protocol_deviation_category ?? ""}
                  onChange={(event) =>
                    setEditForm((previous) =>
                      previous
                        ? {
                            ...previous,
                            protocol_deviation_category: event.target.value,
                            protocol_deviation_sub_category: ""
                          }
                        : previous
                    )
                  }
                >
                  <option value="">Select category</option>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="step7-muted">
                Sub-category
                <select
                  className="input"
                  value={editForm.protocol_deviation_sub_category ?? ""}
                  onChange={(event) =>
                    setEditForm((previous) =>
                      previous
                        ? { ...previous, protocol_deviation_sub_category: event.target.value }
                        : previous
                    )
                  }
                >
                  <option value="">Select sub-category</option>
                  {subCategoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div className="step7-chat-actions">
                <button className="button button-primary" type="button" onClick={() => void handleSaveEdit()}>
                  Save
                </button>
                <button className="button button-ghost" type="button" onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="step7-deviation-expanded-text-block">
              {showOriginalText ? (
                <div className="step7-drawer-original-text">
                  <h6>Original (PD spec)</h6>
                  <p className="step7-drawer-text step7-drawer-text-full">{originalText}</p>
                </div>
              ) : null}
              <p className="step7-drawer-text step7-drawer-text-full step7-deviation-expanded-text">
                {row.deviation_text}
              </p>
              <button className="button button-ghost" type="button" onClick={startEdit}>
                Edit deviation
              </button>
            </div>
          )}
        </div>
        <div className="step7-drawer-header-actions">
          {isEnrichedReview ? (
            <>
              <button
                className="button button-secondary"
                type="button"
                disabled={!canAcceptEnriched || isReviewFinalized}
                title={
                  reviewFinalizedTitle ??
                  (!suggestedText
                    ? "No enriched text available"
                    : !canAcceptEnriched
                      ? "Enriched text is already applied"
                      : "Replace working text with enriched suggestion and accept")
                }
                onClick={() => void handleAcceptEnriched()}
              >
                Accept enriched
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={isReviewFinalized}
                title={
                  reviewFinalizedTitle ??
                  "Accept deviation with current text (original import or chat-refined)"
                }
                onClick={() => void handleStatusUpdate("accepted")}
              >
                Keep original
              </button>
              <button
                className="button button-danger"
                type="button"
                disabled={isReviewFinalized}
                title={reviewFinalizedTitle ?? "Reject this deviation"}
                onClick={() => void handleStatusUpdate("rejected")}
              >
                Reject
              </button>
            </>
          ) : (
            <>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void handleStatusUpdate("accepted")}
              >
                Accept
              </button>
              <button
                className="button button-danger"
                type="button"
                onClick={() => void handleStatusUpdate("rejected")}
              >
                Decline
              </button>
            </>
          )}
          {onClose ? (
            <button className="button button-ghost button-icon" type="button" onClick={onClose} aria-label="Close">
              ×
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="step1-error step7-drawer-error">{error}</p> : null}

      <label className="step7-chatgpt-option step7-deviation-expanded-option">
        <input
          type="checkbox"
          checked={alsoPseudo}
          onChange={(event) => onAlsoPseudoChange(event.target.checked)}
        />
        <span>Generate pseudo logic after refine (when accepted)</span>
      </label>

      <div className="step7-deviation-expanded-body">
        <TileSection title="Supporting evidence">
          <div className="step7-evidence-panel">
            <div className="step7-tile-field">
              <h6>Rule</h6>
              <p className="step7-evidence-body">{row.rule_text || "No rule text."}</p>
            </div>
            <div className="step7-tile-field">
              <h6>Supporting sentences</h6>
              {(row.supporting_sentences ?? []).length > 0 ? (
                (row.supporting_sentences ?? []).map((sentence) => (
                  <p key={sentence.ref} className="step7-evidence-body">
                    <strong>{sentence.ref}:</strong> {sentence.text || "—"}
                  </p>
                ))
              ) : (
                <p className="step7-evidence-body">None</p>
              )}
            </div>
            <div className="step7-tile-field">
              <h6>Data support note</h6>
              <p className="step7-evidence-body">{row.data_support_note || "None"}</p>
            </div>
          </div>
        </TileSection>

        {reviewSource === "enriched_pd_spec" ? (
          <TileSection title="Protocol enrichment">
            <div className="step7-evidence-panel">
              {enrichmentLoading ? <p className="step7-muted">Loading enrichment details…</p> : null}
              {enrichmentError ? <p className="step7-evidence-body">{enrichmentError}</p> : null}
              {!enrichmentLoading && !enrichmentError && enrichmentDetail ? (
                <>
                  {enrichmentDetail.suggested_deviation_text || enrichmentDetail.improved_deviation_text ? (
                    <div className="step7-tile-field">
                      <h6>Suggested deviation text</h6>
                      <p className="step7-evidence-body">
                        {enrichmentDetail.suggested_deviation_text || enrichmentDetail.improved_deviation_text}
                      </p>
                    </div>
                  ) : null}
                  {enrichmentDetail.original_deviation_text ? (
                    <div className="step7-tile-field">
                      <h6>Original imported text</h6>
                      <p className="step7-evidence-body">{enrichmentDetail.original_deviation_text}</p>
                    </div>
                  ) : null}
                  {enrichmentDetail.paragraph_refs && enrichmentDetail.paragraph_refs.length > 0 ? (
                    <p className="step7-muted">Protocol refs: {enrichmentDetail.paragraph_refs.join(", ")}</p>
                  ) : null}
                  {enrichmentDetail.enrichment_summary ? (
                    <div className="step7-tile-field">
                      <h6>Summary</h6>
                      <p className="step7-evidence-body">{enrichmentDetail.enrichment_summary}</p>
                    </div>
                  ) : null}
                  {enrichmentDetail.enrichment_status ? (
                    <p className="step7-muted">Status: {enrichmentDetail.enrichment_status}</p>
                  ) : null}
                  {enrichmentDetail.programmability_risk ? (
                    <p className="step7-muted">Programmability risk: {enrichmentDetail.programmability_risk}</p>
                  ) : null}
                  <EnrichmentBulletList title="Assumptions" items={enrichmentDetail.assumptions} />
                  <EnrichmentBulletList title="Caveats" items={enrichmentDetail.caveats} />
                  <EnrichmentBulletList title="Data gaps" items={enrichmentDetail.data_gaps} />
                  <EnrichmentBulletList title="Weak spots" items={enrichmentDetail.weak_spots} />
                  <EnrichmentBulletList title="Suggested changes" items={enrichmentDetail.suggested_changes} />
                  <EnrichmentBulletList title="Protocol conflicts" items={enrichmentDetail.protocol_conflicts} />
                  {enrichmentDetail.improved_pseudo_logic_plain_english ? (
                    <div className="step7-tile-field">
                      <h6>Improved check logic (plain English)</h6>
                      <p className="step7-evidence-body">
                        {enrichmentDetail.improved_pseudo_logic_plain_english}
                      </p>
                    </div>
                  ) : null}
                  {Object.keys(enrichmentDetail.enrichment_errors).length > 0 ? (
                    <div className="step7-tile-field">
                      <h6>Enrichment task errors</h6>
                      <ul className="step7-enrichment-list">
                        {Object.entries(enrichmentDetail.enrichment_errors).map(([task, message]) => (
                          <li key={task} className="step7-evidence-body">
                            <strong>{task}:</strong> {message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
              {!enrichmentLoading && !enrichmentError && !enrichmentDetail ? (
                <p className="step7-muted">
                  {row.enrichment_summary || row.enrichment_status
                    ? `${row.enrichment_status ? `Status: ${row.enrichment_status}. ` : ""}${row.enrichment_summary ?? ""}`
                    : "No enrichment details available."}
                </p>
              ) : null}
            </div>
          </TileSection>
        ) : null}

        <TileSection title="Pseudo logic">
          <div className="step7-pseudo-panel">
            {row.pseudo_logic ? (
              <pre className="step7-drawer-code">{row.pseudo_logic}</pre>
            ) : (
              <p className="step7-muted">Not generated yet.</p>
            )}
            {row.manual_or_programmable ? (
              <p className="step7-muted">
                <span
                  className={`step7-pill step7-pill-${
                    row.manual_or_programmable === "Programmable"
                      ? "programmable"
                      : row.manual_or_programmable === "Partially programmable"
                        ? "partial"
                        : "manual"
                  }`}
                >
                  {row.manual_or_programmable}
                </span>
                {row.programmability_note ? ` — ${row.programmability_note}` : null}
              </p>
            ) : row.programmable !== null ? (
              <p className="step7-muted">
                <span className={`step7-pill step7-pill-${row.programmable ? "yes" : "no"}`}>
                  programmable: {row.programmable ? "yes" : "no"}
                </span>
                {row.programmability_note ? ` — ${row.programmability_note}` : null}
              </p>
            ) : null}
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void handleGeneratePseudo()}
              disabled={row.status !== "accepted" || isBusy}
            >
              Generate pseudo logic
            </button>
          </div>
        </TileSection>
      </div>
    </div>
  );
}
