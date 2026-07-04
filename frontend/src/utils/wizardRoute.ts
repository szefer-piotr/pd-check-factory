import { DEFAULT_WIZARD_STAGE, type WizardStageId } from "../data/wizardSteps";

export function parseWizardHash(hash: string): WizardStageId {
  const raw = hash.replace(/^#\/?/, "").trim();
  const stageId = raw.split("?")[0]?.trim() || DEFAULT_WIZARD_STAGE;
  const known: WizardStageId[] = [
    "welcome",
    "library",
    "project",
    "setup",
    "summary",
    "processing",
    "review"
  ];
  if (stageId === "summary") {
    return "setup";
  }
  return known.includes(stageId as WizardStageId) ? (stageId as WizardStageId) : DEFAULT_WIZARD_STAGE;
}

export function navigateToWizardStage(stageId: WizardStageId): void {
  window.location.hash = `/${stageId}`;
}

export function buildWizardHash(stageId: WizardStageId): string {
  return `/${stageId}`;
}
