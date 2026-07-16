import { relative, resolve, sep } from "node:path";
import { readAppSettings } from "../config/app-settings";
import {
  assertInsideRoot,
  normalizeVaultRelativePath
} from "../lib/path-safety";
import {
  assertInitializedVault,
  resolvePrivilegedAbsolutePath,
  VaultServiceError
} from "../services/vault-service";

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
