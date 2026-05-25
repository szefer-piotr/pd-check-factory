import type { PipelineStepDefinition } from "../types/pipeline";

export const PIPELINE_STEPS: PipelineStepDefinition[] = [
  {
    id: "processing",
    title: "Processing",
    summary:
      "Upload protocol and aCRF PDFs, run the full extraction pipeline (including rules and deviations), and optionally import a company PD Specifications workbook.",
    instructions: [
      "Select the study and upload protocol and aCRF PDFs to blob storage.",
      "Choose OpenDataLoader or Document Intelligence before running the extraction pipeline.",
      "Run the pipeline to extract PDFs, index the protocol, prepare aCRF context, extract rules, and generate deviation candidates.",
      "Optionally upload a PD Specifications XLSX in the same panel; import and grounding can run after indexing completes.",
      "Use Preview on each document to inspect extracted markdown in a popup."
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
      },
      {
        label: "PD Specifications XLSX",
        path: "output/<study_id>/pipeline/imports/pd_specifications.xlsx",
        description: "Optional company PD Specifications workbook for import and grounding."
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
    title: "Review and Finalize",
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
  },
  {
    id: "coding",
    title: "Coding",
    summary: "Implement programmable checks from accepted PD specifications.",
    instructions: [
      "Complete Step 4 review with every deviation accepted or rejected.",
      "Use Accept on Step 4 to open the coding workspace.",
      "Coding tools will be added in a future release."
    ],
    inputSources: [
      {
        label: "Deviation Review State",
        path: "output/<study_id>/pipeline/review/deviations_review_state.json",
        description: "Accepted deviations ready for implementation."
      }
    ],
    outputArtifacts: [],
    previewItems: []
  }
];

/** Backend step IDs run from the unified Processing UI (PDF prep through deviation extraction). */
export const PROCESSING_BACKEND_STEP_IDS = [
  "extract-inputs",
  "index-protocol",
  "acrf-split-toc",
  "acrf-summary-text",
  "extract-rules",
  "extract-deviations"
] as const;

/** PDF/index steps required before uploads can run extraction (PD spec import grounding uses these). */
export const PROCESSING_CORE_STEP_IDS = [
  "extract-inputs",
  "index-protocol",
  "acrf-split-toc",
  "acrf-summary-text"
] as const;

/** Steps shown in horizontal workflow navigation. */
export const NAV_PIPELINE_STEPS: PipelineStepDefinition[] = PIPELINE_STEPS.filter((step) =>
  (["processing", "review-and-finalize", "coding"] as const).includes(step.id as "processing" | "review-and-finalize" | "coding")
);

/** Legacy hash routes redirected to Processing. */
export const LEGACY_NAV_STEP_HASH_REDIRECT: Record<string, string> = {
  "extract-rules": "processing",
  "extract-deviations": "processing"
};

export const IMPORT_PIPELINE_STEPS: PipelineStepDefinition[] = [
  {
    id: "processing",
    title: "Step 1 - Processing",
    summary:
      "Upload protocol and aCRF PDFs, extract markdown, index the protocol, split aCRF sections, and merge summary text.",
    instructions: [
      "Select the study and verify protocol/aCRF source files are available.",
      "Run processing to build paragraph index and merged aCRF summary.",
      "Upload the company PD Specifications workbook on the next step."
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
        label: "Paragraph Index",
        path: "output/<study_id>/pipeline/protocol_index/paragraph_index.json",
        description: "Paragraph references used for grounding."
      },
      {
        label: "Merged aCRF Summary Text",
        path: "output/<study_id>/pipeline/acrf_summary/acrf_summary_text_merged.json",
        description: "Dataset context for grounding and pseudo-logic."
      }
    ],
    previewItems: []
  },
  {
    id: "import-grounding",
    title: "Step 2 - Import & Ground PD Spec",
    summary: "Import PD Specifications workbook, ground deviations, and generate pseudo-logic.",
    instructions: [
      "Upload the company PD Specifications XLSX (NAL00-106 layout).",
      "Run import & grounding to parse rows and attach protocol/aCRF evidence.",
      "After a second import, run semantic merge and choose the active snapshot for review."
    ],
    inputSources: [
      {
        label: "PD Specifications XLSX",
        path: "output/<study_id>/pipeline/imports/pd_specifications.xlsx",
        description: "Company PD Specifications workbook."
      },
      {
        label: "Paragraph Index",
        path: "output/<study_id>/pipeline/protocol_index/paragraph_index.json",
        description: "Protocol grounding source."
      },
      {
        label: "aCRF Summary",
        path: "output/<study_id>/pipeline/acrf_summary/acrf_summary_text_merged.json",
        description: "aCRF grounding source."
      }
    ],
    outputArtifacts: [
      {
        label: "Import snapshot",
        path: "output/<study_id>/pipeline/review/deviations_import_vN.json",
        description: "Versioned immutable import snapshot."
      },
      {
        label: "Deviation context",
        path: "output/<study_id>/pipeline/coding/deviation_context/<deviation_id>.json",
        description: "Per-deviation grounding context from import-ground step."
      },
      {
        label: "Protocol enrichment",
        path: "output/<study_id>/pipeline/coding/protocol_enrichment/<deviation_id>.json",
        description: "Per-deviation parallel LLM enrichment (logic, caveats, critique)."
      },
      {
        label: "Enriched review lane",
        path: "output/<study_id>/pipeline/review/deviations_review_enriched_pd_spec.json",
        description: "Imported PD spec rows after protocol enrichment."
      },
      {
        label: "Review state",
        path: "output/<study_id>/pipeline/review/deviations_review_state.json",
        description: "Active working copy for Step 7 review."
      }
    ],
    previewItems: []
  },
  {
    id: "review-and-finalize",
    title: "Step 3 - Review and Finalize",
    summary: "Review grounded deviations, refine pseudo-logic, and emit final outputs.",
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
    previewItems: []
  }
];

export const IMPORT_BACKEND_STEP_IDS = [
  "extract-inputs",
  "index-protocol",
  "acrf-split-toc",
  "acrf-summary-text",
  "import-pd-spec-ground",
  "merge-pd-spec-imports"
] as const;

export const IMPORT_GROUNDING_BACKEND_STEP_IDS = [
  "import-pd-spec-ground",
  "import-pd-spec-map",
  "import-pd-spec-enrich",
  "merge-pd-spec-imports"
] as const;

export const PD_SPEC_REVIEW_STEP_IDS = ["import-pd-spec-map", "import-pd-spec-enrich"] as const;

export const DEFAULT_STEP_ID = PIPELINE_STEPS[0].id;
/** @deprecated Use DEFAULT_STEP_ID — unified pipeline always starts at processing. */
export const DEFAULT_IMPORT_STEP_ID = DEFAULT_STEP_ID;
