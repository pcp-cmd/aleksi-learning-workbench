const LAUNCH_TOKEN_PATTERN = /^[A-Za-z0-9.-]{1,128}$/u;
const STORAGE_PREFIX = "aleksi-workbench.launch.";
const DESKTOP_PRESENTATION_KEY =
  "aleksi-workbench.desktop-launch.presented";
const volatileDesktopPresentationCompletions = new WeakSet<LaunchStorage>();
const rendererLaunchDecisions = new WeakMap<LaunchStorage, Map<string, boolean>>();

type LaunchStorage = Pick<Storage, "getItem" | "setItem">;

export function readLaunchToken(location: string): string | null {
  const url = new URL(location, "http://127.0.0.1");
  if (url.pathname !== "/") {
    return null;
  }

  const token = url.searchParams.get("launch");
  return token !== null && LAUNCH_TOKEN_PATTERN.test(token) ? token : null;
}

export function consumeLaunchToken(
  token: string,
  storage: LaunchStorage
): boolean {
  if (!LAUNCH_TOKEN_PATTERN.test(token)) {
    return false;
  }

  const key = `${STORAGE_PREFIX}${token}`;
  try {
    if (storage.getItem(key) !== null) {
      return false;
    }
    storage.setItem(key, "consumed");
    return true;
  } catch {
    return true;
  }
}

export function consumeLaunchTokenOnceForRenderer(
  token: string,
  storage: LaunchStorage
): boolean {
  let decisions = rendererLaunchDecisions.get(storage);
  if (decisions === undefined) {
    decisions = new Map();
    rendererLaunchDecisions.set(storage, decisions);
  }
  const existing = decisions.get(token);
  if (existing !== undefined) {
    return existing;
  }
  const decision = consumeLaunchToken(token, storage);
  decisions.set(token, decision);
  return decision;
}

export function desktopLaunchPresentationComplete(
  storage: LaunchStorage
): boolean {
  if (volatileDesktopPresentationCompletions.has(storage)) {
    return true;
  }
  try {
    return storage.getItem(DESKTOP_PRESENTATION_KEY) === "complete";
  } catch {
    return false;
  }
}

export function markDesktopLaunchPresentationComplete(
  storage: LaunchStorage
): void {
  try {
    storage.setItem(DESKTOP_PRESENTATION_KEY, "complete");
  } catch {
    volatileDesktopPresentationCompletions.add(storage);
  }
}

export function launchState(
  location: string,
  storage: LaunchStorage
): { show: boolean } {
  const token = readLaunchToken(location);
  if (token === null) {
    return { show: false };
  }

  try {
    return { show: storage.getItem(`${STORAGE_PREFIX}${token}`) === null };
  } catch {
    return { show: true };
  }
}
