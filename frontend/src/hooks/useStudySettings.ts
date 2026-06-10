import { useCallback, useEffect, useState } from "react";
import type { Step1DocumentExtractor, Step1PdfExtractor } from "../services/stepApi";

export interface StudySettings {
  protocolExtractor: Step1DocumentExtractor;
  acrfExtractor: Step1DocumentExtractor;
  extractionLlmInstructions: string;
  extractionDeployment: string;
  acrfSummaryDeployment: string;
}

const DEFAULT_SETTINGS: StudySettings = {
  protocolExtractor: "opendataloader",
  acrfExtractor: "document_intelligence",
  extractionLlmInstructions: "",
  extractionDeployment: "",
  acrfSummaryDeployment: ""
};

function isDocumentExtractor(value: string): value is Step1DocumentExtractor {
  return value === "opendataloader" || value === "document_intelligence";
}

function legacyExtractorToDocument(value: Step1PdfExtractor): Step1DocumentExtractor {
  if (value === "document_intelligence") {
    return "document_intelligence";
  }
  if (value === "opendataloader") {
    return "opendataloader";
  }
  return DEFAULT_SETTINGS.protocolExtractor;
}

function legacyExtractorToAcrf(value: Step1PdfExtractor): Step1DocumentExtractor {
  if (value === "document_intelligence") {
    return "document_intelligence";
  }
  if (value === "opendataloader") {
    return "opendataloader";
  }
  return DEFAULT_SETTINGS.acrfExtractor;
}

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
    const parsed = JSON.parse(raw) as Partial<StudySettings> & { extractorChoice?: Step1PdfExtractor };
    const legacyChoice =
      parsed.extractorChoice === "both" ||
      parsed.extractorChoice === "opendataloader" ||
      parsed.extractorChoice === "document_intelligence"
        ? parsed.extractorChoice
        : undefined;

    const protocolRaw = parsed.protocolExtractor ?? "";
    const acrfRaw = parsed.acrfExtractor ?? "";
    const protocolExtractor = isDocumentExtractor(protocolRaw)
      ? protocolRaw
      : legacyChoice
        ? legacyExtractorToDocument(legacyChoice)
        : DEFAULT_SETTINGS.protocolExtractor;
    const acrfExtractor = isDocumentExtractor(acrfRaw)
      ? acrfRaw
      : legacyChoice
        ? legacyExtractorToAcrf(legacyChoice)
        : DEFAULT_SETTINGS.acrfExtractor;

    return {
      protocolExtractor,
      acrfExtractor,
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
