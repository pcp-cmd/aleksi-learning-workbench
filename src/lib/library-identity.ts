import { useSyncExternalStore } from "react";

export type ClientLibraryIdentity = Readonly<{
  instanceId: string;
  vaultId: string;
  generation: number;
}>;

const listeners = new Set<() => void>();
const retiredInstanceIds = new Set<string>();
let currentIdentity: ClientLibraryIdentity | null = null;

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getLibraryIdentity(): ClientLibraryIdentity | null {
  return currentIdentity;
}

export function setLibraryIdentity(
  identity: ClientLibraryIdentity
): "accepted" | "stale" {
  if (retiredInstanceIds.has(identity.instanceId)) {
    return "stale";
  }
  if (
    currentIdentity !== null &&
    identity.instanceId !== currentIdentity.instanceId
  ) {
    retiredInstanceIds.add(currentIdentity.instanceId);
    currentIdentity = Object.freeze({ ...identity });
    emit();
    return "accepted";
  }
  if (
    currentIdentity !== null &&
    (identity.generation < currentIdentity.generation ||
      (identity.generation === currentIdentity.generation &&
        identity.vaultId !== currentIdentity.vaultId))
  ) {
    return "stale";
  }
  if (
    currentIdentity?.generation === identity.generation &&
    currentIdentity.vaultId === identity.vaultId
  ) {
    return "accepted";
  }
  currentIdentity = Object.freeze({ ...identity });
  emit();
  return "accepted";
}

export function resetLibraryIdentity(): void {
  if (currentIdentity === null) {
    return;
  }
  currentIdentity = null;
  retiredInstanceIds.clear();
  emit();
}

export function libraryIdentityFromHeaders(
  headers: Headers
): ClientLibraryIdentity | null {
  const vaultId = headers.get("X-Aleksi-Vault-Id");
  const instanceId = headers.get("X-Aleksi-Library-Instance");
  const generationRaw = headers.get("X-Aleksi-Vault-Generation");
  if (
    instanceId === null ||
    instanceId.length === 0 ||
    vaultId === null ||
    vaultId.length === 0 ||
    generationRaw === null ||
    !/^\d+$/u.test(generationRaw)
  ) {
    return null;
  }
  const generation = Number(generationRaw);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    return null;
  }
  return { instanceId, vaultId, generation };
}

export function observeLibraryResponse(
  response: Response
): "accepted" | "none" | "stale" {
  const identity = libraryIdentityFromHeaders(response.headers);
  return identity === null ? "none" : setLibraryIdentity(identity);
}

export function libraryQueryScope(
  identity: ClientLibraryIdentity | null
): readonly [string, string, number] {
  return identity === null
    ? ["unconfigured", "unconfigured", -1]
    : [identity.instanceId, identity.vaultId, identity.generation];
}

export function useLibraryIdentity(): ClientLibraryIdentity | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLibraryIdentity,
    getLibraryIdentity
  );
}
