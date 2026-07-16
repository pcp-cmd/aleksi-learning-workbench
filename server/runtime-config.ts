import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_SERVER_PORT = 5174;

const PORT_ERROR =
  "ALEKSI_SERVER_PORT must be an integer between 1 and 65535";
const DESKTOP_PORT_ERROR =
  "ALEKSI_SERVER_PORT must be 0 or an integer between 1 and 65535";

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

export function loadEnvFileIfPresent(
  envFilePath = resolve(process.cwd(), ".env")
): boolean {
  if (!existsSync(envFilePath)) {
    return false;
  }

  process.loadEnvFile(envFilePath);
  return true;
}
