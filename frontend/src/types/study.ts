export type DeviationStatus = "accepted" | "to_review" | "rejected";

export interface DeviationItem {
  id: string;
  title: string;
  status: DeviationStatus;
  ruleId: string;
  summary: string;
}

export interface StudyOverview {
  studyId: string;
  totalDeviations: number;
  acceptedCount: number;
  toReviewCount: number;
  rejectedCount: number;
  updatedAt: string;
}

export interface StudyDashboardData {
  overview: StudyOverview;
  deviations: DeviationItem[];
}
