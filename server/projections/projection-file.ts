import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { hasErrorCode } from "../lib/error-code";
import {
  assertRealPathInsideRoot,
  resolveInsideRoot
} from "../lib/path-safety";

export async function readProjectionFile<T>(
  libraryPath: string,
  relativePath: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  const absolutePath = resolveInsideRoot(libraryPath, relativePath);

  try {
    await assertRealPathInsideRoot(libraryPath, absolutePath);
    const parsed: unknown = JSON.parse(await readFile(absolutePath, "utf8"));
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}
