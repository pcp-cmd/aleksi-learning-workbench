import {
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_INDEX_DIRECTORY_DEPTH,
  MAX_INDEX_MARKDOWN_BYTES,
  MAX_INDEX_MARKDOWN_FILES,
  MAX_INDEX_TOTAL_ENTRIES,
  assertIndexFileCount,
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
  REVIEW_DIRECTORY,
  VERIFICATION_DIRECTORY
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
  vi.resetModules();
  vi.doUnmock("node:fs/promises");
  vi.restoreAllMocks();
});

describe("index rebuild service", () => {
  it("excludes the verification-evidence subtree from assets, parse errors, and fingerprints", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const verificationPath = `${VERIFICATION_DIRECTORY}/candidate.md`;

    await writeRawMarkdown(
      vaultPath,
      verificationPath,
      "---\ntype: verification-evidence\nid: evidence-1\n---\n\nfirst"
    );

    const first = (await rebuildIndex(vaultPath)).index;

    expect(first.assets).toEqual([]);
    expect(first.parseErrors).toEqual([]);

    await writeRawMarkdown(
      vaultPath,
      verificationPath,
      "---\ntype: verification-verdict\nid: verdict-1\n---\n\nchanged"
    );

    const changed = (await rebuildIndex(vaultPath)).index;

    expect(changed.assets).toEqual([]);
    expect(changed.parseErrors).toEqual([]);
    expect(changed.sourceFingerprint).toBe(first.sourceFingerprint);
  });

  it("enforces Markdown file-count and per-file byte budgets before parsing", async () => {
    expect(() => assertIndexFileCount(MAX_INDEX_MARKDOWN_FILES + 1)).toThrow(
      /file count limit/u
    );

    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const readingPath = join(vaultPath, FOLDERS.reading, "oversized.md");
    await mkdir(join(vaultPath, FOLDERS.reading), { recursive: true });
    await writeFile(readingPath, "---\ntype: reading\n---\n", "utf8");
    await truncate(readingPath, MAX_INDEX_MARKDOWN_BYTES + 1);

    const { index } = await rebuildIndex(vaultPath);

    expect(index.assets).toEqual([]);
    expect(index.parseErrors).toContainEqual(
      expect.objectContaining({
        relativePath: `${FOLDERS.reading}/oversized.md`,
        code: "ASSET_FILE_TOO_LARGE"
      })
    );
  });

  it("counts non-Markdown filesystem entries against the traversal budget", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const readingPath = join(vaultPath, FOLDERS.reading);

    await mkdir(readingPath, { recursive: true });
    await writeFile(join(readingPath, "one.txt"), "ignored", "utf8");
    await writeFile(join(readingPath, "two.bin"), "ignored", "utf8");
    await writeFile(join(readingPath, "three.json"), "ignored", "utf8");

    await expect(
      rebuildIndex(vaultPath, { limits: { maxEntries: 2 } })
    ).rejects.toMatchObject({
      code: "INDEX_ENTRY_LIMIT",
      status: 422
    });
    expect(MAX_INDEX_TOTAL_ENTRIES).toBeGreaterThan(MAX_INDEX_MARKDOWN_FILES);
  });

  it("charges each directory entry to the traversal budget as opendir returns it", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const readingPath = join(vaultPath, FOLDERS.reading);
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    let reads = 0;
    const close = vi.fn(async () => undefined);

    await mkdir(readingPath, { recursive: true });

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      opendir: async (path: Parameters<typeof originalFs.opendir>[0]) => {
        if (String(path) !== readingPath) {
          return originalFs.opendir(path);
        }
        return {
          read: async () => {
            reads += 1;
            if (reads > 3) {
              return null;
            }
            return {
              name: `entry-${reads}.txt`,
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => false
            };
          },
          close
        } as unknown as Awaited<ReturnType<typeof originalFs.opendir>>;
      }
    }));

    const { rebuildIndex: rebuildBudgetAwareIndex } = await import(
      "../../server/services/index-service"
    );
    await expect(
      rebuildBudgetAwareIndex(vaultPath, {
        limits: { maxEntries: 2 }
      })
    ).rejects.toMatchObject({
      code: "INDEX_ENTRY_LIMIT",
      status: 422
    });

    expect(reads).toBe(3);
    expect(close).toHaveBeenCalledOnce();
  });

  it("stops traversal beyond the configured directory-depth budget", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const tooDeep = join(vaultPath, FOLDERS.reading, "one", "two", "three");

    await mkdir(tooDeep, { recursive: true });

    await expect(
      rebuildIndex(vaultPath, { limits: { maxDepth: 2 } })
    ).rejects.toMatchObject({
      code: "INDEX_DEPTH_LIMIT",
      status: 422
    });
    expect(MAX_INDEX_DIRECTORY_DEPTH).toBeGreaterThan(2);
  });

  it("honors an expired traversal deadline and an explicit abort signal", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const controller = new AbortController();
    controller.abort();

    await expect(
      rebuildIndex(vaultPath, { deadlineAt: Date.now() - 1 })
    ).rejects.toMatchObject({
      code: "INDEX_SCAN_DEADLINE_EXCEEDED",
      status: 503
    });
    await expect(
      rebuildIndex(vaultPath, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: "INDEX_SCAN_ABORTED",
      status: 503
    });
  });

  it("does not index a Markdown file whose path identity changes after open", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${FOLDERS.reading}/race.md`;
    const markdownPath = join(vaultPath, ...relativePath.split("/"));
    const openedPath = `${markdownPath}.opened`;
    const indexPath = join(vaultPath, ".aleksi", "index.json");
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    let swapped = false;

    await writeMarkdown(vaultPath, relativePath, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Original safe title",
      concept: "Safe concept"
    });
    await rebuildIndex(vaultPath);
    const previousIndex = await readFile(indexPath);

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
            frontmatterMarkdown({
              id: "22222222-2222-4222-8222-222222222222",
              type: "reading",
              title: "REPLACEMENT_INDEX_SECRET",
              concept: "Replacement"
            }),
            "utf8"
          );
        }
        return file;
      }
    }));

    const { rebuildIndex: rebuildRaceAwareIndex } = await import(
      "../../server/services/index-service"
    );
    await expect(
      rebuildRaceAwareIndex(vaultPath)
    ).rejects.toMatchObject({
      code: "INDEX_SOURCE_CHANGED",
      status: 409
    });

    expect(swapped).toBe(true);
    await expect(readFile(indexPath)).resolves.toEqual(previousIndex);
    await expect(originalFs.readFile(openedPath, "utf8")).resolves.toContain(
      "Original safe title"
    );
  });

  it("preserves the prior index bytes when a scan is aborted during parsing", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${FOLDERS.reading}/abort-during-read.md`;
    const markdownPath = join(vaultPath, ...relativePath.split("/"));
    const indexPath = join(vaultPath, ".aleksi", "index.json");
    const controller = new AbortController();
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    let abortedDuringOpen = false;

    await writeMarkdown(vaultPath, relativePath, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Abort fixture",
      concept: "Abort"
    });
    await rebuildIndex(vaultPath);
    const previousIndex = await readFile(indexPath);

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      open: async (...args: Parameters<typeof originalFs.open>) => {
        const file = await originalFs.open(...args);
        if (!abortedDuringOpen && String(args[0]) === markdownPath) {
          abortedDuringOpen = true;
          controller.abort();
        }
        return file;
      }
    }));

    const { rebuildIndex: rebuildAbortAwareIndex } = await import(
      "../../server/services/index-service"
    );
    await expect(
      rebuildAbortAwareIndex(vaultPath, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: "INDEX_SCAN_ABORTED",
      status: 503
    });

    expect(abortedDuringOpen).toBe(true);
    await expect(readFile(indexPath)).resolves.toEqual(previousIndex);
  });

  it("closes a resource that finishes opening after an index scan is aborted", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const readingPath = join(vaultPath, FOLDERS.reading);
    const controller = new AbortController();
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    const close = vi.fn(async () => undefined);
    let resolveDirectory:
      | ((directory: Awaited<ReturnType<typeof originalFs.opendir>>) => void)
      | undefined;
    let signalOpenStarted: (() => void) | undefined;
    const openStarted = new Promise<void>((resolve) => {
      signalOpenStarted = resolve;
    });

    await mkdir(readingPath, { recursive: true });

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      opendir: (path: Parameters<typeof originalFs.opendir>[0]) => {
        if (String(path) !== readingPath) {
          return originalFs.opendir(path);
        }
        signalOpenStarted?.();
        return new Promise<Awaited<ReturnType<typeof originalFs.opendir>>>(
          (resolve) => {
            resolveDirectory = resolve;
          }
        );
      }
    }));

    const { rebuildIndex: rebuildAbortAwareIndex } = await import(
      "../../server/services/index-service"
    );
    const rebuild = rebuildAbortAwareIndex(vaultPath, {
      signal: controller.signal
    });

    await openStarted;
    controller.abort();
    await expect(rebuild).rejects.toMatchObject({
      code: "INDEX_SCAN_ABORTED",
      status: 503
    });

    expect(resolveDirectory).toBeTypeOf("function");
    resolveDirectory?.({
      close
    } as unknown as Awaited<ReturnType<typeof originalFs.opendir>>);
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });

  it("serializes concurrent rebuilds for the same vault", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${FOLDERS.reading}/serialized.md`;
    const markdownPath = join(vaultPath, ...relativePath.split("/"));
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    let markdownOpenCount = 0;
    let releaseFirstOpen: (() => void) | undefined;
    let signalFirstOpen: (() => void) | undefined;
    const firstOpenStarted = new Promise<void>((resolve) => {
      signalFirstOpen = resolve;
    });
    const firstOpenGate = new Promise<void>((resolve) => {
      releaseFirstOpen = resolve;
    });

    await writeMarkdown(vaultPath, relativePath, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Serialized rebuild",
      concept: "Locking"
    });

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      open: async (...args: Parameters<typeof originalFs.open>) => {
        if (String(args[0]) === markdownPath) {
          markdownOpenCount += 1;
          if (markdownOpenCount === 1) {
            signalFirstOpen?.();
            await firstOpenGate;
          }
        }
        return originalFs.open(...args);
      }
    }));

    const { rebuildIndex: rebuildSerializedIndex } = await import(
      "../../server/services/index-service"
    );
    const first = rebuildSerializedIndex(vaultPath);
    await firstOpenStarted;
    const second = rebuildSerializedIndex(vaultPath);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(markdownOpenCount).toBe(1);

    releaseFirstOpen?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(markdownOpenCount).toBe(2);
  });

  it("refreshes a cached index after same-inode same-size content changes with mtime restored", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${FOLDERS.reading}/same-identity.md`;
    const readingPath = join(vaultPath, ...relativePath.split("/"));
    const stableTimestamp = new Date("2026-07-24T07:30:00.000Z");

    await writeMarkdown(vaultPath, relativePath, {
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Original source",
      concept: "Stable concept"
    });
    await utimes(readingPath, stableTimestamp, stableTimestamp);
    const first = await readIndexProjection(vaultPath);
    const before = await stat(readingPath, { bigint: true });
    const replacement = frontmatterMarkdown({
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Modified source",
      concept: "Stable concept"
    });

    expect(Buffer.byteLength(replacement)).toBe(Number(before.size));
    await writeFile(readingPath, replacement, "utf8");
    await utimes(readingPath, stableTimestamp, stableTimestamp);

    const after = await stat(readingPath, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.ctimeNs).not.toBe(before.ctimeNs);

    const changed = await readIndexProjection(vaultPath);
    expect(changed.sourceFingerprint).not.toBe(first.sourceFingerprint);
    expect(changed.assets[0]).toMatchObject({
      title: "Modified source",
      relativePath
    });
  });

  it("rejects an in-place same-size Markdown mutation during candidate reading", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${FOLDERS.reading}/in-place-race.md`;
    const markdownPath = join(vaultPath, ...relativePath.split("/"));
    const original = frontmatterMarkdown({
      id: "11111111-1111-4111-8111-111111111111",
      type: "reading",
      title: "Original source",
      concept: "Stable concept"
    });
    const replacement = frontmatterMarkdown({
      id: "22222222-2222-4222-8222-222222222222",
      type: "reading",
      title: "Modified source",
      concept: "Stable concept"
    });
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    const indexPath = join(vaultPath, ".aleksi", "index.json");
    let mutated = false;

    expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original));
    await writeRawMarkdown(vaultPath, relativePath, original);
    await rebuildIndex(vaultPath);
    const previousIndex = await readFile(indexPath);
    const initial = await originalFs.stat(markdownPath, { bigint: true });

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      open: async (...args: Parameters<typeof originalFs.open>) => {
        const file = await originalFs.open(...args);
        if (String(args[0]) !== markdownPath) {
          return file;
        }
        return {
          stat: file.stat.bind(file),
          read: async (...readArgs: Parameters<typeof file.read>) => {
            if (!mutated) {
              mutated = true;
              await originalFs.writeFile(markdownPath, replacement, "utf8");
              await originalFs.utimes(
                markdownPath,
                initial.atime,
                initial.mtime
              );
            }
            return file.read(...readArgs);
          },
          close: file.close.bind(file)
        };
      }
    }));

    const { rebuildIndex: rebuildRaceAwareIndex } = await import(
      "../../server/services/index-service"
    );
    await expect(
      rebuildRaceAwareIndex(vaultPath)
    ).rejects.toMatchObject({
      code: "INDEX_SOURCE_CHANGED",
      status: 409
    });

    expect(mutated).toBe(true);
    await expect(readFile(indexPath)).resolves.toEqual(previousIndex);
  });

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
