import type { LibraryOperationContext } from "../server/persistence/library-context";

const TEST_VAULT_ID = "99999999-9999-4999-8999-999999999999";

export function testLibraryOperationContext(
  path: string,
  options: {
    generation?: number;
    signal?: AbortSignal;
    vaultId?: string;
  } = {}
): LibraryOperationContext {
  const signal = options.signal ?? new AbortController().signal;
  return Object.freeze({
    path,
    vaultId: options.vaultId ?? TEST_VAULT_ID,
    generation: options.generation ?? 0,
    signal,
    assertCurrent: () => signal.throwIfAborted()
  });
}
