# Rho PD Assurance UI Specification

## Purpose

Provide a guided corporate workflow for Rho Inc. clinical data management teams to create studies, configure extraction, and review protocol deviations.

## Primary User

Data manager or QA reviewer running PD assurance from protocol and aCRF source documents (or imported PD Spec workbooks).

## User Flows

### Flow A — New Project

1. **Welcome** — Rho logo, product title, two entry tiles: New Project | Select from Project Library
2. **New Project** — Study ID form (non-empty, no `/`, unique in blob); `POST /api/v1/studies`
3. **Project** — Three workflow tiles: Extract | Enrich | Map; persisted via `POST …/workflow`
4. **Setup** — LLM deployment, OCR method, workflow-specific file uploads
5. **Summary** — Config + files review; single "Start extraction" button
6. **Live Review** — Streaming rules/deviations, Step7 review panel, bulk actions after extraction completes

### Flow B — Project Library

1. **Welcome** → Select from Project Library
2. List from `GET /api/v1/studies` (id, workflow, stage, last modified)
3. Open at correct stage (project / setup / summary / review)
4. Lazy sync: no full sync on open; sync on demand before pipeline run or via manual Sync button

## Routes

| Path | Page |
|------|------|
| `/welcome` | WelcomePage |
| `/projects/new` | NewProjectPage |
| `/projects/:studyId` | ProjectPage (workflow picker) |
| `/projects/:studyId/setup` | SetupPage |
| `/projects/:studyId/summary` | SummaryPage |
| `/projects/:studyId/review` | LiveReviewPage |

Study routes use `StudyLayout` (study bar with deviation chips + manual Sync).

## Component Map

- `WelcomePage`
  - `Page` → hero (logo, title, subtitle)
  - Entry tiles or `ProjectLibraryView`
- `NewProjectPage` — Study ID form
- `StudyLayout` — study bar (metrics from `GET …/summary`), `Outlet`
- `ProjectPage` — workflow tile picker
- `SetupPage` — `LlmDeploymentSelect`, OCR select, `UploadRail`
- `SummaryPage` — config summary, Start extraction
- `LiveReviewPage` — `ExtractionLiveFeed`, `Step7ReviewPanel`
- `Step7ReviewPanel` — `Step7RuleGroups`, `Step7DeviationDrawer`, bulk toolbar

## Data Contract

- `StudySummaryResponse` — consolidated study state from `GET /api/v1/studies/{id}/summary`
- `LibraryStudyOption` — lightweight list item from `GET /api/v1/studies`
- `ExtractionLiveResponse` — streaming rules/deviations from `GET …/extraction/live`
- `Step7DeviationsResponse` — review rows from `GET …/step7/deviations`

## Acceptance Criteria

- Welcome is the first screen; no study bar on Welcome
- New project end-to-end without `window.prompt`
- Library opens existing study without full sync delay
- Live Review streams rules/deviations; per-deviation actions work during generation
- Bulk actions disabled until extraction complete
- Header chips use real deviation counts (via study summary)
