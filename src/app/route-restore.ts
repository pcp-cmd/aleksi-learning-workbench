export const LAST_SAFE_ROUTE_STORAGE_KEY = "aleksi.desktop.last-safe-route.v1";

const MAX_STORED_ROUTE_LENGTH = 512;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const GRAPH_STAGES = new Set(["concept", "example", "boundary", "process", "mistake"]);

type RouteRecord = {
  version: 1;
  path: string;
};

function safeIdentifier(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function safeConcept(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (
    normalized.length === 0 ||
    normalized.length > 160 ||
    /[\u0000-\u001f\u007f<>"'`\\]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function appendIfSafe(
  target: URLSearchParams,
  key: string,
  value: string | null,
  validator: (candidate: string | null) => string | null
): void {
  const safe = validator(value);
  if (safe !== null) {
    target.set(key, safe);
  }
}

export function sanitizeRestorableLocation(pathname: string, search = ""): string {
  const source = new URLSearchParams(search);
  const target = new URLSearchParams();

  switch (pathname) {
    case "/today":
      break;
    case "/reader":
      appendIfSafe(target, "reading", source.get("reading"), safeIdentifier);
      break;
    case "/cards":
      appendIfSafe(target, "cardId", source.get("cardId"), safeIdentifier);
      break;
    case "/graph": {
      appendIfSafe(target, "concept", source.get("concept"), safeConcept);
      const stage = source.get("stage");
      if (stage !== null && GRAPH_STAGES.has(stage)) {
        target.set("stage", stage);
      }
      break;
    }
    case "/review":
      appendIfSafe(target, "cardId", source.get("cardId"), safeIdentifier);
      appendIfSafe(target, "concept", source.get("concept"), safeConcept);
      break;
    case "/verification":
      appendIfSafe(target, "cardId", source.get("cardId"), safeIdentifier);
      appendIfSafe(target, "evidenceId", source.get("evidenceId"), safeIdentifier);
      break;
    default:
      return "/today";
  }

  const normalizedSearch = target.toString();
  return normalizedSearch === "" ? pathname : `${pathname}?${normalizedSearch}`;
}

export function readLastSafeRoute(storage: Pick<Storage, "getItem">): string {
  try {
    const raw = storage.getItem(LAST_SAFE_ROUTE_STORAGE_KEY);
    if (raw === null || raw.length > MAX_STORED_ROUTE_LENGTH) {
      return "/today";
    }
    const record = JSON.parse(raw) as Partial<RouteRecord>;
    if (record.version !== 1 || typeof record.path !== "string") {
      return "/today";
    }
    const parsed = new URL(record.path, "https://aleksi.local");
    if (parsed.origin !== "https://aleksi.local" || parsed.hash !== "") {
      return "/today";
    }
    return sanitizeRestorableLocation(parsed.pathname, parsed.search);
  } catch {
    return "/today";
  }
}

export function writeLastSafeRoute(
  storage: Pick<Storage, "setItem">,
  pathname: string,
  search = ""
): void {
  const path = sanitizeRestorableLocation(pathname, search);
  try {
    storage.setItem(
      LAST_SAFE_ROUTE_STORAGE_KEY,
      JSON.stringify({ version: 1, path } satisfies RouteRecord)
    );
  } catch {
    // Route restoration is optional and must never block the learning flow.
  }
}
