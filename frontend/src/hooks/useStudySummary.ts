import { useCallback, useEffect, useState } from "react";
import { fetchStudySummary, type StudySummary } from "../services/stepApi";

export interface UseStudySummaryResult {
  summary: StudySummary | null;
  isLoading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

export function useStudySummary(studyId: string, options?: { pollMs?: number; enabled?: boolean }): UseStudySummaryResult {
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const enabled = options?.enabled !== false;
  const pollMs = options?.pollMs ?? 0;

  const refresh = useCallback(async (): Promise<void> => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      setSummary(null);
      setError("");
      return;
    }
    setIsLoading(true);
    try {
      const data = await fetchStudySummary(trimmed);
      setSummary(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load study summary.");
    } finally {
      setIsLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !pollMs || !studyId.trim()) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [enabled, pollMs, refresh, studyId]);

  return { summary, isLoading, error, refresh };
}
