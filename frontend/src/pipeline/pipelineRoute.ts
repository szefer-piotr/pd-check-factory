import type { GeneratePdSubStep, PipelineStepId, StudySetupSection } from "./pipelineSteps";
import {
  GENERATE_PD_CHILDREN,
  LEGACY_ROUTE_REDIRECTS,
  PIPELINE_STEPS,
  pipelineStepById,
  pipelineStepByRoute
} from "./pipelineSteps";

const DEFAULT_STEP: PipelineStepId = "study-setup";

export interface PipelineRouteState {
  stepId: PipelineStepId;
  subStep?: GeneratePdSubStep;
  section?: StudySetupSection;
  studyId: string;
}

function parseQuery(hashPath: string): URLSearchParams {
  const queryIndex = hashPath.indexOf("?");
  if (queryIndex < 0) {
    return new URLSearchParams();
  }
  return new URLSearchParams(hashPath.slice(queryIndex + 1));
}

function parsePath(hashPath: string): string[] {
  const withoutQuery = hashPath.split("?")[0] ?? "";
  return withoutQuery
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parsePipelineHash(hash: string): PipelineRouteState {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  const parts = parsePath(trimmed);
  const query = parseQuery(trimmed);
  const studyId = (query.get("study") ?? "").trim();
  const route = parts[0] ?? DEFAULT_STEP;

  const legacy = LEGACY_ROUTE_REDIRECTS[route];
  if (legacy) {
    return {
      stepId: legacy.stepId,
      subStep: legacy.subStep,
      section: legacy.section,
      studyId
    };
  }

  const step = pipelineStepByRoute(route);
  if (!step) {
    return { stepId: DEFAULT_STEP, section: "study", studyId };
  }

  if (step.id === "generate-pd") {
    const childRoute = parts[1];
    const child = GENERATE_PD_CHILDREN.find((item) => item.route === childRoute || item.id === childRoute);
    return {
      stepId: "generate-pd",
      subStep: child?.id ?? "rules",
      studyId
    };
  }

  if (step.id === "study-setup") {
    const sectionPart = parts[1] as StudySetupSection | undefined;
    const section =
      sectionPart === "config" || sectionPart === "processing" || sectionPart === "study"
        ? sectionPart
        : "study";
    return { stepId: "study-setup", section, studyId };
  }

  return { stepId: step.id, studyId };
}

/** Convenience for callers that only need the step id (tests / simple checks). */
export function parsePipelineStepId(hash: string): PipelineStepId {
  return parsePipelineHash(hash).stepId;
}

export function pipelineHashForRoute(state: {
  stepId: PipelineStepId;
  subStep?: GeneratePdSubStep;
  section?: StudySetupSection;
  studyId?: string;
}): string {
  const step = pipelineStepById(state.stepId) ?? PIPELINE_STEPS[0];
  let path = `/${step.route}`;

  if (state.stepId === "generate-pd") {
    const child = GENERATE_PD_CHILDREN.find((item) => item.id === (state.subStep ?? "rules"));
    path += `/${child?.route ?? "rules"}`;
  } else if (state.stepId === "study-setup" && state.section && state.section !== "study") {
    path += `/${state.section}`;
  }

  const studyId = (state.studyId ?? "").trim();
  if (studyId) {
    path += `?study=${encodeURIComponent(studyId)}`;
  }
  return `#${path}`;
}

export function pipelineHashForStep(
  stepId: PipelineStepId,
  options: { subStep?: GeneratePdSubStep; section?: StudySetupSection; studyId?: string } = {}
): string {
  return pipelineHashForRoute({ stepId, ...options });
}

export function navigateToPipelineStep(
  stepId: PipelineStepId,
  options: { subStep?: GeneratePdSubStep; section?: StudySetupSection; studyId?: string } = {}
): void {
  const next = pipelineHashForStep(stepId, options);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

/** Rewrite legacy hashes to canonical new routes (preserves study query). */
export function canonicalizePipelineHash(hash: string): string | null {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  const parts = parsePath(trimmed);
  const route = parts[0] ?? "";
  const legacy = LEGACY_ROUTE_REDIRECTS[route];
  if (!legacy) {
    return null;
  }
  const parsed = parsePipelineHash(hash);
  return pipelineHashForRoute(parsed);
}
