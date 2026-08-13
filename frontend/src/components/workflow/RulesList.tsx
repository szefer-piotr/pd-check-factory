import { useEffect, useState } from "react";
import { ParagraphRefChip } from "../viewers/RefChip";
import { getParagraphTextMap } from "../../services/paragraphCache";
import type { RulePreviewRow } from "../../utils/previewFormat";

interface RulesListProps {
  rules: RulePreviewRow[];
  selectedId: string | null;
  studyId: string;
  onSelect: (ruleId: string) => void;
  onOpenParagraphRef: (refId: string, allRefs: string[]) => void;
}

function RuleExpandedTile({
  rule,
  paragraphTexts,
  paragraphsLoading,
  onClose,
  onOpenParagraphRef
}: {
  rule: RulePreviewRow;
  paragraphTexts: Map<string, string>;
  paragraphsLoading: boolean;
  onClose: () => void;
  onOpenParagraphRef: (refId: string, allRefs: string[]) => void;
}): JSX.Element {
  return (
    <div
      className="step7-deviation-expanded"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="step7-deviation-expanded-header">
        <div className="step7-deviation-expanded-lead">
          <div className="step7-deviation-expanded-title-row">
            <span className="step7-deviation-id">{rule.rule_id}</span>
            <p className="step7-muted step7-deviation-expanded-rule">{rule.title || "Untitled rule"}</p>
          </div>
          <div className="step7-deviation-expanded-text-block">
            <p className="step7-drawer-text step7-drawer-text-full step7-deviation-expanded-text">
              {rule.text || "No rule text."}
            </p>
          </div>
        </div>
        <div className="step7-drawer-header-actions">
          <button className="button button-ghost" type="button" onClick={onClose} aria-label="Collapse rule">
            Close
          </button>
        </div>
      </header>

      <div className="step7-deviation-expanded-body">
        <section className="step7-tile-section">
          <h5 className="step7-tile-section-title">Paragraph references</h5>
          <div className="step7-tile-section-body">
            {rule.paragraph_refs.length === 0 ? (
              <p className="step7-evidence-body">None</p>
            ) : paragraphsLoading ? (
              <p className="step7-muted">Loading paragraph text…</p>
            ) : (
              <ul className="rule-paragraph-ref-list">
                {rule.paragraph_refs.map((refId) => {
                  const text = paragraphTexts.get(refId);
                  return (
                    <li key={refId} className="rule-paragraph-ref-item">
                      <ParagraphRefChip
                        refId={refId}
                        onOpen={() => onOpenParagraphRef(refId, rule.paragraph_refs)}
                      />
                      <p className="rule-paragraph-ref-text">
                        {text?.trim() ? text : "Paragraph text unavailable"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function RulesList({
  rules,
  selectedId,
  studyId,
  onSelect,
  onOpenParagraphRef
}: RulesListProps): JSX.Element {
  const [paragraphTexts, setParagraphTexts] = useState<Map<string, string>>(new Map());
  const [paragraphsLoading, setParagraphsLoading] = useState(false);

  useEffect(() => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      setParagraphTexts(new Map());
      setParagraphsLoading(false);
      return;
    }
    let cancelled = false;
    setParagraphsLoading(true);
    void getParagraphTextMap(trimmed)
      .then((map) => {
        if (!cancelled) {
          setParagraphTexts(map);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setParagraphsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studyId]);

  if (rules.length === 0) {
    return <p className="step7-muted">No rules to preview.</p>;
  }

  return (
    <div className="step7-rule-groups" role="list">
      <ul className="step7-deviation-list" role="list">
        {rules.map((rule) => {
          const isSelected = selectedId === rule.rule_id;
          return (
            <li key={rule.rule_id} className={isSelected ? "step7-deviation-item-selected" : undefined}>
              {isSelected ? (
                <div className="step7-deviation-item-selected-inner">
                  <RuleExpandedTile
                    rule={rule}
                    paragraphTexts={paragraphTexts}
                    paragraphsLoading={paragraphsLoading}
                    onClose={() => onSelect("")}
                    onOpenParagraphRef={onOpenParagraphRef}
                  />
                </div>
              ) : (
                <div
                  className="step7-deviation-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={false}
                  onClick={() => onSelect(rule.rule_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(rule.rule_id);
                    }
                  }}
                >
                  <span className="step7-deviation-id">{rule.rule_id}</span>
                  <p className="step7-deviation-snippet">{rule.title || rule.text || "Untitled rule"}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
