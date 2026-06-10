import { useCallback, useEffect, useState } from "react";
import { fetchStudySummary, type StudySummaryResponse } from "../services/stepApi";

export function useStudySummary(studyId: string): {
  summary: StudySummaryResponse | null;
  isLoading: boolean;
  error: string;
  refresh: () => Promise<void>;
} {
  const [summary, setSummary] = useState<StudySummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      setSummary(null);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const data = await fetchStudySummary(trimmed);
      setSummary(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load study summary.");
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { summary, isLoading, error, refresh };
}
