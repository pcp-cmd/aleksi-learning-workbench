import { mkdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hasErrorCode } from "./error-code";
import {
  assertInsideRoot,
  assertRealPathInsideRoot
} from "./path-safety";

export type FilenameErrorCode =
  | "INVALID_FILENAME"
  | "RESERVED_WINDOWS_NAME";

export class FilenameError extends Error {
  readonly code: FilenameErrorCode;

  constructor(code: FilenameErrorCode, message: string) {
    super(message);
    this.name = "FilenameError";
    this.code = code;
  }
}

export interface UniqueMarkdownPathOptions {
  root: string;
}

const INVALID_WINDOWS_CHARACTERS = /[<>:"?*|/\\]+/gu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const RESERVED_WINDOWS_DEVICE =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;

function invalidFilename(message: string): never {
  throw new FilenameError("INVALID_FILENAME", `Invalid filename: ${message}`);
}

export function sanitizeWindowsFilename(title: string): string {
  if (typeof title !== "string") {
    return invalidFilename("title must be a string");
  }
  if (CONTROL_CHARACTERS.test(title)) {
    return invalidFilename("control characters are forbidden");
  }

  const sanitized = title
    .normalize("NFC")
    .trim()
    .replace(INVALID_WINDOWS_CHARACTERS, "-")
    .replace(/-+/gu, "-")
    .trim()
    .replace(/[ .]+$/gu, "");

  if (sanitized.length === 0 || sanitized === "." || sanitized === "..") {
    return invalidFilename("name must not be empty, dot, or dot-dot");
  }

  const deviceStem = (sanitized.split(".", 1)[0] ?? "").trimEnd();
  if (RESERVED_WINDOWS_DEVICE.test(deviceStem)) {
    throw new FilenameError(
      "RESERVED_WINDOWS_NAME",
      "Filename uses a reserved Windows device name"
    );
  }

  return sanitized;
}

export async function allocateUniqueMarkdownPath(
  directory: string,
  baseName: string,
  options: UniqueMarkdownPathOptions
): Promise<string> {
  const safeDirectory = assertInsideRoot(options.root, directory);
  await assertRealPathInsideRoot(options.root, safeDirectory);
  await mkdir(safeDirectory, { recursive: true });
  await assertRealPathInsideRoot(options.root, safeDirectory);
  const sanitizedBaseName = sanitizeWindowsFilename(baseName);

  for (let ordinal = 1; ; ordinal += 1) {
    const suffix = ordinal === 1 ? "" : `-${ordinal}`;
    const candidate = assertInsideRoot(
      options.root,
      join(safeDirectory, `${sanitizedBaseName}${suffix}.md`)
    );

    try {
      const handle = await open(candidate, "wx");
      try {
        await handle.sync();
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(candidate).catch(() => undefined);
        throw error;
      }
      return resolve(candidate);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        continue;
      }
      throw error;
    }
  }
}
