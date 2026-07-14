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
  extractorChoice: "document_intelligence",
  extractionLlmInstructions: "",
  extractionDeployment: "",
  acrfSummaryDeployment: "",
  chatDeployment: ""
};

function draftStorageKey(studyId: string): string {
  return `pd-study-settings-draft:${studyId.trim()}`;
}

function appliedStorageKey(studyId: string): string {
  return `pd-study-settings-applied:${studyId.trim()}`;
}

function legacyStorageKey(studyId: string): string {
  return `pd-study-settings:${studyId.trim()}`;
}

function normalizeSettings(parsed: Partial<StudySettings> | null | undefined): StudySettings {
  if (!parsed) {
    return DEFAULT_SETTINGS;
  }
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
}

function readSettingsFromKey(key: string): StudySettings | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return normalizeSettings(JSON.parse(raw) as Partial<StudySettings>);
  } catch {
    return null;
  }
}

function readDraftSettings(studyId: string): StudySettings {
  if (!studyId.trim()) {
    return DEFAULT_SETTINGS;
  }
  const draft = readSettingsFromKey(draftStorageKey(studyId));
  if (draft) {
    return draft;
  }
  const legacy = readSettingsFromKey(legacyStorageKey(studyId));
  if (legacy) {
    return legacy;
  }
  return DEFAULT_SETTINGS;
}

function readAppliedSettings(studyId: string): StudySettings | null {
  if (!studyId.trim()) {
    return null;
  }
  const applied = readSettingsFromKey(appliedStorageKey(studyId));
  if (applied) {
    return applied;
  }
  return readSettingsFromKey(legacyStorageKey(studyId));
}

function writeDraftSettings(studyId: string, settings: StudySettings): void {
  if (!studyId.trim()) {
    return;
  }
  sessionStorage.setItem(draftStorageKey(studyId), JSON.stringify(settings));
}

function writeAppliedSettings(studyId: string, settings: StudySettings): void {
  if (!studyId.trim()) {
    return;
  }
  sessionStorage.setItem(appliedStorageKey(studyId), JSON.stringify(settings));
  sessionStorage.setItem(draftStorageKey(studyId), JSON.stringify(settings));
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
  draftSettings: StudySettings;
  appliedSettings: StudySettings | null;
  updateDraftSettings: (patch: StudySettingsPatch) => void;
  applySettings: (settings: StudySettings) => void;
  loadAppliedSettings: (settings: StudySettings) => void;
  hasAppliedSettings: boolean;
} {
  const [draftSettings, setDraftSettings] = useState<StudySettings>(() => readDraftSettings(studyId));
  const [appliedSettings, setAppliedSettings] = useState<StudySettings | null>(() =>
    readAppliedSettings(studyId)
  );

  useEffect(() => {
    setDraftSettings(readDraftSettings(studyId));
    setAppliedSettings(readAppliedSettings(studyId));
  }, [studyId]);

  const updateDraftSettings = useCallback(
    (patch: Partial<StudySettings> | ((previous: StudySettings) => Partial<StudySettings>)) => {
      setDraftSettings((previous) => {
        const resolvedPatch = typeof patch === "function" ? patch(previous) : patch;
        const next = { ...previous, ...resolvedPatch };
        writeDraftSettings(studyId, next);
        return next;
      });
    },
    [studyId]
  );

  const applySettings = useCallback(
    (settings: StudySettings) => {
      writeAppliedSettings(studyId, settings);
      setDraftSettings(settings);
      setAppliedSettings(settings);
    },
    [studyId]
  );

  const loadAppliedSettings = useCallback(
    (settings: StudySettings) => {
      writeAppliedSettings(studyId, settings);
      setDraftSettings(settings);
      setAppliedSettings(settings);
    },
    [studyId]
  );

  return {
    draftSettings,
    appliedSettings,
    updateDraftSettings,
    applySettings,
    loadAppliedSettings,
    hasAppliedSettings: appliedSettings !== null
  };
}
