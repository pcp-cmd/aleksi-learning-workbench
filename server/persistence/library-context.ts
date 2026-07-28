import { relative, resolve, sep } from "node:path";
import { readAppSettings } from "../config/app-settings";
import {
  assertInsideRoot,
  normalizeVaultRelativePath
} from "../lib/path-safety";
import {
  assertInitializedVault,
  readVaultId,
  resolvePrivilegedAbsolutePath,
  VaultServiceError
} from "../services/vault-service";

export type LibraryIdentity = Readonly<{
  path: string;
  vaultId: string;
}>;

export type LibraryContext = Readonly<{
  path: string;
  vaultId: string;
  generation: number;
}>;

export async function activeLearningLibraryIdentity(): Promise<LibraryIdentity> {
  const path = await activeLearningLibrary();
  return Object.freeze({
    path,
    vaultId: await readVaultId(path)
  });
}

export async function activeLearningLibrary(): Promise<string> {
  const settings = await readAppSettings();
  if (settings === null) {
    throw new VaultServiceError(
      "ACTIVE_VAULT_NOT_CONFIGURED",
      "No active local learning library is configured"
    );
  }

  const libraryPath = resolvePrivilegedAbsolutePath(settings.activeVaultPath);
  await assertInitializedVault(libraryPath);
  return libraryPath;
}

export function learningLibraryRelativePath(
  libraryPath: string,
  absolutePath: string
): string {
  const root = resolve(libraryPath);
  const candidate = assertInsideRoot(root, absolutePath);
  return normalizeVaultRelativePath(
    relative(root, candidate).split(sep).join("/")
  );
}
