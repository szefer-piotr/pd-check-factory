import { useCallback, useEffect, useState } from "react";
import type { Step1PdfExtractor } from "../services/stepApi";

export interface StudySettings {
  extractorChoice: Step1PdfExtractor;
  extractionLlmInstructions: string;
  extractionDeployment: string;
  acrfSummaryDeployment: string;
}

const DEFAULT_SETTINGS: StudySettings = {
  extractorChoice: "both",
  extractionLlmInstructions: "",
  extractionDeployment: "",
  acrfSummaryDeployment: ""
};

function storageKey(studyId: string): string {
  return `pd-study-settings:${studyId.trim()}`;
}

function readSettings(studyId: string): StudySettings {
  if (!studyId.trim()) {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = sessionStorage.getItem(storageKey(studyId));
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<StudySettings>;
    return {
      extractorChoice:
        parsed.extractorChoice === "both" ||
        parsed.extractorChoice === "opendataloader" ||
        parsed.extractorChoice === "document_intelligence"
          ? parsed.extractorChoice
          : DEFAULT_SETTINGS.extractorChoice,
      extractionLlmInstructions:
        typeof parsed.extractionLlmInstructions === "string"
          ? parsed.extractionLlmInstructions
          : DEFAULT_SETTINGS.extractionLlmInstructions,
      extractionDeployment:
        typeof parsed.extractionDeployment === "string"
          ? parsed.extractionDeployment
          : DEFAULT_SETTINGS.extractionDeployment,
      acrfSummaryDeployment:
        typeof parsed.acrfSummaryDeployment === "string"
          ? parsed.acrfSummaryDeployment
          : DEFAULT_SETTINGS.acrfSummaryDeployment
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(studyId: string, settings: StudySettings): void {
  if (!studyId.trim()) {
    return;
  }
  sessionStorage.setItem(storageKey(studyId), JSON.stringify(settings));
}

export function useStudySettings(studyId: string): {
  settings: StudySettings;
  updateSettings: (patch: Partial<StudySettings>) => void;
} {
  const [settings, setSettings] = useState<StudySettings>(() => readSettings(studyId));

  useEffect(() => {
    setSettings(readSettings(studyId));
  }, [studyId]);

  const updateSettings = useCallback(
    (patch: Partial<StudySettings>) => {
      setSettings((previous) => {
        const next = { ...previous, ...patch };
        writeSettings(studyId, next);
        return next;
      });
    },
    [studyId]
  );

  return { settings, updateSettings };
}
