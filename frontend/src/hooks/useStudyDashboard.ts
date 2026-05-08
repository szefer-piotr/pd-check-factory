import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchStudyDashboard } from "../services/studyService";
import type { DeviationItem, DeviationStatus, StudyDashboardData } from "../types/study";

interface UseStudyDashboardResult {
  studyId: string;
  setStudyId: (next: string) => void;
  statusFilter: DeviationStatus | "all";
  setStatusFilter: (next: DeviationStatus | "all") => void;
  data: StudyDashboardData | null;
  filteredDeviations: DeviationItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useStudyDashboard(initialStudyId: string): UseStudyDashboardResult {
  const [studyId, setStudyId] = useState(initialStudyId);
  const [statusFilter, setStatusFilter] = useState<DeviationStatus | "all">("all");
  const [data, setData] = useState<StudyDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const next = await fetchStudyDashboard(studyId);
      setData(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredDeviations = useMemo(() => {
    const source = data?.deviations ?? [];
    if (statusFilter === "all") {
      return source;
    }
    return source.filter((item) => item.status === statusFilter);
  }, [data?.deviations, statusFilter]);

  return {
    studyId,
    setStudyId,
    statusFilter,
    setStatusFilter,
    data,
    filteredDeviations,
    isLoading,
    error,
    refresh
  };
}
