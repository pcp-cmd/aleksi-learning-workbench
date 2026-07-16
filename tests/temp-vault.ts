import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { DEFAULT_VAULT_DIRECTORIES } from "../shared/vault-map";

export const VAULT_FOLDERS = DEFAULT_VAULT_DIRECTORIES;

export const DEMO_READING_NAME = "aleksi-demo-reading.md";

export interface TempVaultContext {
  root: string;
  settingsDir: string;
  path(...segments: string[]): string;
}

const temporaryRoots: string[] = [];
let previousSettingsDir: string | undefined;

export async function createTempVaultContext(): Promise<TempVaultContext> {
  const root = await mkdtemp(join(tmpdir(), "aleksi-vault-api-"));
  temporaryRoots.push(root);
  const settingsDir = join(root, "app-settings");
  process.env.ALEKSI_APP_SETTINGS_DIR = settingsDir;

  return {
    root,
    settingsDir,
    path: (...segments: string[]) => join(root, ...segments)
  };
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function readAppSettings(settingsDir: string): Promise<{
  activeVaultPath: string;
  updatedAt: string;
}> {
  return readJsonFile(join(settingsDir, "settings.json"));
}

export async function writeAppSettings(
  settingsDir: string,
  activeVaultPath: string
): Promise<void> {
  await mkdir(settingsDir, { recursive: true });
  await writeFile(
    join(settingsDir, "settings.json"),
    `${JSON.stringify(
      {
        activeVaultPath,
        updatedAt: "2026-06-22T03:14:15.926Z"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

beforeEach(() => {
  previousSettingsDir = process.env.ALEKSI_APP_SETTINGS_DIR;
});

afterEach(async () => {
  if (previousSettingsDir === undefined) {
    delete process.env.ALEKSI_APP_SETTINGS_DIR;
  } else {
    process.env.ALEKSI_APP_SETTINGS_DIR = previousSettingsDir;
  }

  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    )
  );
});
