import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  writeFile
} from "node:fs/promises";
import { join, sep } from "node:path";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { rebuildIndex } from "../../server/services/index-service";
import {
  CODEX_TASK_DIRECTORY,
  READING_DIRECTORY
} from "../../shared/vault-map";
import {
  createTempVaultContext,
  readJsonFile,
  writeAppSettings
} from "../temp-vault";

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type IndexJson = {
  assets: Array<{
    id: string;
    assetType: string;
    title: string;
    concept: string | null;
    relativePath: string;
    updatedAt: string;
  }>;
};

type IndexAsset = IndexJson["assets"][number] & {
  mastery: null;
  nextReview: null;
  archived: false;
};

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../server/lib/atomic-write");
  vi.doUnmock("../../server/services/index-service");
  vi.doUnmock("node:fs/promises");
  vi.restoreAllMocks();
});

async function initializeActiveVault(): Promise<{
  app: ReturnType<typeof createApp>;
  vaultPath: string;
}> {
  const context = await createTempVaultContext();
  const vaultPath = context.path("Vault");
  const app = createApp();
  const initialize = await request(app)
    .post("/api/vault/initialize")
    .send({ path: vaultPath });

  expect(initialize.status).toBe(200);
  return { app, vaultPath };
}

async function postMaybeBody(
  app: ReturnType<typeof createApp>,
  body: object | undefined
): Promise<SupertestResponse> {
  const builder = request(app).post("/api/readings");
  return body === undefined ? builder : builder.send(body);
}

async function readingFilenames(vaultPath: string): Promise<string[]> {
  return (await readdir(join(vaultPath, READING_DIRECTORY))).sort();
}

function expectApiError(
  response: SupertestResponse,
  code = "INVALID_REQUEST_BODY"
): void {
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  expect(response.body).toMatchObject({
    error: {
      code,
      message: expect.any(String)
    }
  });
}

function expectNoVaultPathLeak(
  response: SupertestResponse,
  vaultPath: string
): void {
  const serialized = JSON.stringify(response.body).replace(/\\\\/g, "\\");
  expect(serialized).not.toContain(vaultPath);
}

function readingAsset(overrides: Partial<IndexAsset> = {}): IndexAsset {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    assetType: "reading",
    title: "数列极限 ε-N 定义",
    concept: "数列极限",
    relativePath: `${READING_DIRECTORY}/数列极限-epsilon-n-定义.md`,
    updatedAt: "2026-06-22T03:14:15.926Z",
    mastery: null,
    nextReview: null,
    archived: false,
    ...overrides
  };
}

async function writeIndex(
  vaultPath: string,
  assets: IndexAsset[]
): Promise<void> {
  const baseline = await rebuildIndex(vaultPath);
  await writeFile(
    join(vaultPath, ".aleksi", "index.json"),
    `${JSON.stringify(
      {
        generatedAt: "2026-06-22T03:14:15.926Z",
        sourceFingerprint: baseline.index.sourceFingerprint,
        assets,
        parseErrors: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function extractFrontmatterString(raw: string, key: string): string {
  const match = new RegExp(`^${key}: "([^"]+)"$`, "mu").exec(raw);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

describe("readings API", () => {
  it("creates a UTF-8 LF Markdown reading, returns generated metadata, and rebuilds the index", async () => {
    const { app, vaultPath } = await initializeActiveVault();

    const response = await request(app).post("/api/readings").send({
      title: " 数列极限 ε-N 定义 ",
      concept: " 数列极限 ",
      body: "行内公式：$x_n \\to a$\r\n\r\n$$\r\n\\forall \\varepsilon > 0,\r\n$$",
      source: "manual-paste"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      reading: {
        id: expect.stringMatching(UUID_V4),
        type: "reading",
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        source: "manual-paste",
        createdAt: expect.stringMatching(ISO_UTC_MS),
        relativePath: `${READING_DIRECTORY}/数列极限 ε-N 定义.md`,
        modifiedAt: expect.stringMatching(ISO_UTC_MS),
        version: {
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
          size: expect.any(Number),
          mtimeNs: expect.stringMatching(/^\d+$/u),
          inode: expect.stringMatching(/^\d+$/u)
        }
      },
      saveReceipt: {
        relativePath: `${READING_DIRECTORY}/数列极限 ε-N 定义.md`,
        modifiedAt: expect.stringMatching(ISO_UTC_MS)
      },
      projectionStatus: "fresh",
      projectionErrorId: null
    });

    const targetPath = join(
      vaultPath,
      READING_DIRECTORY,
      "数列极限 ε-N 定义.md"
    );
    const fileStats = await stat(targetPath);
    expect(response.body.saveReceipt.modifiedAt).toBe(
      fileStats.mtime.toISOString()
    );

    const raw = await readFile(targetPath, "utf8");
    expect(raw).not.toContain("\r");
    expect(raw).toBe(
      `---\n` +
        `id: "${response.body.reading.id}"\n` +
        `type: "reading"\n` +
        `title: "数列极限 ε-N 定义"\n` +
        `concept: "数列极限"\n` +
        `source: "manual-paste"\n` +
        `createdAt: "${response.body.reading.createdAt}"\n` +
        `---\n\n` +
        `# 数列极限 ε-N 定义\n\n` +
        `行内公式：$x_n \\to a$\n\n` +
        `$$\n` +
        `\\forall \\varepsilon > 0,\n` +
        `$$\n`
    );

    const index = await readJsonFile<IndexJson>(
      join(vaultPath, ".aleksi", "index.json")
    );
    expect(index.assets).toContainEqual({
      id: response.body.reading.id,
      assetType: "reading",
      title: "数列极限 ε-N 定义",
      concept: "数列极限",
      relativePath: `${READING_DIRECTORY}/数列极限 ε-N 定义.md`,
      mastery: null,
      nextReview: null,
      updatedAt: response.body.saveReceipt.modifiedAt,
      archived: false
    });
  });

  it("preserves the browser-available source file name without accepting a fake local path", async () => {
    const { app, vaultPath } = await initializeActiveVault();

    const response = await request(app).post("/api/readings").send({
      title: "导入的拓扑材料",
      concept: "拓扑",
      body: "# 拓扑\n\n正文",
      source: "file-import",
      sourceFileName: "拓扑讲义.markdown"
    });

    expect(response.status).toBe(200);
    expect(response.body.reading).toMatchObject({
      source: "file-import",
      sourceFileName: "拓扑讲义.markdown"
    });
    const raw = await readFile(
      join(vaultPath, ...String(response.body.reading.relativePath).split("/")),
      "utf8"
    );
    expect(raw).toContain('sourceFileName: "拓扑讲义.markdown"');
    expect(raw).not.toContain("C:\\");
  });

  it("returns list entries from the rebuilt index and raw Markdown by id unchanged from disk", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    const created = await request(app).post("/api/readings").send({
      title: "数列极限 ε-N 定义",
      concept: "数列极限",
      body: "行内公式：$x_n \\to a$\n\n$$\n\\forall \\varepsilon > 0\n$$",
      source: "manual-paste"
    });
    expect(created.status).toBe(200);

    const list = await request(app).get("/api/readings");
    expect(list.status).toBe(200);
    expect(list.body.readings).toContainEqual(
      {
        id: created.body.reading.id,
        type: "reading",
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        relativePath: `${READING_DIRECTORY}/数列极限 ε-N 定义.md`,
        updatedAt: created.body.saveReceipt.modifiedAt
      }
    );

    const targetPath = join(
      vaultPath,
      READING_DIRECTORY,
      "数列极限 ε-N 定义.md"
    );
    const rawFromDisk = await readFile(targetPath, "utf8");
    const getById = await request(app).get(
      `/api/readings/${created.body.reading.id}`
    );

    expect(getById.status).toBe(200);
    expect(getById.body).toEqual({
      reading: {
        id: created.body.reading.id,
        type: "reading",
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        relativePath: `${READING_DIRECTORY}/数列极限 ε-N 定义.md`,
        updatedAt: created.body.saveReceipt.modifiedAt,
        rawMarkdown: rawFromDisk,
        version: created.body.reading.version
      }
    });
  });

  it("lists and fetches a test-fixture reading by its stable UUID", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    const templateRaw = await readFile(
      join(
        process.cwd(),
        "tests",
        "fixtures",
        "epsilon-n-reading.md"
      ),
      "utf8"
    );
    const id = extractFrontmatterString(templateRaw, "id");
    const title = extractFrontmatterString(templateRaw, "title");
    const concept = extractFrontmatterString(templateRaw, "concept");
    const relativePath = `${READING_DIRECTORY}/sequence-limit-epsilon-n.md`;
    const targetPath = join(vaultPath, ...relativePath.split("/"));
    await writeFile(targetPath, templateRaw, "utf8");
    const updatedAt = (await stat(targetPath)).mtime.toISOString();
    await writeIndex(vaultPath, [
      readingAsset({ id, title, concept, relativePath, updatedAt })
    ]);

    expect(id).toMatch(UUID_V4);

    const list = await request(app).get("/api/readings");
    const getById = await request(app).get(`/api/readings/${id}`);

    expect(list.status).toBe(200);
    expect(list.body.readings).toEqual([
      {
        id,
        type: "reading",
        title,
        concept,
        relativePath,
        updatedAt
      }
    ]);
    expect(getById.status).toBe(200);
    expect(getById.body.reading.rawMarkdown).toBe(templateRaw);
  });

  it("serves safe reading-relative raster images without exposing other Vault files", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    const id = crypto.randomUUID();
    const relativePath = `${READING_DIRECTORY}/media-note.md`;
    const readingPath = join(vaultPath, ...relativePath.split("/"));
    const imageDirectory = join(vaultPath, READING_DIRECTORY, "assets");
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

    await mkdir(imageDirectory, { recursive: true });
    await writeFile(readingPath, "# Media note\n\n![Diagram](assets/diagram.png)\n");
    await writeFile(join(imageDirectory, "diagram.png"), imageBytes);
    await writeFile(join(imageDirectory, "My Diagram.png"), imageBytes);
    await writeFile(join(imageDirectory, "oversized.png"), Buffer.alloc(0));
    await truncate(
      join(imageDirectory, "oversized.png"),
      10 * 1024 * 1024 + 1
    );
    await writeIndex(vaultPath, [readingAsset({ id, relativePath })]);

    const image = await request(app)
      .get(`/api/readings/${id}/media`)
      .query({ path: "assets/diagram.png" });

    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toMatch(/^image\/png/u);
    expect(image.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.from(image.body)).toEqual(imageBytes);

    for (const path of [
      "assets/My%20Diagram.png",
      "assets/diagram.png?cache=1#preview"
    ] as const) {
      const compatibleImage = await request(app)
        .get(`/api/readings/${id}/media`)
        .query({ path });
      expect(compatibleImage.status).toBe(200);
      expect(Buffer.from(compatibleImage.body)).toEqual(imageBytes);
    }

    for (const path of [
      "../../.aleksi/index.json",
      "media-note.md",
      "assets%2Fdiagram.png",
      "assets/%E0%A4%A.png",
      "assets/oversized.png"
    ] as const) {
      const response = await request(app)
        .get(`/api/readings/${id}/media`)
        .query({ path });
      expectApiError(response, "INVALID_READING_ASSET");
      expectNoVaultPathLeak(response, vaultPath);
    }

    const missing = await request(app)
      .get(`/api/readings/${id}/media`)
      .query({ path: "assets/missing.png" });
    expectApiError(missing, "READING_ASSET_NOT_FOUND");
    expect(missing.status).toBe(404);
    expectNoVaultPathLeak(missing, vaultPath);
  });

  it("rejects a reading image if its path identity changes after the file is opened", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const imagePath = join(vaultPath, READING_DIRECTORY, "assets", "race.png");
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    let swapped = false;

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      open: async (...args: Parameters<typeof originalFs.open>) => {
        const file = await originalFs.open(...args);
        if (!swapped && String(args[0]) === imagePath) {
          swapped = true;
          await originalFs.rename(imagePath, `${imagePath}.opened`);
          await originalFs.writeFile(imagePath, Buffer.from("replacement"));
        }
        return file;
      }
    }));

    const { createApp: createRaceAwareApp } = await import("../../server/app");
    const app = createRaceAwareApp();
    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);

    const id = crypto.randomUUID();
    const relativePath = `${READING_DIRECTORY}/race-note.md`;
    await mkdir(join(vaultPath, READING_DIRECTORY, "assets"), { recursive: true });
    await writeFile(join(vaultPath, READING_DIRECTORY, "race-note.md"), "# Race\n");
    await writeFile(imagePath, Buffer.from("original"));
    await writeIndex(vaultPath, [readingAsset({ id, relativePath })]);

    const response = await request(app)
      .get(`/api/readings/${id}/media`)
      .query({ path: "assets/race.png" });

    expect(swapped).toBe(true);
    expectApiError(response, "INVALID_READING_ASSET");
    expectNoVaultPathLeak(response, vaultPath);
  });

  it("rejects reading Markdown if its path identity changes after the file is opened", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${READING_DIRECTORY}/race-markdown.md`;
    const markdownPath = join(
      vaultPath,
      READING_DIRECTORY,
      "race-markdown.md"
    );
    const openedPath = `${markdownPath}.opened`;
    const originalMarkdown = "# ORIGINAL_MARKDOWN_SECRET\n";
    const replacementMarkdown = "# REPLACEMENT_MARKDOWN_SECRET\n";
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    let swapped = false;

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      open: async (...args: Parameters<typeof originalFs.open>) => {
        const file = await originalFs.open(...args);
        if (!swapped && String(args[0]) === markdownPath) {
          swapped = true;
          await originalFs.rename(markdownPath, openedPath);
          await originalFs.writeFile(
            markdownPath,
            replacementMarkdown,
            "utf8"
          );
        }
        return file;
      }
    }));

    const { createApp: createRaceAwareApp } = await import("../../server/app");
    const app = createRaceAwareApp();
    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);

    const id = crypto.randomUUID();
    await originalFs.mkdir(join(vaultPath, READING_DIRECTORY), {
      recursive: true
    });
    await originalFs.writeFile(markdownPath, originalMarkdown, "utf8");
    await writeIndex(vaultPath, [readingAsset({ id, relativePath })]);

    const response = await request(app).get(`/api/readings/${id}`);

    expect(swapped).toBe(true);
    expectApiError(response, "INVALID_INDEX_CACHE");
    expectNoVaultPathLeak(response, vaultPath);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("rawMarkdown");
    expect(serialized).not.toContain("ORIGINAL_MARKDOWN_SECRET");
    expect(serialized).not.toContain("REPLACEMENT_MARKDOWN_SECRET");
    await expect(originalFs.readFile(openedPath, "utf8")).resolves.toBe(
      originalMarkdown
    );
    await expect(originalFs.readFile(markdownPath, "utf8")).resolves.toBe(
      replacementMarkdown
    );
  });

  it("rejects index reading entries outside the readings directory without returning raw file contents", async () => {
    const { app, vaultPath } = await initializeActiveVault();

    for (const relativePath of [
      ".aleksi/index.json",
      "02-定义卡/not-a-reading.md"
    ]) {
      const id = crypto.randomUUID();
      await writeIndex(vaultPath, [readingAsset({ id, relativePath })]);

      const list = await request(app).get("/api/readings");
      const getById = await request(app).get(`/api/readings/${id}`);

      expectApiError(list, "INVALID_INDEX_CACHE");
      expectApiError(getById, "INVALID_INDEX_CACHE");
      expect(JSON.stringify(list.body)).not.toContain("rawMarkdown");
      expect(JSON.stringify(getById.body)).not.toContain("rawMarkdown");
      expect(JSON.stringify(getById.body)).not.toContain("generatedAt");
    }
  });

  it("ignores non-reading index assets with non-UUID ids while listing readings", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    const reading = readingAsset();
    await writeIndex(vaultPath, [
      reading,
      {
        id: "task-with-concept",
        assetType: "codex-task",
        title: "Codex task",
        concept: "数列极限",
        relativePath: `${CODEX_TASK_DIRECTORY}/task-with-concept.md`,
        updatedAt: "2026-06-22T03:14:15.926Z",
        mastery: null,
        nextReview: null,
        archived: false
      }
    ]);

    const response = await request(app).get("/api/readings");

    expect(response.status).toBe(200);
    expect(response.body.readings).toEqual([
      {
        id: reading.id,
        type: "reading",
        title: reading.title,
        concept: reading.concept,
        relativePath: reading.relativePath,
        updatedAt: reading.updatedAt
      }
    ]);
  });

  it("recovers corrupt indexes and returns safe errors for missing indexed files", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    await writeFile(join(vaultPath, ".aleksi", "index.json"), "{", "utf8");

    const corruptIndex = await request(app).get("/api/readings");

    expect(corruptIndex.status).toBe(200);
    expect(corruptIndex.body.readings).toEqual([]);
    expectNoVaultPathLeak(corruptIndex, vaultPath);
    expect(
      (await readdir(join(vaultPath, ".aleksi"))).some((name) =>
        /^index\.corrupt-.+\.json$/u.test(name)
      )
    ).toBe(true);

    const missingId = "22222222-2222-4222-8222-222222222222";
    await writeIndex(vaultPath, [
      readingAsset({
        id: missingId,
        relativePath: `${READING_DIRECTORY}/missing.md`
      })
    ]);

    const missingFile = await request(app).get(`/api/readings/${missingId}`);

    expectApiError(missingFile, "READING_NOT_FOUND");
    expectNoVaultPathLeak(missingFile, vaultPath);
  });

  it("returns a safe error without a Vault absolute path when the index cache is missing", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    await rm(join(vaultPath, ".aleksi", "index.json"));

    const response = await request(app).get("/api/readings");

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.error.code).toBe("VAULT_NOT_INITIALIZED");
    expectNoVaultPathLeak(response, vaultPath);
  });

  it("resolves filename collisions without overwriting the first reading", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    const body = {
      title: "数列极限 ε-N 定义",
      concept: "数列极限",
      body: "first body",
      source: "manual-paste"
    } as const;

    const first = await request(app).post("/api/readings").send(body);
    const second = await request(app)
      .post("/api/readings")
      .send({ ...body, body: "second body" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.reading.relativePath).toBe(
      `${READING_DIRECTORY}/数列极限 ε-N 定义.md`
    );
    expect(second.body.reading.relativePath).toBe(
      `${READING_DIRECTORY}/数列极限 ε-N 定义-2.md`
    );
    expect(await readingFilenames(vaultPath)).toEqual([
      "数列极限 ε-N 定义-2.md",
      "数列极限 ε-N 定义.md"
    ]);
    await expect(
      readFile(join(vaultPath, READING_DIRECTORY, "数列极限 ε-N 定义.md"), "utf8")
    ).resolves.toContain("first body");
    await expect(
      readFile(
        join(vaultPath, READING_DIRECTORY, "数列极限 ε-N 定义-2.md"),
        "utf8"
      )
    ).resolves.toContain("second body");
  });

  it("replaces an explicitly selected duplicate while preserving its id, path, and creation time", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    const first = await request(app).post("/api/readings").send({
      title: "积分基础",
      concept: "积分基础",
      body: "original body",
      source: "manual-paste"
    });
    expect(first.status).toBe(200);

    const replacement = await request(app).post("/api/readings").send({
      title: "积分基础",
      concept: "积分基础",
      body: "replacement body",
      source: "file-import",
      sourceFileName: "积分基础.md",
      conflictMode: "replace",
      replaceReadingId: first.body.reading.id,
      expectedVersion: first.body.reading.version
    });

    expect(replacement.status).toBe(200);
    expect(replacement.body.reading).toMatchObject({
      id: first.body.reading.id,
      relativePath: first.body.reading.relativePath,
      createdAt: first.body.reading.createdAt,
      source: "file-import",
      sourceFileName: "积分基础.md"
    });
    const raw = await readFile(
      join(vaultPath, ...String(first.body.reading.relativePath).split("/")),
      "utf8"
    );
    expect(raw).toContain('source: "file-import"');
    expect(raw).toContain('sourceFileName: "积分基础.md"');
    expect(raw).toContain("replacement body");
    expect(raw).not.toContain("original body");

    const mismatch = await request(app).post("/api/readings").send({
      title: "另一个标题",
      concept: "积分基础",
      body: "must not write",
      source: "file-import",
      conflictMode: "replace",
      replaceReadingId: first.body.reading.id,
      expectedVersion: replacement.body.reading.version
    });
    expectApiError(mismatch, "READING_REPLACE_CONFLICT");
    expect(mismatch.status).toBe(409);
    await expect(
      readFile(join(vaultPath, ...String(first.body.reading.relativePath).split("/")), "utf8")
    ).resolves.not.toContain("must not write");
  });

  it("retains a recovery journal when the authoritative content write fails", async () => {
    vi.resetModules();
    vi.doMock("../../server/lib/atomic-write", async () => {
      const original =
        await vi.importActual<typeof import("../../server/lib/atomic-write")>(
          "../../server/lib/atomic-write"
        );

      return {
        ...original,
        atomicWriteText: vi.fn(
          async (
            target: string,
            content: string,
            options: Parameters<typeof original.atomicWriteText>[2]
          ) => {
            if (target.includes(`${READING_DIRECTORY}${sep}`)) {
              throw new Error(`write failed at ${target}`);
            }
            return original.atomicWriteText(target, content, options);
          }
        )
      };
    });
    const { createApp: createMockedApp } = await import("../../server/app");
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const app = createMockedApp();
    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);
    const before = await readingFilenames(vaultPath);

    const response = await request(app).post("/api/readings").send({
      title: "数列极限 ε-N 定义",
      concept: "数列极限",
      body: "content",
      source: "manual-paste"
    });

    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error"
    });
    expectNoVaultPathLeak(response, vaultPath);
    expect(await readingFilenames(vaultPath)).toHaveLength(before.length + 1);
    expect(
      await readdir(join(vaultPath, ".aleksi", "transactions"))
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\.json$/u),
        expect.stringMatching(/\.mirror$/u)
      ])
    );
  });

  it("keeps the newly written reading when index rebuild fails", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const initialize = await request(createApp())
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);

    vi.resetModules();
    vi.doMock("../../server/services/index-service", async () => {
      const original =
        await vi.importActual<typeof import("../../server/services/index-service")>(
          "../../server/services/index-service"
        );

      return {
        ...original,
        rebuildIndex: vi.fn(async () => {
          throw new Error("rebuild failed");
        })
      };
    });
    const { createApp: createMockedApp } = await import("../../server/app");
    const app = createMockedApp();
    const before = await readingFilenames(vaultPath);

    const response = await request(app).post("/api/readings").send({
      title: "数列极限 ε-N 定义",
      concept: "数列极限",
      body: "content",
      source: "manual-paste"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reading: {
        relativePath: expect.stringMatching(/^01-阅读材料\/.+\.md$/u)
      },
      projectionStatus: "stale",
      projectionErrorId: expect.stringMatching(UUID_V4)
    });
    expect(await readingFilenames(vaultPath)).toHaveLength(before.length + 1);
  });

  it("rejects empty title or concept and strict server-owned fields without mutation", async () => {
    const { app, vaultPath } = await initializeActiveVault();
    const before = await readingFilenames(vaultPath);

    const invalidBodies: object[] = [
      {
        title: " ",
        concept: "数列极限",
        body: "content",
        source: "manual-paste"
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "",
        body: "content",
        source: "manual-paste"
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        body: "content",
        source: "manual-paste",
        sourceFileName: "不应出现.md"
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        body: "content",
        source: "file-import",
        sourceFileName: "C:\\Users\\pcp\\材料.md"
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        body: "content",
        source: "file-import",
        sourceFileName: "材料.pdf"
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        body: "content",
        source: "manual-paste",
        id: "client-owned"
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        body: "content",
        source: "manual-paste",
        relativePath: `${READING_DIRECTORY}/evil.md`
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        body: "content",
        source: "manual-paste",
        absolutePath: join(vaultPath, READING_DIRECTORY, "evil.md")
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        body: "content",
        source: "manual-paste",
        filename: "evil.md"
      },
      {
        title: "数列极限 ε-N 定义",
        concept: "数列极限",
        body: "content",
        source: "manual-paste",
        createdAt: "2026-06-22T03:14:15.926Z"
      }
    ];

    for (const invalidBody of invalidBodies) {
      const response = await postMaybeBody(app, invalidBody);
      expectApiError(response);
      expect(await readingFilenames(vaultPath)).toEqual(before);
    }
  });

  it("rejects create and read requests when the active path is not an initialized Vault", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("NotVault");
    await mkdir(vaultPath, { recursive: true });
    await writeAppSettings(context.settingsDir, vaultPath);
    const app = createApp();

    const create = await request(app).post("/api/readings").send({
      title: "数列极限 ε-N 定义",
      concept: "数列极限",
      body: "content",
      source: "manual-paste"
    });
    const list = await request(app).get("/api/readings");
    const getById = await request(app).get(
      "/api/readings/11111111-1111-4111-8111-111111111111"
    );

    expect(create.status).toBe(400);
    expect(create.body.error.code).toBe("VAULT_NOT_INITIALIZED");
    expect(list.status).toBe(400);
    expect(list.body.error.code).toBe("VAULT_NOT_INITIALIZED");
    expect(getById.status).toBe(400);
    expect(getById.body.error.code).toBe("VAULT_NOT_INITIALIZED");
    await expect(readdir(vaultPath)).resolves.not.toContain(".aleksi");
  });
});
