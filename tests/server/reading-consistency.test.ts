import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rebuildIndex } from "../../server/services/index-service";
import { READING_DIRECTORY } from "../../shared/vault-map";
import { createTempVaultContext } from "../temp-vault";

const INDEX_ID = "11111111-1111-4111-8111-111111111111";
const INDEX_TITLE = "Indexed title";
const INDEX_CONCEPT = "Indexed concept";

type Frontmatter = {
  id: string;
  type: string;
  title: string;
  concept: string;
};

function markdown(frontmatter: Frontmatter): string {
  return [
    "---",
    `id: ${JSON.stringify(frontmatter.id)}`,
    `type: ${JSON.stringify(frontmatter.type)}`,
    `title: ${JSON.stringify(frontmatter.title)}`,
    `concept: ${JSON.stringify(frontmatter.concept)}`,
    "---",
    "",
    "# Body",
    ""
  ].join("\n");
}

async function writeIndexedReading(
  vaultPath: string,
  relativePath: string,
  rawMarkdown = markdown({
    id: INDEX_ID,
    type: "reading",
    title: INDEX_TITLE,
    concept: INDEX_CONCEPT
  })
): Promise<string> {
  const readingPath = join(vaultPath, ...relativePath.split("/"));
  await mkdir(join(readingPath, ".."), { recursive: true });
  await writeFile(readingPath, rawMarkdown, "utf8");
  await rebuildIndex(vaultPath);
  return readingPath;
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("../../server/lib/atomic-write");
  vi.doUnmock("../../server/lib/bounded-regular-file");
  vi.doUnmock("../../server/services/index-service");
  vi.doUnmock("../../server/persistence/library-context");
  vi.restoreAllMocks();
});

describe("reading/index consistency boundaries", () => {
  it.each([
    ["id", "22222222-2222-4222-8222-222222222222"],
    ["title", "Replacement title"],
    ["concept", "Replacement concept"]
  ] as const)(
    "rejects cached reading metadata when its %s no longer matches Markdown",
    async (field, replacement) => {
      const context = await createTempVaultContext();
      const vaultPath = context.path("Vault");
      const relativePath = `${READING_DIRECTORY}/cached-reading.md`;
      const indexPath = join(vaultPath, ".aleksi", "index.json");

      await writeIndexedReading(vaultPath, relativePath);
      const index = JSON.parse(await readFile(indexPath, "utf8")) as {
        assets: Array<Record<string, unknown>>;
      };
      const indexedReading = index.assets[0];
      if (indexedReading === undefined) {
        throw new Error("Indexed reading fixture was not created");
      }
      indexedReading[field] = replacement;
      await writeFile(
        indexPath,
        `${JSON.stringify(index, null, 2)}\n`,
        "utf8"
      );

      const { getReadingByRelativePathInVault } = await import(
        "../../server/services/reading-service"
      );
      await expect(
        getReadingByRelativePathInVault(vaultPath, relativePath)
      ).rejects.toMatchObject({
        code: "INVALID_INDEX_CACHE",
        status: 400
      });
    }
  );

  it("rejects an image when its file handle reports early EOF and still closes the handle", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${READING_DIRECTORY}/image-reading.md`;
    const imagePath = join(vaultPath, READING_DIRECTORY, "assets", "image.png");
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    const close = vi.fn<() => Promise<void>>();
    let intercepted = false;

    await originalFs.mkdir(join(vaultPath, READING_DIRECTORY, "assets"), {
      recursive: true
    });
    await originalFs.writeFile(imagePath, Buffer.from("image-bytes"));
    await writeIndexedReading(vaultPath, relativePath);

    vi.resetModules();
    vi.doMock("../../server/persistence/library-context", async () => {
      const original =
        await vi.importActual<
          typeof import("../../server/persistence/library-context")
        >("../../server/persistence/library-context");
      return {
        ...original,
        activeLearningLibrary: async () => vaultPath
      };
    });
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      open: async (...args: Parameters<typeof originalFs.open>) => {
        const file = await originalFs.open(...args);
        if (String(args[0]) !== imagePath) {
          return file;
        }
        intercepted = true;
        close.mockImplementation(() => file.close());
        return {
          stat: file.stat.bind(file),
          read: async (
            buffer: Buffer,
            offset: number,
            length: number,
            _position: number
          ) => ({
            bytesRead: 0,
            buffer: buffer.subarray(offset, offset + length)
          }),
          close
        };
      }
    }));

    const { getReadingAssetById } = await import(
      "../../server/services/reading-service"
    );
    await expect(
      getReadingAssetById(INDEX_ID, "assets/image.png")
    ).rejects.toMatchObject({
      code: "INVALID_READING_ASSET",
      status: 400,
      message: "Reading image changed while it was being read"
    });
    expect(intercepted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("detects an external edit in the optimistic check before replacement", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${READING_DIRECTORY}/optimistic.md`;
    const readingPath = await writeIndexedReading(vaultPath, relativePath);
    const original = await readFile(readingPath, "utf8");
    const external = original.replace("# Body", "# External edit");
    let readingSnapshotCount = 0;

    vi.resetModules();
    vi.doMock("../../server/persistence/library-context", async () => {
      const actual =
        await vi.importActual<
          typeof import("../../server/persistence/library-context")
        >("../../server/persistence/library-context");
      return {
        ...actual,
        activeLearningLibrary: async () => vaultPath
      };
    });
    vi.doMock("../../server/lib/bounded-regular-file", async () => {
      const actual =
        await vi.importActual<
          typeof import("../../server/lib/bounded-regular-file")
        >("../../server/lib/bounded-regular-file");
      return {
        ...actual,
        readBoundedRegularFile: async (
          ...args: Parameters<typeof actual.readBoundedRegularFile>
        ) => {
          const result = await actual.readBoundedRegularFile(...args);
          if (String(args[1]) === readingPath) {
            readingSnapshotCount += 1;
            if (readingSnapshotCount === 1) {
              await writeFile(readingPath, external, "utf8");
            }
          }
          return result;
        }
      };
    });

    const { createReading } = await import(
      "../../server/services/reading-service"
    );
    await expect(
      createReading({
        title: INDEX_TITLE,
        concept: INDEX_CONCEPT,
        body: "replacement body",
        source: "manual-paste",
        conflictMode: "replace",
        replaceReadingId: INDEX_ID
      })
    ).rejects.toMatchObject({
      code: "READING_REPLACE_CONFLICT",
      status: 409
    });

    expect(readingSnapshotCount).toBe(2);
    await expect(readFile(readingPath, "utf8")).resolves.toBe(external);
  });

  it("does not roll back over an external edit after the replacement write", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${READING_DIRECTORY}/external-after-write.md`;
    const readingPath = await writeIndexedReading(vaultPath, relativePath);
    const original = await readFile(readingPath, "utf8");
    const external = original.replace("# Body", "# External after write");
    let rebuildCallCount = 0;

    vi.resetModules();
    vi.doMock("../../server/persistence/library-context", async () => {
      const actual =
        await vi.importActual<
          typeof import("../../server/persistence/library-context")
        >("../../server/persistence/library-context");
      return {
        ...actual,
        activeLearningLibrary: async () => vaultPath
      };
    });
    vi.doMock("../../server/services/index-service", async () => {
      const actual =
        await vi.importActual<
          typeof import("../../server/services/index-service")
        >("../../server/services/index-service");
      return {
        ...actual,
        rebuildIndex: async () => {
          rebuildCallCount += 1;
          await writeFile(readingPath, external, "utf8");
          throw new Error("forced rebuild failure after external edit");
        }
      };
    });

    const { createReading } = await import(
      "../../server/services/reading-service"
    );
    await expect(
      createReading({
        title: INDEX_TITLE,
        concept: INDEX_CONCEPT,
        body: "replacement body",
        source: "manual-paste",
        conflictMode: "replace",
        replaceReadingId: INDEX_ID
      })
    ).rejects.toThrow("forced rebuild failure after external edit");

    expect(rebuildCallCount).toBe(2);
    await expect(readFile(readingPath, "utf8")).resolves.toBe(external);
  });

  it("rolls back its own unchanged replacement when index rebuilding fails", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${READING_DIRECTORY}/rollback-own-write.md`;
    const readingPath = await writeIndexedReading(vaultPath, relativePath);
    const original = await readFile(readingPath, "utf8");

    vi.resetModules();
    vi.doMock("../../server/persistence/library-context", async () => {
      const actual =
        await vi.importActual<
          typeof import("../../server/persistence/library-context")
        >("../../server/persistence/library-context");
      return {
        ...actual,
        activeLearningLibrary: async () => vaultPath
      };
    });
    vi.doMock("../../server/services/index-service", async () => {
      const actual =
        await vi.importActual<
          typeof import("../../server/services/index-service")
        >("../../server/services/index-service");
      return {
        ...actual,
        rebuildIndex: async () => {
          throw new Error("forced rebuild failure");
        }
      };
    });

    const { createReading } = await import(
      "../../server/services/reading-service"
    );
    await expect(
      createReading({
        title: INDEX_TITLE,
        concept: INDEX_CONCEPT,
        body: "replacement body",
        source: "manual-paste",
        conflictMode: "replace",
        replaceReadingId: INDEX_ID
      })
    ).rejects.toThrow("forced rebuild failure");

    await expect(readFile(readingPath, "utf8")).resolves.toBe(original);
  });

  it("serializes two same-process replacements of one reading", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = `${READING_DIRECTORY}/serialized-replace.md`;
    const readingPath = await writeIndexedReading(vaultPath, relativePath);
    let targetWriteCount = 0;
    let activeTargetWrites = 0;
    let maximumActiveTargetWrites = 0;
    let signalFirstWrite: (() => void) | undefined;
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => {
      signalFirstWrite = resolve;
    });
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });

    vi.resetModules();
    vi.doMock("../../server/persistence/library-context", async () => {
      const actual =
        await vi.importActual<
          typeof import("../../server/persistence/library-context")
        >("../../server/persistence/library-context");
      return {
        ...actual,
        activeLearningLibrary: async () => vaultPath
      };
    });
    vi.doMock("../../server/lib/atomic-write", async () => {
      const actual =
        await vi.importActual<
          typeof import("../../server/lib/atomic-write")
        >("../../server/lib/atomic-write");
      return {
        ...actual,
        atomicWriteText: async (
          ...args: Parameters<typeof actual.atomicWriteText>
        ) => {
          if (String(args[0]) !== readingPath) {
            return actual.atomicWriteText(...args);
          }
          targetWriteCount += 1;
          activeTargetWrites += 1;
          maximumActiveTargetWrites = Math.max(
            maximumActiveTargetWrites,
            activeTargetWrites
          );
          try {
            if (targetWriteCount === 1) {
              signalFirstWrite?.();
              await firstWriteGate;
            }
            return await actual.atomicWriteText(...args);
          } finally {
            activeTargetWrites -= 1;
          }
        }
      };
    });

    const { createReading } = await import(
      "../../server/services/reading-service"
    );
    const first = createReading({
      title: INDEX_TITLE,
      concept: INDEX_CONCEPT,
      body: "first replacement",
      source: "manual-paste",
      conflictMode: "replace",
      replaceReadingId: INDEX_ID
    });
    await firstWriteStarted;
    const second = createReading({
      title: INDEX_TITLE,
      concept: INDEX_CONCEPT,
      body: "second replacement",
      source: "manual-paste",
      conflictMode: "replace",
      replaceReadingId: INDEX_ID
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(targetWriteCount).toBe(1);
    releaseFirstWrite?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    expect(targetWriteCount).toBe(2);
    expect(maximumActiveTargetWrites).toBe(1);
    await expect(readFile(readingPath, "utf8")).resolves.toContain(
      "second replacement"
    );
  });
});
