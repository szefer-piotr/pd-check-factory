import type { StudyDashboardData } from "../types/study";

const MOCK_DATA: Record<string, StudyDashboardData> = {
  "MY-STUDY": {
    overview: {
      studyId: "MY-STUDY",
      totalDeviations: 4,
      acceptedCount: 2,
      toReviewCount: 1,
      rejectedCount: 1,
      updatedAt: "2026-05-08T12:20:00Z"
    },
    deviations: [
      {
        id: "dev-001",
        title: "Visit window exceeds protocol limit",
        status: "accepted",
        ruleId: "rule-09",
        summary: "Visit 3 date is outside the allowed +7/-3 day window."
      },
      {
        id: "dev-002",
        title: "Missing baseline lab value",
        status: "to_review",
        ruleId: "rule-03",
        summary: "Hemoglobin baseline value is blank for randomized subject."
      },
      {
        id: "dev-003",
        title: "Dose escalation criteria not satisfied",
        status: "rejected",
        ruleId: "rule-15",
        summary: "Escalation occurred before required toxicity review was complete."
      },
      {
        id: "dev-004",
        title: "Unscheduled ECG not documented",
        status: "accepted",
        ruleId: "rule-27",
        summary: "Clinical note indicates ECG was performed but no CRF record exists."
      }
    ]
  }
};

export async function fetchStudyDashboard(studyId: string): Promise<StudyDashboardData> {
  await new Promise((resolve) => setTimeout(resolve, 450));
  const normalized = studyId.trim().toUpperCase();

  if (!normalized) {
    throw new Error("Study ID is required.");
  }

  if (normalized === "ERR-STUDY") {
    throw new Error("Unable to load study data. Please retry.");
  }

  return (
    MOCK_DATA[normalized] ?? {
      overview: {
        studyId: normalized,
        totalDeviations: 0,
        acceptedCount: 0,
        toReviewCount: 0,
        rejectedCount: 0,
        updatedAt: new Date().toISOString()
      },
      deviations: []
    }
  );
}
