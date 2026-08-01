import { z } from "zod";
import { atomicWriteText } from "../lib/atomic-write";
import { resolveInsideRoot } from "../lib/path-safety";
import { readProjectionFile } from "./projection-file";
import type { ProjectionHealth } from "./projection-types";

const projectionHealthSchema = z
  .object({
    schemaVersion: z.literal(1),
    projection: z.string().regex(/^[a-z0-9-]+$/u),
    status: z.enum(["fresh", "stale"]),
    attempts: z.number().int().nonnegative(),
    firstFailureAt: z.string().datetime({ offset: true }).nullable(),
    lastFailureAt: z.string().datetime({ offset: true }).nullable(),
    lastSuccessfulRebuildAt: z.string().datetime({ offset: true }).nullable(),
    errorId: z.string().uuid().nullable(),
    category: z.string().regex(/^[A-Z0-9_]+$/u).nullable(),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

const memoryHealth = new Map<string, ProjectionHealth>();

function healthRelativePath(projection: string): string {
  return `.aleksi/projections/${projection}.health.json`;
}

function key(vaultPath: string, projection: string): string {
  return `${resolveInsideRoot(vaultPath)}\0${projection}`;
}

function categoryFor(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]+$/u.test(error.code)
  ) {
    return error.code;
  }
  return "PROJECTION_REBUILD_FAILED";
}

async function persistHealth(
  vaultPath: string,
  health: ProjectionHealth
): Promise<void> {
  memoryHealth.set(key(vaultPath, health.projection), health);
  await atomicWriteText(
    resolveInsideRoot(vaultPath, healthRelativePath(health.projection)),
    `${JSON.stringify(projectionHealthSchema.parse(health), null, 2)}\n`,
    { root: vaultPath }
  );
}

export async function readProjectionHealth(
  vaultPath: string,
  projection: string
): Promise<ProjectionHealth | null> {
  const disk = await readProjectionFile(
    vaultPath,
    healthRelativePath(projection),
    projectionHealthSchema
  ).catch(() => null);
  return disk ?? memoryHealth.get(key(vaultPath, projection)) ?? null;
}

export async function recordProjectionFailureHealth(
  vaultPath: string,
  projection: string,
  errorId: string,
  error: unknown
): Promise<ProjectionHealth> {
  const previous = await readProjectionHealth(vaultPath, projection);
  const now = new Date().toISOString();
  const health: ProjectionHealth = Object.freeze({
    schemaVersion: 1,
    projection,
    status: "stale",
    attempts: (previous?.attempts ?? 0) + 1,
    firstFailureAt: previous?.firstFailureAt ?? now,
    lastFailureAt: now,
    lastSuccessfulRebuildAt: previous?.lastSuccessfulRebuildAt ?? null,
    errorId,
    category: categoryFor(error),
    updatedAt: now
  });
  await persistHealth(vaultPath, health).catch(() => undefined);
  return health;
}

export async function recordProjectionSuccessHealth(
  vaultPath: string,
  projection: string
): Promise<ProjectionHealth> {
  const now = new Date().toISOString();
  const health: ProjectionHealth = Object.freeze({
    schemaVersion: 1,
    projection,
    status: "fresh",
    attempts: 0,
    firstFailureAt: null,
    lastFailureAt: null,
    lastSuccessfulRebuildAt: now,
    errorId: null,
    category: null,
    updatedAt: now
  });
  await persistHealth(vaultPath, health).catch(() => undefined);
  return health;
}

export function clearProjectionHealthMemoryForTests(): void {
  memoryHealth.clear();
}
