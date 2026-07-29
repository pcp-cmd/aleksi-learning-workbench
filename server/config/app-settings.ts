import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import { isFullyQualifiedAbsolutePath } from "../lib/path-safety";
import type { FaultController } from "../testing/fault-controller";
import {
  appSettingsSchema,
  createAppSettings,
  legacyAppSettingsSchema,
  type AppSettings
} from "./app-settings-schema";

export type { AppSettings } from "./app-settings-schema";

const APP_SETTINGS_DIRECTORY_NAME = "Aleksi Learning Workbench";
const PRIMARY_NAME = "settings.json";
const MIRROR_NAME = "settings.mirror.json";
const HISTORY_NAME = "settings.history.jsonl";
const MAX_HISTORY_RECORDS = 32;
const MAX_HISTORY_BYTES = 256 * 1024;
const MAX_DIAGNOSTICS = 16;
const MAX_RECENT_CANDIDATES = 16;
const MAX_DIAGNOSTIC_FILES = 16;

export class AppSettingsError extends Error {
  readonly code: "INVALID_APP_SETTINGS";

  constructor(message: string) {
    super(message);
    this.name = "AppSettingsError";
    this.code = "INVALID_APP_SETTINGS";
  }
}

type CopyInspection = Readonly<{
  name: typeof PRIMARY_NAME | typeof MIRROR_NAME;
  raw: string | null;
  settings: AppSettings | null;
  legacy: {
    activeVaultPath: string;
    updatedAt: string;
  } | null;
  invalid: boolean;
}>;

export type AppSettingsRecoveryState =
  | Readonly<{
      status: "ready";
      settings: AppSettings;
      recentCandidates: readonly string[];
      diagnostics: readonly string[];
    }>
  | Readonly<{
      status: "recovery-required" | "unconfigured";
      settings: null;
      recentCandidates: readonly string[];
      diagnostics: readonly string[];
    }>;

export function getAppSettingsDirectory(): string {
  if (process.env.ALEKSI_APP_SETTINGS_DIR !== undefined) {
    return resolve(process.env.ALEKSI_APP_SETTINGS_DIR);
  }

  const appDataDirectory =
    process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(appDataDirectory, APP_SETTINGS_DIRECTORY_NAME);
}

export function getAppSettingsPath(): string {
  return join(getAppSettingsDirectory(), PRIMARY_NAME);
}

export function getAppSettingsMirrorPath(): string {
  return join(getAppSettingsDirectory(), MIRROR_NAME);
}

function historyPath(): string {
  return join(getAppSettingsDirectory(), HISTORY_NAME);
}

function diagnosticMessage(label: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `${label}: ${reason}`.slice(0, 2_048);
}

async function inspectCopy(
  name: CopyInspection["name"]
): Promise<CopyInspection> {
  const path = join(getAppSettingsDirectory(), name);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return { name, raw: null, settings: null, legacy: null, invalid: false };
    }
    return { name, raw: null, settings: null, legacy: null, invalid: true };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const current = appSettingsSchema.safeParse(parsed);
    if (current.success) {
      return {
        name,
        raw,
        settings: Object.freeze(current.data),
        legacy: null,
        invalid: false
      };
    }
    const legacy = legacyAppSettingsSchema.safeParse(parsed);
    return legacy.success
      ? {
          name,
          raw,
          settings: null,
          legacy: legacy.data,
          invalid: false
        }
      : { name, raw, settings: null, legacy: null, invalid: true };
  } catch {
    return { name, raw, settings: null, legacy: null, invalid: true };
  }
}

function serialized(settings: AppSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

async function readHistory(
  diagnostics: string[]
): Promise<AppSettings[]> {
  let raw: string;
  try {
    raw = await readFile(historyPath(), "utf8");
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      diagnostics.push(diagnosticMessage("Settings history is unavailable", error));
    }
    return [];
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_HISTORY_BYTES) {
    diagnostics.push("Settings history exceeded its bounded size");
    raw = raw.slice(-MAX_HISTORY_BYTES);
  }
  const records: AppSettings[] = [];
  for (const line of raw.split(/\r?\n/u).filter(Boolean).slice(-MAX_HISTORY_RECORDS)) {
    try {
      const parsed = appSettingsSchema.safeParse(JSON.parse(line));
      if (parsed.success) {
        records.push(Object.freeze(parsed.data));
      }
    } catch {
      diagnostics.push("An invalid settings history record was ignored");
    }
  }
  return records;
}

function recentCandidates(records: readonly AppSettings[]): string[] {
  const candidates: string[] = [];
  for (const record of [...records].reverse()) {
    if (!candidates.includes(record.activeVaultPath)) {
      candidates.push(record.activeVaultPath);
    }
    if (candidates.length >= MAX_RECENT_CANDIDATES) {
      break;
    }
  }
  return candidates;
}

async function pruneDiagnosticFiles(directory: string): Promise<void> {
  const files = (await readdir(directory))
    .filter(
      (name) =>
        name.startsWith("settings.corrupt-") ||
        name.startsWith("settings.recovery-")
    )
    .sort();
  await Promise.all(
    files
      .slice(0, Math.max(0, files.length - MAX_DIAGNOSTIC_FILES))
      .map((name) => rm(join(directory, name), { force: true }))
  );
}

async function hasRecoveryDiagnostics(): Promise<boolean> {
  try {
    return (await readdir(getAppSettingsDirectory())).some((name) =>
      name.startsWith("settings.recovery-")
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    return true;
  }
}

async function quarantineInvalidCopies(
  copies: readonly CopyInspection[],
  diagnostics: string[]
): Promise<void> {
  const invalid = copies.filter((copy) => copy.invalid && copy.raw !== null);
  if (invalid.length === 0) {
    return;
  }
  const directory = getAppSettingsDirectory();
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  for (const copy of invalid) {
    const label = copy.name === PRIMARY_NAME ? "primary" : "mirror";
    const corruptName = `settings.corrupt-${stamp}-${label}.json`;
    try {
      await rename(join(directory, copy.name), join(directory, corruptName));
      diagnostics.push(`Invalid ${label} locator was quarantined`);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        diagnostics.push(diagnosticMessage(`Could not quarantine ${label} locator`, error));
      }
    }
  }
  const diagnosticName = `settings.recovery-${stamp}.json`;
  try {
    await atomicWriteText(
      join(directory, diagnosticName),
      `${JSON.stringify(
        {
          code: "INVALID_APP_SETTINGS",
          recoveredAt: new Date().toISOString(),
          diagnostics: diagnostics.slice(-MAX_DIAGNOSTICS)
        },
        null,
        2
      )}\n`,
      { root: directory }
    );
    await pruneDiagnosticFiles(directory);
  } catch (error) {
    diagnostics.push(diagnosticMessage("Could not persist settings diagnostic", error));
  }
}

async function writeBothCopies(settings: AppSettings): Promise<void> {
  const directory = getAppSettingsDirectory();
  const content = serialized(settings);
  await mkdir(directory, { recursive: true });
  await atomicWriteText(getAppSettingsPath(), content, { root: directory });
  await atomicWriteText(getAppSettingsMirrorPath(), content, { root: directory });
}

async function appendBoundedHistory(
  settings: AppSettings,
  diagnostics: string[]
): Promise<void> {
  const previous = await readHistory(diagnostics);
  const latest = previous.at(-1);
  if (
    latest?.revision === settings.revision &&
    latest.checksum === settings.checksum
  ) {
    return;
  }
  const deduplicated = previous.filter(
    (record) =>
      record.revision !== settings.revision ||
      record.checksum !== settings.checksum
  );
  const retained = [...deduplicated, settings].slice(-MAX_HISTORY_RECORDS);
  const content = `${retained.map((record) => JSON.stringify(record)).join("\n")}\n`;
  try {
    await atomicWriteText(historyPath(), content, {
      root: getAppSettingsDirectory()
    });
  } catch (error) {
    diagnostics.push(diagnosticMessage("Could not persist settings history", error));
  }
}

export async function inspectAppSettingsRecovery(): Promise<AppSettingsRecoveryState> {
  const diagnostics: string[] = [];
  const history = await readHistory(diagnostics);
  const copies = await Promise.all([
    inspectCopy(PRIMARY_NAME),
    inspectCopy(MIRROR_NAME)
  ]);
  await quarantineInvalidCopies(copies, diagnostics);

  const current = copies
    .flatMap((copy) => (copy.settings === null ? [] : [copy.settings]))
    .sort(
      (left, right) =>
        right.revision - left.revision ||
        right.updatedAt.localeCompare(left.updatedAt)
    )[0];
  const legacy = copies.find((copy) => copy.legacy !== null)?.legacy ?? null;
  const selected =
    current ??
    (legacy === null
      ? null
      : createAppSettings({
          schemaVersion: 2,
          revision:
            Math.max(0, ...history.map((record) => record.revision)) + 1,
          activeVaultPath: legacy.activeVaultPath,
          updatedAt: legacy.updatedAt
        }));

  if (selected === null) {
    const candidates = recentCandidates(history);
    const hadInvalidCopy = copies.some((copy) => copy.invalid);
    const hadPriorRecovery = await hasRecoveryDiagnostics();
    return {
      status:
        hadInvalidCopy || hadPriorRecovery || candidates.length > 0
          ? "recovery-required"
          : "unconfigured",
      settings: null,
      recentCandidates: candidates,
      diagnostics: diagnostics.slice(-MAX_DIAGNOSTICS)
    };
  }

  const content = serialized(selected);
  if (copies.some((copy) => copy.raw !== content)) {
    await writeBothCopies(selected);
    diagnostics.push("Mirrored app settings were repaired");
  }
  await appendBoundedHistory(selected, diagnostics);
  return {
    status: "ready",
    settings: selected,
    recentCandidates: recentCandidates([...history, selected]),
    diagnostics: diagnostics.slice(-MAX_DIAGNOSTICS)
  };
}

export async function readAppSettings(): Promise<AppSettings | null> {
  const recovery = await inspectAppSettingsRecovery();
  return recovery.status === "ready" ? recovery.settings : null;
}

export async function writeAppSettings(
  activeVaultPath: string,
  options: { faults?: FaultController } = {}
): Promise<AppSettings> {
  if (!isFullyQualifiedAbsolutePath(activeVaultPath)) {
    throw new AppSettingsError(
      "Invalid app settings: activeVaultPath must be a fully qualified absolute path"
    );
  }
  const directory = getAppSettingsDirectory();
  await mkdir(directory, { recursive: true });
  const recovery = await inspectAppSettingsRecovery();
  const diagnostics = [...recovery.diagnostics];
  const history = await readHistory(diagnostics);
  const revision =
    Math.max(
      recovery.status === "ready" ? recovery.settings.revision : 0,
      ...history.map((record) => record.revision),
      0
    ) + 1;
  let settings: AppSettings;
  try {
    settings = createAppSettings({
      schemaVersion: 2,
      revision,
      activeVaultPath: resolve(activeVaultPath),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    throw new AppSettingsError(
      error instanceof Error
        ? `Invalid app settings: ${error.message}`
        : "Invalid app settings"
    );
  }
  const content = serialized(settings);
  await atomicWriteText(getAppSettingsPath(), content, { root: directory });
  await options.faults?.boundary("app-settings:after-primary-replace");
  await atomicWriteText(getAppSettingsMirrorPath(), content, {
    root: directory
  });
  await options.faults?.boundary("app-settings:after-mirror-replace");
  await appendBoundedHistory(settings, diagnostics);
  return settings;
}
