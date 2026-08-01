import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_SERVER_PORT = 5174;
export const DESKTOP_PROTOCOL_VERSION = "1" as const;

const PORT_ERROR =
  "ALEKSI_SERVER_PORT must be an integer between 1 and 65535";
const DESKTOP_PORT_ERROR =
  "ALEKSI_SERVER_PORT must be 0 or an integer between 1 and 65535";
const DESKTOP_PARENT_PID_ERROR =
  "ALEKSI_DESKTOP_PARENT_PID must be an integer between 1 and 4294967295";
const DESKTOP_IDENTITY_VALUE = /^[a-z0-9.-]+$/u;
const DESKTOP_PROTOCOL_SECRET = /^[a-f0-9]{64}$/u;

export type DesktopRuntimeConfig = {
  appVersion: string;
  legacyBuildId?: string;
  parentPid: number;
  port: number;
  protocolSecret: string;
  protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  shellBuildId: string;
  sidecarBuildId: string;
};

function parsePortValue(value: string, minimum: 0 | 1, message: string): number {
  const normalizedValue = value.trim();

  if (!/^\d+$/u.test(normalizedValue)) {
    throw new Error(message);
  }

  const port = Number(normalizedValue);
  if (!Number.isInteger(port) || port < minimum || port > 65_535) {
    throw new Error(message);
  }

  return port;
}

function parseDesktopParentPid(value: string | undefined): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new Error(DESKTOP_PARENT_PID_ERROR);
  }
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0xffff_ffff) {
    throw new Error(DESKTOP_PARENT_PID_ERROR);
  }
  return pid;
}

export function parseServerPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_SERVER_PORT;
  }

  return parsePortValue(value, 1, PORT_ERROR);
}

export function parseDesktopServerPort(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  return parsePortValue(value, 0, DESKTOP_PORT_ERROR);
}

function requiredDesktopValue(
  env: Record<string, string | undefined>,
  name: string,
  pattern: RegExp,
  requirement: string
): string {
  const value = env[name];
  if (value === undefined || !pattern.test(value)) {
    throw new Error(`${name} ${requirement}`);
  }

  return value;
}

function optionalDesktopIdentityValue(
  env: Record<string, string | undefined>,
  name: string
): string | undefined {
  const value = env[name];
  if (value === undefined) {
    return undefined;
  }
  if (!DESKTOP_IDENTITY_VALUE.test(value)) {
    throw new Error(
      `${name} must contain only lowercase ASCII letters, digits, dots, and hyphens`
    );
  }

  return value;
}

export function parseDesktopRuntimeConfig(
  env: Record<string, string | undefined>
): DesktopRuntimeConfig {
  const protocolVersion = requiredDesktopValue(
    env,
    "ALEKSI_PROTOCOL_VERSION",
    /^1$/u,
    `must be ${DESKTOP_PROTOCOL_VERSION}`
  ) as typeof DESKTOP_PROTOCOL_VERSION;
  const config: DesktopRuntimeConfig = {
    appVersion: requiredDesktopValue(
      env,
      "ALEKSI_APP_VERSION",
      DESKTOP_IDENTITY_VALUE,
      "must contain only lowercase ASCII letters, digits, dots, and hyphens"
    ),
    parentPid: parseDesktopParentPid(env.ALEKSI_DESKTOP_PARENT_PID),
    port: parseDesktopServerPort(env.ALEKSI_SERVER_PORT),
    protocolSecret: requiredDesktopValue(
      env,
      "ALEKSI_PROTOCOL_SECRET",
      DESKTOP_PROTOCOL_SECRET,
      "must be a 256-bit lowercase hexadecimal value"
    ),
    protocolVersion,
    shellBuildId: requiredDesktopValue(
      env,
      "ALEKSI_SHELL_BUILD_ID",
      DESKTOP_IDENTITY_VALUE,
      "must contain only lowercase ASCII letters, digits, dots, and hyphens"
    ),
    sidecarBuildId: requiredDesktopValue(
      env,
      "ALEKSI_SIDECAR_BUILD_ID",
      DESKTOP_IDENTITY_VALUE,
      "must contain only lowercase ASCII letters, digits, dots, and hyphens"
    )
  };
  const legacyBuildId = optionalDesktopIdentityValue(env, "ALEKSI_BUILD_ID");
  if (legacyBuildId !== undefined) {
    config.legacyBuildId = legacyBuildId;
  }

  return config;
}

export function loadEnvFileIfPresent(
  envFilePath = resolve(process.cwd(), ".env")
): boolean {
  if (!existsSync(envFilePath)) {
    return false;
  }

  process.loadEnvFile(envFilePath);
  return true;
}
