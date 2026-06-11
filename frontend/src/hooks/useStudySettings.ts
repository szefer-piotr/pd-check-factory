import { useCallback, useEffect, useState } from "react";
import type { Step1PdfExtractor } from "../services/stepApi";

export interface StudySettings {
  extractorChoice: Step1PdfExtractor;
  extractionLlmInstructions: string;
  extractionDeployment: string;
  acrfSummaryDeployment: string;
  chatDeployment: string;
}

export const DEFAULT_SETTINGS: StudySettings = {
  extractorChoice: "both",
  extractionLlmInstructions: "",
  extractionDeployment: "",
  acrfSummaryDeployment: "",
  chatDeployment: ""
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
          : DEFAULT_SETTINGS.acrfSummaryDeployment,
      chatDeployment:
        typeof parsed.chatDeployment === "string" ? parsed.chatDeployment : DEFAULT_SETTINGS.chatDeployment
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

/** Fill empty deployment fields from API default without overwriting user choices. */
export function applyDefaultDeployments(
  settings: StudySettings,
  defaultDeployment: string
): StudySettings {
  if (!defaultDeployment.trim()) {
    return settings;
  }
  const patch: Partial<StudySettings> = {};
  if (!settings.extractionDeployment.trim()) {
    patch.extractionDeployment = defaultDeployment;
  }
  if (!settings.acrfSummaryDeployment.trim()) {
    patch.acrfSummaryDeployment = defaultDeployment;
  }
  if (!settings.chatDeployment.trim()) {
    patch.chatDeployment = defaultDeployment;
  }
  return Object.keys(patch).length > 0 ? { ...settings, ...patch } : settings;
}

export function deploymentForStep(
  stepId: string,
  settings: StudySettings,
  defaultDeployment: string
): string | undefined {
  const fallback = defaultDeployment.trim();
  if (stepId === "acrf-summary-text") {
    return settings.acrfSummaryDeployment.trim() || fallback || undefined;
  }
  if (stepId === "extract-rules" || stepId === "extract-deviations" || stepId === "import-pd-spec-enrich") {
    return settings.extractionDeployment.trim() || fallback || undefined;
  }
  return undefined;
}

export type StudySettingsPatch =
  | Partial<StudySettings>
  | ((previous: StudySettings) => Partial<StudySettings>);

export function useStudySettings(studyId: string): {
  settings: StudySettings;
  updateSettings: (patch: StudySettingsPatch) => void;
} {
  const [settings, setSettings] = useState<StudySettings>(() => readSettings(studyId));

  useEffect(() => {
    setSettings(readSettings(studyId));
  }, [studyId]);

  const updateSettings = useCallback(
    (patch: Partial<StudySettings> | ((previous: StudySettings) => Partial<StudySettings>)) => {
      setSettings((previous) => {
        const resolvedPatch = typeof patch === "function" ? patch(previous) : patch;
        const next = { ...previous, ...resolvedPatch };
        writeSettings(studyId, next);
        return next;
      });
    },
    [studyId]
  );

  return { settings, updateSettings };
}
