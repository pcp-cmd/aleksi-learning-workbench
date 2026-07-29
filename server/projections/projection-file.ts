import type { z } from "zod";
import {
  BoundedRegularFileError,
  readBoundedRegularFile
} from "../lib/bounded-regular-file";
import { hasErrorCode } from "../lib/error-code";
import { resolveInsideRoot } from "../lib/path-safety";
import { quarantineVaultPath } from "../lib/quarantine";

export const MAX_PROJECTION_JSON_BYTES = 16 * 1024 * 1024;

async function quarantineInvalidProjection(
  libraryPath: string,
  relativePath: string
): Promise<void> {
  await quarantineVaultPath(
    libraryPath,
    "projections",
    relativePath,
    "INVALID_PROJECTION_FILE"
  );
}

export class ProjectionFileError extends Error {
  readonly code:
    | "PROJECTION_FILE_TOO_LARGE"
    | "INVALID_PROJECTION_FILE";
  readonly status: number;

  constructor(
    code: ProjectionFileError["code"],
    message: string
  ) {
    super(message);
    this.name = "ProjectionFileError";
    this.code = code;
    this.status = code === "PROJECTION_FILE_TOO_LARGE" ? 413 : 400;
  }
}

export async function readProjectionFile<T>(
  libraryPath: string,
  relativePath: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  const absolutePath = resolveInsideRoot(libraryPath, relativePath);

  try {
    const file = await readBoundedRegularFile(
      libraryPath,
      absolutePath,
      {
        maxBytes: MAX_PROJECTION_JSON_BYTES,
        label: `Projection ${relativePath}`
      }
    );
    const parsed: unknown = JSON.parse(file.data.toString("utf8"));
    const result = schema.safeParse(parsed);
    if (!result.success) {
      await quarantineInvalidProjection(libraryPath, relativePath);
      return null;
    }
    return result.data;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    if (error instanceof SyntaxError) {
      await quarantineInvalidProjection(libraryPath, relativePath);
      return null;
    }
    if (error instanceof BoundedRegularFileError) {
      throw new ProjectionFileError(
        error.code === "FILE_TOO_LARGE"
          ? "PROJECTION_FILE_TOO_LARGE"
          : "INVALID_PROJECTION_FILE",
        error.message
      );
    }
    throw error;
  }
}
