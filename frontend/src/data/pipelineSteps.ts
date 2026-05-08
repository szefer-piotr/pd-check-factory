import type { PipelineStepDefinition } from "../types/pipeline";

export const PIPELINE_STEPS: PipelineStepDefinition[] = [
  {
    id: "extract-inputs",
    title: "Step 1 - Extract Inputs",
    summary: "Collect protocol and aCRF files and produce normalized source markdown.",
    instructions: [
      "Select the study and verify protocol/aCRF source files are available.",
      "Run extraction to render source markdown artifacts.",
      "Validate that extraction output timestamps are current before continuing."
    ],
    inputSources: [
      {
        label: "Protocol PDF",
        path: "raw/<study_id>/protocol.pdf",
        description: "Primary protocol source uploaded to storage."
      },
      {
        label: "aCRF PDF",
        path: "raw/<study_id>/acrf.pdf",
        description: "Annotated CRF document used as data context support."
      }
    ],
    outputArtifacts: [
      {
        label: "Protocol Markdown",
        path: "output/<study_id>/extractions/protocol/opendataloader/rendered/source.md",
        description: "Normalized protocol markdown passed to protocol indexing."
      },
      {
        label: "aCRF Markdown",
        path: "output/<study_id>/extractions/acrf/layout/rendered/source.md",
        description: "aCRF markdown passed to section split and summarization."
      }
    ],
    previewItems: [
      {
        title: "Protocol sample",
        body: "Section 6.1 Inclusion Criteria\n1) Subject signed informed consent..."
      },
      {
        title: "aCRF sample",
        body: "Visit 3 Labs - Hemoglobin, ALT, AST fields detected..."
      }
    ]
  },
  {
    id: "index-protocol",
    title: "Step 2 - Index Protocol",
    summary: "Create paragraph-level references for deterministic downstream linking.",
    instructions: [
      "Run paragraph indexing against protocol source markdown.",
      "Verify sequential paragraph IDs and section boundaries.",
      "Confirm index artifact is available before rule extraction."
    ],
    inputSources: [
      {
        label: "Protocol Markdown",
        path: "output/<study_id>/extractions/protocol/opendataloader/rendered/source.md",
        description: "Input generated in Step 1."
      }
    ],
    outputArtifacts: [
      {
        label: "Paragraph Index",
        path: "output/<study_id>/pipeline/protocol_index/paragraph_index.json",
        description: "Paragraph references consumed by rule extraction and review."
      }
    ],
    previewItems: [
      {
        title: "Index row preview",
        body: "p154 -> section: InclusionCriteria, text: Subject must be >= 18 years old"
      }
    ]
  },
  {
    id: "acrf-split-toc",
    title: "Step 3 - aCRF Split TOC",
    summary: "Split extracted aCRF markdown into TOC section files.",
    instructions: [
      "Run TOC split on aCRF rendered markdown.",
      "Confirm markdown files exist under sections_toc.",
      "Ensure section manifest is generated before summary merge."
    ],
    inputSources: [
      {
        label: "aCRF Markdown",
        path: "output/<study_id>/extractions/acrf/layout/rendered/source.md",
        description: "aCRF markdown produced by Step 1 extraction."
      }
    ],
    outputArtifacts: [
      {
        label: "aCRF sections_toc",
        path: "output/<study_id>/extractions/acrf/layout/rendered/sections_toc/*.md",
        description: "Section markdown inputs required by summary text merge."
      },
      {
        label: "sections manifest",
        path: "output/<study_id>/extractions/acrf/layout/rendered/sections_toc/sections_manifest.json",
        description: "Metadata describing split TOC sections."
      }
    ],
    previewItems: [
      {
        title: "sections_toc preview",
        body: "001_demographics.md, 002_labs.md, ...",
        highlight: true
      }
    ]
  },
  {
    id: "acrf-summary-text",
    title: "Step 4 - aCRF Summary Text Merge",
    summary: "Generate merged aCRF summary text artifact required for deviation extraction.",
    instructions: [
      "Run aCRF section summarization merge to create one consolidated text summary.",
      "Confirm acrf_summary_text_merged.json exists under pipeline outputs.",
      "Use this merged summary as required context before deviation extraction."
    ],
    inputSources: [
      {
        label: "aCRF Sections",
        path: "output/<study_id>/extractions/acrf/layout/rendered/sections_toc/*.md",
        description: "Split aCRF section markdown files produced from extraction output."
      }
    ],
    outputArtifacts: [
      {
        label: "Merged aCRF Summary Text",
        path: "output/<study_id>/pipeline/acrf_summary/acrf_summary_text_merged.json",
        description: "Required context artifact consumed by deviation extraction."
      }
    ],
    previewItems: [
      {
        title: "Merged summary preview",
        body: "datasets: [DM, VS, LB] ... key columns and value patterns consolidated.",
        highlight: true
      }
    ]
  },
  {
    id: "extract-rules",
    title: "Step 5 - Rule Extractions",
    summary: "Generate atomic protocol rules with traceable references.",
    instructions: [
      "Run rule extraction with paragraph index context.",
      "Review rule clarity and ensure each rule is independently testable.",
      "Validate evidence links before sending output to deviation extraction."
    ],
    inputSources: [
      {
        label: "Paragraph Index",
        path: "output/<study_id>/pipeline/protocol_index/paragraph_index.json",
        description: "Provides p# references for each extracted rule."
      }
    ],
    outputArtifacts: [
      {
        label: "Parsed Rules",
        path: "output/<study_id>/pipeline/rules/rules_parsed.json",
        description: "Primary output passed directly to deviation extraction."
      }
    ],
    previewItems: [
      {
        title: "Rule preview",
        body: "rule-09: Visit 3 must occur within +7/-3 days of baseline. refs: [p154, p155]",
        highlight: true
      }
    ]
  },
  {
    id: "extract-deviations",
    title: "Step 6 - Deviation Extractions",
    summary: "Attach candidate deviations to each rule with evidence and rationale.",
    instructions: [
      "Run deviation extraction from parsed rules and source context.",
      "Inspect each deviation for rule alignment and non-duplication.",
      "Promote validated deviation candidates to review state artifact."
    ],
    inputSources: [
      {
        label: "Parsed Rules",
        path: "output/<study_id>/pipeline/rules/rules_parsed.json",
        description: "Rules produced in Step 5 with paragraph references."
      },
      {
        label: "aCRF Summary",
        path: "output/<study_id>/pipeline/acrf_summary/acrf_summary_text_merged.json",
        description: "Dataset/value context used for deviation evidence support."
      }
    ],
    outputArtifacts: [
      {
        label: "Deviation Candidates",
        path: "output/<study_id>/pipeline/deviations/deviations_parsed.json",
        description: "Candidate deviations handed to review workflow."
      },
      {
        label: "Review State",
        path: "output/<study_id>/pipeline/review/deviations_review_state.json",
        description: "Editable review state consumed by reviewer step."
      }
    ],
    previewItems: [
      {
        title: "Deviation preview",
        body: "dev-002 linked to rule-09: Visit 3 occurred 12 days after baseline.",
        highlight: true
      }
    ]
  },
  {
    id: "review-and-finalize",
    title: "Step 7 - Review and Finalize",
    summary: "Review decisions, refine pseudo-logic, and emit final outputs.",
    instructions: [
      "Review each deviation status: accepted, to_review, rejected.",
      "Refine pseudo-logic for accepted deviations and validate consistency.",
      "Run finalize to emit final JSON and XLSX artifacts."
    ],
    inputSources: [
      {
        label: "Deviation Review State",
        path: "output/<study_id>/pipeline/review/deviations_review_state.json",
        description: "Primary review table with DM comments and statuses."
      },
      {
        label: "Pseudo Logic Review State",
        path: "output/<study_id>/pipeline/review/pseudo_logic_review_state.json",
        description: "Pseudo logic review artifacts used before finalization."
      }
    ],
    outputArtifacts: [
      {
        label: "Final Deviations JSON",
        path: "output/<study_id>/pipeline/final/final_deviations.json",
        description: "Final machine-consumable output."
      },
      {
        label: "Final Deviations XLSX",
        path: "output/<study_id>/pipeline/final/final_deviations.xlsx",
        description: "Final reviewer-friendly workbook output."
      }
    ],
    previewItems: [
      {
        title: "Finalization summary",
        body: "final_deviations.json + final_deviations.xlsx generated successfully.",
        highlight: true
      }
    ]
  }
];

export const DEFAULT_STEP_ID = PIPELINE_STEPS[0].id;
