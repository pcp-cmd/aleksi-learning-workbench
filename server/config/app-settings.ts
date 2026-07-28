import { mkdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import { isFullyQualifiedAbsolutePath } from "../lib/path-safety";

const APP_SETTINGS_DIRECTORY_NAME = "Aleksi Learning Workbench";
const ISO_UTC_MILLISECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type AppSettings = {
  activeVaultPath: string;
  updatedAt: string;
};

export class AppSettingsError extends Error {
  readonly code: "INVALID_APP_SETTINGS";

  constructor(message: string) {
    super(message);
    this.name = "AppSettingsError";
    this.code = "INVALID_APP_SETTINGS";
  }
}

const appSettingsSchema = z
  .object({
    activeVaultPath: z
      .string()
      .min(1)
      .refine((value) => isFullyQualifiedAbsolutePath(value), {
        message: "activeVaultPath must be a fully qualified absolute path"
      }),
    updatedAt: z.string().regex(ISO_UTC_MILLISECONDS)
  })
  .strict();

export function getAppSettingsDirectory(): string {
  if (process.env.ALEKSI_APP_SETTINGS_DIR !== undefined) {
    return resolve(process.env.ALEKSI_APP_SETTINGS_DIR);
  }

  const appDataDirectory =
    process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(appDataDirectory, APP_SETTINGS_DIRECTORY_NAME);
}

export function getAppSettingsPath(): string {
  return join(getAppSettingsDirectory(), "settings.json");
}

function parseAppSettings(raw: string): AppSettings {
  try {
    return appSettingsSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new AppSettingsError(
      error instanceof Error
        ? `Invalid app settings: ${error.message}`
        : "Invalid app settings"
    );
  }
}

export async function readAppSettings(): Promise<AppSettings | null> {
  const settingsPath = getAppSettingsPath();
  try {
    return parseAppSettings(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    if (error instanceof AppSettingsError) {
      const settingsDirectory = getAppSettingsDirectory();
      const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
      const corruptPath = join(
        settingsDirectory,
        `settings.corrupt-${stamp}.json`
      );
      const diagnosticPath = join(
        settingsDirectory,
        `settings.recovery-${stamp}.json`
      );
      await rename(settingsPath, corruptPath);
      await atomicWriteText(
        diagnosticPath,
        `${JSON.stringify(
          {
            code: error.code,
            recoveredAt: new Date().toISOString(),
            quarantinedFile: corruptPath.split(/[\\/]/u).at(-1)
          },
          null,
          2
        )}\n`,
        { root: settingsDirectory }
      );
      return null;
    }
    throw error;
  }
}

export async function writeAppSettings(
  activeVaultPath: string
): Promise<AppSettings> {
  const settingsDirectory = getAppSettingsDirectory();
  const settings: AppSettings = {
    activeVaultPath: resolve(activeVaultPath),
    updatedAt: new Date().toISOString()
  };

  await mkdir(settingsDirectory, { recursive: true });
  await atomicWriteText(
    getAppSettingsPath(),
    `${JSON.stringify(settings, null, 2)}\n`,
    { root: settingsDirectory }
  );

  return settings;
}
