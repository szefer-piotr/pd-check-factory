import {
  canonicalizePipelineHash,
  parsePipelineHash,
  pipelineHashForStep,
  type PipelineRouteState
} from "./pipelineRoute";
import { LEGACY_ROUTE_REDIRECTS, pipelineStepByRoute } from "./pipelineSteps";

export type AppDestination = "home" | "pipeline" | "guide" | "history" | "settings";

export interface AppRouteState {
  destination: AppDestination;
  pipeline: PipelineRouteState | null;
}

const APP_DESTINATIONS = new Set<AppDestination>(["home", "pipeline", "guide", "history", "settings"]);

function firstSegment(hash: string): string {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  const withoutQuery = trimmed.split("?")[0] ?? "";
  return withoutQuery.split("/").filter(Boolean)[0] ?? "";
}

export function parseAppHash(hash: string): AppRouteState {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  if (!trimmed || trimmed === "home") {
    return { destination: "home", pipeline: null };
  }

  const segment = firstSegment(hash);
  if (segment === "guide" || segment === "history" || segment === "settings") {
    return { destination: segment, pipeline: null };
  }

  if (
    segment === "pipeline" ||
    segment === "generate-pd" ||
    Boolean(LEGACY_ROUTE_REDIRECTS[segment]) ||
    Boolean(pipelineStepByRoute(segment))
  ) {
    return { destination: "pipeline", pipeline: parsePipelineHash(hash) };
  }

  if (APP_DESTINATIONS.has(segment as AppDestination)) {
    return { destination: segment as AppDestination, pipeline: null };
  }

  return { destination: "home", pipeline: null };
}

export function appHashFor(destination: AppDestination, pipeline?: PipelineRouteState | null): string {
  switch (destination) {
    case "home":
      return "#/";
    case "guide":
      return "#/guide";
    case "history":
      return "#/history";
    case "settings":
      return "#/settings";
    case "pipeline":
      if (pipeline) {
        return pipelineHashForStep(pipeline.stepId, {
          section: pipeline.section,
          studyId: pipeline.studyId
        });
      }
      return pipelineHashForStep("study-setup");
    default:
      return "#/";
  }
}

export function navigateToApp(destination: AppDestination, pipeline?: PipelineRouteState | null): void {
  const next = appHashFor(destination, pipeline);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

/** Canonicalize app + pipeline hashes; returns null when already correct. */
export function canonicalizeAppHash(hash: string): string | null {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  if (trimmed === "home") {
    return "#/";
  }
  return canonicalizePipelineHash(hash);
}
