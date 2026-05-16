import type { PipelineStepDefinition } from "../types/pipeline";

export const PIPELINE_STEPS: PipelineStepDefinition[] = [
  {
    id: "processing",
    title: "Step 1 - Processing",
    summary:
      "Upload protocol and aCRF PDFs, extract markdown, index the protocol, split aCRF sections, and merge summary text.",
    instructions: [
      "Select the study and verify protocol/aCRF source files are available in blob storage.",
      "Choose OpenDataLoader or Document Intelligence before running processing.",
      "Run processing to extract PDFs, build paragraph index, split aCRF TOC, and merge summary text.",
      "Review rendered markdown previews before continuing to rule extraction."
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
        path: "output/<study_id>/extractions/protocol/(opendataloader|layout)/rendered/source.md",
        description: "Protocol markdown (path depends on selected PDF extractor)."
      },
      {
        label: "aCRF Markdown",
        path: "output/<study_id>/extractions/acrf/(opendataloader|layout)/rendered/source.md",
        description: "aCRF markdown for section split and summarization."
      },
      {
        label: "Paragraph Index",
        path: "output/<study_id>/pipeline/protocol_index/paragraph_index.json",
        description: "Paragraph references consumed by rule extraction."
      },
      {
        label: "aCRF sections_toc",
        path: "output/<study_id>/extractions/acrf/layout/rendered/sections_toc/*.md",
        description: "Section markdown inputs required by summary text merge."
      },
      {
        label: "Merged aCRF Summary Text",
        path: "output/<study_id>/pipeline/acrf_summary/acrf_summary_text_merged.json",
        description: "Required context artifact consumed by deviation extraction."
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
    id: "extract-rules",
    title: "Step 2 - Rule Extractions",
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
    title: "Step 3 - Deviation Extractions",
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
        description: "Rules produced in Step 2 with paragraph references."
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
    title: "Step 4 - Review and Finalize",
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

/** Backend step IDs that constitute the merged Processing step. */
export const PROCESSING_BACKEND_STEP_IDS = [
  "extract-inputs",
  "index-protocol",
  "acrf-split-toc",
  "acrf-summary-text"
] as const;

export const DEFAULT_STEP_ID = PIPELINE_STEPS[0].id;
