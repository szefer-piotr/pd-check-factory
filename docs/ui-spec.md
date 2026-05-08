# React Single-Page UI Specification

## Purpose
Provide a lightweight web interface for reviewing pipeline execution status and recent study outputs without replacing the existing Streamlit workflow.

## Primary User
Data manager or QA reviewer who needs a quick read-only dashboard with simple filtering.

## Core User Actions
- Select a `studyId` from an input field.
- Refresh summary data for the selected study.
- Filter deviations by status.
- Inspect a deviation summary card list.

## Required View States
- `loading`: show skeleton placeholders while data loads.
- `empty`: show an empty-state panel when no deviations exist.
- `error`: show an alert with retry action when data retrieval fails.
- `success`: show summary metrics plus filtered deviations.

## Acceptance Criteria
- Page works on mobile, tablet, and desktop.
- All controls are keyboard reachable and labeled.
- Filtering updates rendered results immediately.
- Refresh action is disabled while loading.
- Error state provides a clear message and retry action.

## Component Map
- `HomePage`
  - `Page`
    - `Section` (header)
      - `StudySelector`
      - `RefreshButton`
    - `Section` (summary)
      - `MetricCard` x3
    - `Section` (filters)
      - `StatusFilter`
    - `Section` (content)
      - `LoadingState` or `ErrorState` or `EmptyState` or `DeviationList`

## Data Contract (MVP Mock)
- `StudyOverview`
  - `studyId: string`
  - `totalDeviations: number`
  - `acceptedCount: number`
  - `toReviewCount: number`
  - `rejectedCount: number`
  - `updatedAt: string`
- `DeviationItem`
  - `id: string`
  - `title: string`
  - `status: "accepted" | "to_review" | "rejected"`
  - `ruleId: string`
  - `summary: string`
