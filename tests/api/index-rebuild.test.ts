import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import {
  readProjectionHealth,
  recordProjectionFailureHealth
} from "../../server/projections/projection-health";
import {
  LEGACY_CARD_DIRECTORIES,
  READING_DIRECTORY
} from "../../shared/vault-map";
import {
  createTempVaultContext,
  VAULT_FOLDERS,
  writeAppSettings
} from "../temp-vault";

const FOLDERS = {
  reading: READING_DIRECTORY,
  definition: LEGACY_CARD_DIRECTORIES.definition
} as const;

function frontmatterMarkdown(
  data: Record<string, string | boolean | number | null>
): string {
  const lines = Object.entries(data).map(([key, value]) => {
    if (typeof value === "string") {
      return `${key}: ${JSON.stringify(value)}`;
    }
    return `${key}: ${String(value)}`;
  });

  return `---\n${lines.join("\n")}\n---\n\n# Fixture\n`;
}

async function writeMarkdown(
  vaultPath: string,
  relativePath: string,
  data: Record<string, string | boolean | number | null>
): Promise<void> {
  const target = join(vaultPath, ...relativePath.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, frontmatterMarkdown(data), "utf8");
}

async function createInitializedVault(vaultPath: string): Promise<void> {
  for (const folder of VAULT_FOLDERS) {
    await mkdir(join(vaultPath, folder), { recursive: true });
  }

  await writeFile(
    join(vaultPath, ".aleksi", "settings.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        vaultId: "11111111-1111-4111-8111-111111111111"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(vaultPath, ".aleksi", "index.json"),
    `${JSON.stringify(
      {
        generatedAt: "2026-06-22T03:14:15.926Z",
        sourceFingerprint: "0".repeat(64),
        assets: [],
        parseErrors: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(vaultPath, ".aleksi", "review-queue.json"),
    `${JSON.stringify(
      {
        generatedAt: "2026-06-22T03:14:15.926Z",
        sourceIndexFingerprint: "0".repeat(64),
        items: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(vaultPath, ".aleksi", "graph-state.json"),
    `${JSON.stringify(
      {
        generatedAt: "2026-06-22T03:14:15.926Z",
        sourceIndexFingerprint: "0".repeat(64),
        concepts: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function postMaybeBody(
  app: ReturnType<typeof createApp>,
  body: object | undefined
): Promise<SupertestResponse> {
  const builder = request(app).post("/api/index/rebuild");
  return body === undefined ? builder : builder.send(body);
}

describe("index rebuild API", () => {
  it("rebuilds the active Vault index after explicit confirmation", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    await createInitializedVault(vaultPath);
    await writeAppSettings(context.settingsDir, vaultPath);
    await writeMarkdown(vaultPath, `${FOLDERS.reading}/001-reading.md`, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "数列极限入门",
      concept: "数列极限"
    });
    await writeMarkdown(vaultPath, `${FOLDERS.definition}/002-definition.md`, {
      id: "22222222-2222-4222-8222-222222222222",
      type: "definition",
      title: "ε-N 定义",
      concept: "数列极限",
      mastery: "learning",
      nextReview: "2999-01-01"
    });
    await recordProjectionFailureHealth(
      vaultPath,
      "index",
      "55555555-5555-4555-8555-555555555555",
      new Error("previous rebuild failed")
    );

    const response = await request(createApp())
      .post("/api/index/rebuild")
      .send({ confirmed: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      assetCount: 2,
      parseErrorCount: 0,
      recoveredFromCorruption: false
    });
    await expect(
      readFile(join(vaultPath, ".aleksi", "index.json"), "utf8")
    ).resolves.toContain('"assetType": "reading"');
    await expect(readProjectionHealth(vaultPath, "index")).resolves.toMatchObject({
      status: "fresh",
      attempts: 0,
      errorId: null
    });
  });

  it("rejects an active path that exists but is not an initialized Vault", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("NotVault");
    await mkdir(vaultPath, { recursive: true });
    await writeAppSettings(context.settingsDir, vaultPath);

    const response = await request(createApp())
      .post("/api/index/rebuild")
      .send({ confirmed: true });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VAULT_NOT_INITIALIZED",
        message: "Vault is not initialized"
      }
    });
    await expect(readdir(vaultPath)).resolves.not.toContain(".aleksi");
  });

  it("rejects malformed bodies without mutating the index cache", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const indexPath = join(vaultPath, ".aleksi", "index.json");
    const originalCache = `${JSON.stringify(
      {
        generatedAt: "2026-06-22T03:14:15.926Z",
        assets: [],
        parseErrors: []
      },
      null,
      2
    )}\n`;

    await writeAppSettings(context.settingsDir, vaultPath);
    await mkdir(join(vaultPath, ".aleksi"), { recursive: true });
    await writeFile(indexPath, originalCache, "utf8");

    for (const body of [
      undefined,
      {},
      { confirmed: false },
      { confirmed: true, extra: "reject me" }
    ]) {
      const response = await postMaybeBody(createApp(), body);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(response.body).toMatchObject({
        error: {
          code: "INVALID_REQUEST_BODY",
          message: expect.any(String)
        }
      });
      await expect(readFile(indexPath, "utf8")).resolves.toBe(originalCache);
    }
  });
});
