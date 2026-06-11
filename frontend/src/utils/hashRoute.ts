/** Hash routing helpers: "#/step-id?focus=p154" → { stepId, params }. */

export interface HashRoute {
  stepId: string;
  params: URLSearchParams;
}

export function parseHash(hash: string): HashRoute {
  const raw = hash.replace(/^#\/?/, "");
  const queryIndex = raw.indexOf("?");
  const stepId = (queryIndex >= 0 ? raw.slice(0, queryIndex) : raw).trim();
  const params = new URLSearchParams(queryIndex >= 0 ? raw.slice(queryIndex + 1) : "");
  return { stepId, params };
}

export function buildHash(stepId: string, params?: Record<string, string> | URLSearchParams): string {
  const search =
    params instanceof URLSearchParams ? params.toString() : new URLSearchParams(params ?? {}).toString();
  return `/${stepId}${search ? `?${search}` : ""}`;
}

export function navigateToStep(stepId: string, params?: Record<string, string> | URLSearchParams): void {
  window.location.hash = buildHash(stepId, params);
}
