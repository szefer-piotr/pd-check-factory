import type { PipelineStepId, StudySetupSection } from "./pipelineSteps";
import {
  LEGACY_ROUTE_REDIRECTS,
  PIPELINE_STEPS,
  pipelineStepById,
  pipelineStepByRoute
} from "./pipelineSteps";

const DEFAULT_STEP: PipelineStepId = "study-setup";

export interface PipelineRouteState {
  stepId: PipelineStepId;
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

function resolveGeneratePdLegacy(parts: string[]): PipelineStepId {
  const child = parts[1];
  if (child === "deviations") {
    return "deviations";
  }
  return "rules";
}

/** Strip optional `#/pipeline` prefix so legacy and nested routes share one parser. */
export function stripPipelinePrefix(hash: string): string {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  if (trimmed === "pipeline" || trimmed.startsWith("pipeline/") || trimmed.startsWith("pipeline?")) {
    const rest = trimmed.slice("pipeline".length).replace(/^\//, "");
    return rest ? `#/${rest}` : "#/study-setup";
  }
  return hash.startsWith("#") ? hash : `#/${trimmed}`;
}

export function parsePipelineHash(hash: string): PipelineRouteState {
  const normalized = stripPipelinePrefix(hash);
  const trimmed = normalized.replace(/^#\/?/, "").trim();
  const parts = parsePath(trimmed);
  const query = parseQuery(trimmed);
  const studyId = (query.get("study") ?? "").trim();
  const route = parts[0] ?? DEFAULT_STEP;

  if (route === "generate-pd") {
    return { stepId: resolveGeneratePdLegacy(parts), studyId };
  }

  const legacy = LEGACY_ROUTE_REDIRECTS[route];
  if (legacy) {
    return {
      stepId: legacy.stepId,
      section: legacy.section,
      studyId
    };
  }

  const step = pipelineStepByRoute(route);
  if (!step) {
    return { stepId: DEFAULT_STEP, section: "study", studyId };
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
  section?: StudySetupSection;
  studyId?: string;
}): string {
  const step = pipelineStepById(state.stepId) ?? PIPELINE_STEPS[0];
  let path = `/pipeline/${step.route}`;

  if (state.stepId === "study-setup" && state.section && state.section !== "study") {
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
  options: { section?: StudySetupSection; studyId?: string } = {}
): string {
  return pipelineHashForRoute({ stepId, ...options });
}

export function navigateToPipelineStep(
  stepId: PipelineStepId,
  options: { section?: StudySetupSection; studyId?: string } = {}
): void {
  const next = pipelineHashForStep(stepId, options);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

/**
 * Rewrite bare pipeline / legacy hashes to `#/pipeline/...`.
 * Returns null when the hash is already canonical or not a pipeline route.
 */
export function canonicalizePipelineHash(hash: string): string | null {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  if (!trimmed || trimmed === "guide" || trimmed === "history" || trimmed === "settings") {
    return null;
  }
  if (trimmed === "home") {
    return "#/";
  }

  const underPipeline =
    trimmed === "pipeline" || trimmed.startsWith("pipeline/") || trimmed.startsWith("pipeline?");
  if (underPipeline) {
    const parsed = parsePipelineHash(hash);
    const canonical = pipelineHashForRoute(parsed);
    return hash === canonical ? null : canonical;
  }

  const route = parsePath(trimmed)[0] ?? "";
  const isPipelineRoute =
    Boolean(LEGACY_ROUTE_REDIRECTS[route]) ||
    Boolean(pipelineStepByRoute(route)) ||
    route === "generate-pd";

  if (!isPipelineRoute) {
    return null;
  }

  const parsed = parsePipelineHash(hash);
  return pipelineHashForRoute(parsed);
}
