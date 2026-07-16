import {
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readIndexProjection,
  rebuildIndex
} from "../../server/services/index-service";
import {
  ARCHIVE_DIRECTORY,
  CODEX_TASK_DIRECTORY,
  DIAGNOSIS_DIRECTORY,
  GRAPH_DIRECTORY,
  LEGACY_CARD_DIRECTORIES,
  PRIMARY_CARD_DIRECTORIES,
  READING_DIRECTORY,
  REVIEW_DIRECTORY
} from "../../shared/vault-map";
import { createTempVaultContext, readJsonFile } from "../temp-vault";

const FOLDERS = {
  reading: READING_DIRECTORY,
  concept: PRIMARY_CARD_DIRECTORIES.concept,
  definition: LEGACY_CARD_DIRECTORIES.definition,
  example: PRIMARY_CARD_DIRECTORIES.example,
  boundary: PRIMARY_CARD_DIRECTORIES.boundary,
  counterexample: LEGACY_CARD_DIRECTORIES.counterexample,
  process: PRIMARY_CARD_DIRECTORIES.process,
  proof: LEGACY_CARD_DIRECTORIES.proof,
  mistake: PRIMARY_CARD_DIRECTORIES.mistake,
  diagnosis: DIAGNOSIS_DIRECTORY,
  review: REVIEW_DIRECTORY,
  graph: GRAPH_DIRECTORY,
  codexTask: CODEX_TASK_DIRECTORY,
  archived: ARCHIVE_DIRECTORY
} as const;

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function frontmatterMarkdown(
  data: Record<string, string | boolean | number | null>,
  body = "# Fixture\n"
): string {
  const lines = Object.entries(data).map(([key, value]) => {
    if (typeof value === "string") {
      return `${key}: ${JSON.stringify(value)}`;
    }
    return `${key}: ${String(value)}`;
  });

  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

async function writeMarkdown(
  vaultPath: string,
  relativePath: string,
  data: Record<string, string | boolean | number | null>,
  body?: string
): Promise<void> {
  const target = join(vaultPath, ...relativePath.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, frontmatterMarkdown(data, body), "utf8");
}

async function writeRawMarkdown(
  vaultPath: string,
  relativePath: string,
  content: string
): Promise<void> {
  const target = join(vaultPath, ...relativePath.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("index rebuild service", () => {
  it("reads a fresh index without rewriting it and refreshes after a source change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T03:14:15.926Z"));
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const readingPath = join(vaultPath, FOLDERS.reading, "source.md");
    const indexPath = join(vaultPath, ".aleksi", "index.json");

    await writeMarkdown(vaultPath, `${FOLDERS.reading}/source.md`, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Source reading",
      concept: "数列极限"
    });

    const first = await readIndexProjection(vaultPath);
    const firstMtime = (await stat(indexPath)).mtimeMs;
    const second = await readIndexProjection(vaultPath);

    expect(second).toEqual(first);
    expect((await stat(indexPath)).mtimeMs).toBe(firstMtime);

    await writeMarkdown(vaultPath, `${FOLDERS.reading}/source.md`, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Changed source reading",
      concept: "数列极限"
    });
    await utimes(
      readingPath,
      new Date("2026-06-23T03:14:15.926Z"),
      new Date("2026-06-23T03:14:15.926Z")
    );

    const changed = await readIndexProjection(vaultPath);
    expect(changed.sourceFingerprint).not.toBe(first.sourceFingerprint);
    expect(changed.assets[0].title).toBe("Changed source reading");
  });

  it("rebuilds a stable index from reading and card Markdown assets only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T03:14:15.926Z"));
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");

    await writeMarkdown(vaultPath, `${FOLDERS.reading}/001-reading.md`, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "数列极限入门",
      concept: "数列极限",
      source: "manual-paste",
      createdAt: "2026-06-22T03:14:15.926Z"
    });
    await writeMarkdown(vaultPath, `${FOLDERS.definition}/002-definition.md`, {
      id: "22222222-2222-4222-8222-222222222222",
      type: "definition",
      title: "ε-N 定义",
      concept: "数列极限",
      mastery: "learning",
      nextReview: "2026-06-23",
      createdAt: "2026-06-22T03:14:15.926Z"
    });
    await writeMarkdown(vaultPath, `${FOLDERS.graph}/ignored.md`, {
      id: "33333333-3333-4333-8333-333333333333",
      type: "reading",
      title: "Ignored graph file",
      concept: "数列极限"
    });
    await writeMarkdown(vaultPath, "arbitrary/ignored.md", {
      id: "44444444-4444-4444-8444-444444444444",
      type: "reading",
      title: "Ignored arbitrary file",
      concept: "数列极限"
    });
    await writeMarkdown(vaultPath, ".aleksi/ignored.md", {
      id: "55555555-5555-4555-8555-555555555555",
      type: "reading",
      title: "Ignored projection file",
      concept: "数列极限"
    });

    const result = await rebuildIndex(vaultPath);

    expect(result.recoveredFromCorruption).toBe(false);
    expect(result.index.generatedAt).toBe("2026-06-22T03:14:15.926Z");
    expect(result.index.parseErrors).toEqual([]);
    expect(result.index.assets).toHaveLength(2);
    expect(result.index.assets.map((asset) => asset.relativePath)).toEqual([
      `${FOLDERS.reading}/001-reading.md`,
      `${FOLDERS.definition}/002-definition.md`
    ]);
    expect(result.index.assets[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      assetType: "reading",
      title: "数列极限入门",
      concept: "数列极限",
      mastery: null,
      nextReview: null,
      archived: false
    });
    expect(result.index.assets[1]).toMatchObject({
      id: "22222222-2222-4222-8222-222222222222",
      assetType: "definition",
      title: "ε-N 定义",
      concept: "数列极限",
      mastery: "learning",
      nextReview: "2026-06-23",
      archived: false
    });
    expect(result.index.assets[0].updatedAt).toMatch(ISO_UTC_MS);

    const persisted = await readJsonFile(join(vaultPath, ".aleksi", "index.json"));
    expect(persisted).toEqual(result.index);
  });

  it("marks due, rebuild, and archived card mastery from authoritative Markdown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00.000Z"));
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");

    await writeMarkdown(vaultPath, `${FOLDERS.definition}/due.md`, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "definition",
      title: "Due definition",
      concept: "数列极限",
      mastery: "learning",
      nextReview: "2026-06-22"
    });
    await writeMarkdown(vaultPath, `${FOLDERS.example}/rebuild.md`, {
      id: "22222222-2222-4222-8222-222222222222",
      type: "example",
      title: "Needs rebuild",
      concept: "数列极限",
      mastery: "rebuild",
      nextReview: "2026-06-20"
    });
    await writeMarkdown(vaultPath, `${FOLDERS.archived}/archived-proof.md`, {
      id: "33333333-3333-4333-8333-333333333333",
      type: "proof",
      title: "Archived proof",
      concept: "数列极限",
      mastery: "mastered",
      nextReview: "2026-07-01"
    });

    const { index } = await rebuildIndex(vaultPath);

    expect(index.parseErrors).toEqual([]);
    expect(index.assets.map((asset) => asset.mastery)).toEqual([
      "due",
      "rebuild",
      "archived"
    ]);
    expect(index.assets[2]).toMatchObject({
      assetType: "proof",
      relativePath: `${FOLDERS.archived}/archived-proof.md`,
      archived: true,
      nextReview: "2026-07-01"
    });
  });

  it("preserves parse errors and skips pending review records without aborting rebuild", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");

    await writeMarkdown(vaultPath, `${FOLDERS.reading}/good.md`, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Good reading",
      concept: "数列极限"
    });
    await writeRawMarkdown(
      vaultPath,
      `${FOLDERS.reading}/broken.md`,
      "---\ntitle: [unterminated\n---\n\n# Broken\n"
    );
    await writeMarkdown(vaultPath, `${FOLDERS.review}/pending.md`, {
      id: `review-${"a".repeat(64)}`,
      type: "review",
      title: "Pending review",
      concept: "数列极限",
      commitState: "pending"
    });

    const { index } = await rebuildIndex(vaultPath);

    expect(index.assets).toHaveLength(1);
    expect(index.assets[0].relativePath).toBe(`${FOLDERS.reading}/good.md`);
    expect(index.parseErrors).toHaveLength(1);
    expect(index.parseErrors[0]).toMatchObject({
      relativePath: `${FOLDERS.reading}/broken.md`,
      code: "FRONTMATTER_PARSE_ERROR",
      message: expect.any(String)
    });
  });

  it("requires codex task assets to declare a concept", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");

    await writeMarkdown(vaultPath, `${FOLDERS.codexTask}/with-concept.md`, {
      id: "task-with-concept",
      type: "codex-task",
      title: "Task with concept",
      concept: "鏁板垪鏋侀檺"
    });
    await writeMarkdown(vaultPath, `${FOLDERS.codexTask}/missing-concept.md`, {
      id: "task-missing-concept",
      type: "codex-task",
      title: "Task missing concept"
    });

    const { index } = await rebuildIndex(vaultPath);

    expect(index.assets).toHaveLength(1);
    expect(index.assets[0]).toMatchObject({
      id: "task-with-concept",
      assetType: "codex-task",
      concept: "鏁板垪鏋侀檺",
      relativePath: `${FOLDERS.codexTask}/with-concept.md`
    });
    expect(index.parseErrors).toEqual([
      {
        relativePath: `${FOLDERS.codexTask}/missing-concept.md`,
        code: "INVALID_INDEX_FRONTMATTER",
        message: `${FOLDERS.codexTask}/missing-concept.md frontmatter concept must be a nonempty string`
      }
    ]);
  });

  it("rejects asset directory junctions that escape the Vault", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const outsidePath = context.path("Outside");

    await mkdir(vaultPath, { recursive: true });
    await mkdir(outsidePath, { recursive: true });
    await writeMarkdown(outsidePath, "escaped.md", {
      id: "escaped-reading",
      type: "reading",
      title: "Escaped reading",
      concept: "鏁板垪鏋侀檺"
    });

    try {
      await symlink(outsidePath, join(vaultPath, FOLDERS.reading), "junction");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        return;
      }
      throw error;
    }

    await expect(rebuildIndex(vaultPath)).rejects.toThrow(
      /symlink|junction|outside/i
    );
  });

  it("renames an invalid JSON index cache before rebuilding from Markdown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T03:14:15.926Z"));
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const aleksiPath = join(vaultPath, ".aleksi");
    const indexPath = join(aleksiPath, "index.json");

    await mkdir(aleksiPath, { recursive: true });
    await writeFile(indexPath, "{not json\n", "utf8");
    await writeMarkdown(vaultPath, `${FOLDERS.reading}/source.md`, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Recovered reading",
      concept: "数列极限"
    });

    const result = await rebuildIndex(vaultPath);

    expect(result.recoveredFromCorruption).toBe(true);
    expect(await readdir(aleksiPath)).toContain(
      "index.corrupt-20260622T031415926Z.json"
    );
    await expect(
      readFile(
        join(aleksiPath, "index.corrupt-20260622T031415926Z.json"),
        "utf8"
      )
    ).resolves.toBe("{not json\n");
    expect(result.index.assets).toHaveLength(1);
  });

  it("renames a schema-invalid index cache with a collision suffix", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T03:14:15.926Z"));
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const aleksiPath = join(vaultPath, ".aleksi");
    const indexPath = join(aleksiPath, "index.json");
    const existingCorruptPath = join(
      aleksiPath,
      "index.corrupt-20260622T031415926Z.json"
    );

    await mkdir(aleksiPath, { recursive: true });
    await writeFile(existingCorruptPath, "earlier corrupt cache\n", "utf8");
    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          generatedAt: "2026-06-22T03:14:15.926Z",
          assets: "not-an-array",
          parseErrors: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeMarkdown(vaultPath, `${FOLDERS.reading}/source.md`, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Recovered reading",
      concept: "数列极限"
    });

    const result = await rebuildIndex(vaultPath);

    expect(result.recoveredFromCorruption).toBe(true);
    expect(await readdir(aleksiPath)).toEqual(
      expect.arrayContaining([
        "index.corrupt-20260622T031415926Z.json",
        "index.corrupt-20260622T031415926Z-2.json",
        "index.json"
      ])
    );
    await expect(
      readFile(
        join(aleksiPath, "index.corrupt-20260622T031415926Z-2.json"),
        "utf8"
      )
    ).resolves.toContain('"assets": "not-an-array"');
  });
});
