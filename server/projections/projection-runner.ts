import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { atomicWriteText } from "../lib/atomic-write";
import { resolveInsideRoot } from "../lib/path-safety";
import { withProcessKeyLock } from "../lib/process-key-lock";
import { rebuildIndex } from "../services/index-service";
import type { ProjectionOutcome } from "./projection-types";

const PROJECTION_STATE_DIRECTORY = ".aleksi/projections";

function pendingProjectionPath(vaultPath: string, projection: string): string {
  return resolveInsideRoot(
    vaultPath,
    `${PROJECTION_STATE_DIRECTORY}/${projection}.pending.json`
  );
}

async function recordProjectionFailure(
  vaultPath: string,
  errorId: string,
  projection: string
): Promise<void> {
  const directory = resolveInsideRoot(vaultPath, PROJECTION_STATE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  await atomicWriteText(
    pendingProjectionPath(vaultPath, projection),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projection,
        errorId,
        status: "stale",
        requestedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    { root: vaultPath }
  );
}

export async function refreshIndexProjection(
  vaultPath: string
): Promise<ProjectionOutcome> {
  return withProcessKeyLock(`projection:index:${vaultPath}`, async () => {
    try {
      await rebuildIndex(vaultPath);
      await rm(pendingProjectionPath(vaultPath, "index"), {
        force: true
      });
      return {
        projectionStatus: "fresh",
        projectionErrorId: null
      };
    } catch {
      const projectionErrorId = randomUUID();
      await recordProjectionFailure(
        vaultPath,
        projectionErrorId,
        "index"
      ).catch(() => undefined);
      return {
        projectionStatus: "stale",
        projectionErrorId
      };
    }
  });
}
