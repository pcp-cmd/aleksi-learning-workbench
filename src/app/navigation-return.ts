const RETURNABLE_ROUTES = new Set([
  "/today",
  "/reader",
  "/cards",
  "/graph",
  "/review",
  "/diagnosis",
  "/verification"
]);

const MAX_CONTEXT_TEXT = 500;
const MAX_SCROLL_TOP = 100_000_000;

export type RouteReturnSource =
  | "reader"
  | "cards"
  | "review"
  | "diagnosis"
  | "verification"
  | "graph";

export type ReadingReturnContext = Readonly<{
  version: 1;
  source: "reading";
  returnTo: string;
  documentId: string;
  scrollTop: number;
  readingMode: "intensive";
  sectionAnchor?: string;
  focusExcerpt?: string;
  activeChunkId?: string;
}>;

export type RouteReturnContext = Readonly<{
  version: 1;
  source: RouteReturnSource;
  returnTo: string;
}>;

export type NavigationReturnContext =
  | ReadingReturnContext
  | RouteReturnContext;

type NavigationState = Readonly<{
  returnContext?: unknown;
  readingRestore?: unknown;
}>;

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_CONTEXT_TEXT
    ? normalized
    : undefined;
}

export function sanitizeReturnDestination(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return null;
  }

  try {
    const parsed = new URL(value, "https://aleksi.local");
    if (
      parsed.origin !== "https://aleksi.local" ||
      !RETURNABLE_ROUTES.has(parsed.pathname) ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function isRouteReturnSource(value: unknown): value is RouteReturnSource {
  return (
    value === "reader" ||
    value === "cards" ||
    value === "review" ||
    value === "diagnosis" ||
    value === "verification" ||
    value === "graph"
  );
}

export function parseNavigationReturnContext(
  value: unknown
): NavigationReturnContext | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  const returnTo = sanitizeReturnDestination(candidate.returnTo);
  if (returnTo === null) return null;

  if (candidate.source === "reading") {
    const documentId = boundedText(candidate.documentId);
    if (
      documentId === undefined ||
      candidate.readingMode !== "intensive" ||
      typeof candidate.scrollTop !== "number" ||
      !Number.isFinite(candidate.scrollTop) ||
      candidate.scrollTop < 0 ||
      candidate.scrollTop > MAX_SCROLL_TOP ||
      !returnTo.startsWith("/reader")
    ) {
      return null;
    }
    const sectionAnchor = boundedText(candidate.sectionAnchor);
    const focusExcerpt = boundedText(candidate.focusExcerpt);
    const activeChunkId = boundedText(candidate.activeChunkId);
    return Object.freeze({
      version: 1,
      source: "reading",
      returnTo,
      documentId,
      scrollTop: candidate.scrollTop,
      readingMode: "intensive",
      ...(sectionAnchor === undefined ? {} : { sectionAnchor }),
      ...(focusExcerpt === undefined ? {} : { focusExcerpt }),
      ...(activeChunkId === undefined ? {} : { activeChunkId })
    });
  }

  if (!isRouteReturnSource(candidate.source)) return null;
  return Object.freeze({
    version: 1,
    source: candidate.source,
    returnTo
  });
}

export function createReadingReturnContext(options: {
  documentId: string;
  scrollTop: number;
  sectionAnchor?: string;
  focusExcerpt?: string;
  activeChunkId?: string;
}): ReadingReturnContext {
  const context = parseNavigationReturnContext({
    version: 1,
    source: "reading",
    returnTo: `/reader?reading=${encodeURIComponent(options.documentId)}`,
    documentId: options.documentId,
    scrollTop: options.scrollTop,
    readingMode: "intensive",
    sectionAnchor: options.sectionAnchor,
    focusExcerpt: options.focusExcerpt,
    activeChunkId: options.activeChunkId
  });
  if (context?.source !== "reading") {
    throw new Error("Invalid reading return context");
  }
  return context;
}

export function createRouteReturnContext(
  source: RouteReturnSource,
  returnTo: string
): RouteReturnContext {
  const context = parseNavigationReturnContext({
    version: 1,
    source,
    returnTo
  });
  if (context === null || context.source === "reading") {
    throw new Error("Invalid route return context");
  }
  return context;
}

export function readNavigationReturnContext(
  state: unknown
): NavigationReturnContext | null {
  if (state === null || typeof state !== "object") return null;
  return parseNavigationReturnContext((state as NavigationState).returnContext);
}

export function readReadingRestoreContext(
  state: unknown
): ReadingReturnContext | null {
  if (state === null || typeof state !== "object") return null;
  const context = parseNavigationReturnContext(
    (state as NavigationState).readingRestore
  );
  return context?.source === "reading" ? context : null;
}

export function stateWithReturnContext(
  context: NavigationReturnContext,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...extra, returnContext: context };
}

export function stateForReadingRestore(
  context: ReadingReturnContext
): Record<string, unknown> {
  return { readingRestore: context };
}

export function returnControlLabel(context: NavigationReturnContext): string {
  if (context.source === "reading") return "← 返回阅读材料";
  if (context.source === "reader") return "← 返回精读工作台";
  if (context.source === "cards") return "← 返回卡片库";
  if (context.source === "review") return "← 返回复习";
  if (context.source === "graph") return "← 返回主题飞轮";
  if (context.source === "diagnosis") return "← 返回卡点诊断";
  return "← 返回证据验证";
}
