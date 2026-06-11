import { navigateToStep } from "../../utils/hashRoute";

interface ParagraphRefChipProps {
  refId: string;
  /** When provided, used instead of the default deep-link to #/index-protocol?focus=… */
  onOpen?: (refId: string) => void;
}

/** A `p#` paragraph reference rendered as a deep-linking chip. */
export function ParagraphRefChip({ refId, onOpen }: ParagraphRefChipProps): JSX.Element {
  return (
    <button
      type="button"
      className="ref-chip"
      title={`Open paragraph ${refId}`}
      onClick={() => {
        if (onOpen) {
          onOpen(refId);
        } else {
          navigateToStep("index-protocol", { focus: refId });
        }
      }}
    >
      {refId}
    </button>
  );
}

interface ParagraphRefListProps {
  refs: string[];
  onOpen?: (refId: string) => void;
}

export function ParagraphRefList({ refs, onOpen }: ParagraphRefListProps): JSX.Element | null {
  if (!refs.length) {
    return null;
  }
  return (
    <span className="ref-chip-list">
      {refs.map((refId) => (
        <ParagraphRefChip key={refId} refId={refId} onOpen={onOpen} />
      ))}
    </span>
  );
}

interface DatasetRefChipProps {
  datasetName: string;
}

/** A dataset name chip deep-linking to the dataset summaries step. */
export function DatasetRefChip({ datasetName }: DatasetRefChipProps): JSX.Element {
  return (
    <button
      type="button"
      className="ref-chip ref-chip-dataset"
      title={`Open dataset ${datasetName}`}
      onClick={() => navigateToStep("acrf-summary-text", { focus: datasetName })}
    >
      {datasetName}
    </button>
  );
}

interface RuleRefChipProps {
  ruleId: string;
}

/** A rule id chip deep-linking to the rule extraction step. */
export function RuleRefChip({ ruleId }: RuleRefChipProps): JSX.Element {
  return (
    <button
      type="button"
      className="ref-chip ref-chip-rule"
      title={`Open rule ${ruleId}`}
      onClick={() => navigateToStep("extract-rules", { focus: ruleId })}
    >
      {ruleId}
    </button>
  );
}
