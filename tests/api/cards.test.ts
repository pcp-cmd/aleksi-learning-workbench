import {
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import type { CardRecord } from "../../server/domain/types";
import type { AssetVersion } from "../../server/lib/asset-version";
import {
  parseCardMarkdown,
  serializeCardMarkdown
} from "../../server/lib/markdown-codec";
import {
  LEGACY_CARD_TYPES,
  PRIMARY_CARD_TYPES,
  type CardType,
  type LegacyCardType
} from "../../shared/card-types";
import { ARCHIVE_DIRECTORY, CARD_DIRECTORIES } from "../../shared/vault-map";
import { createTempVaultContext, readJsonFile } from "../temp-vault";

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type CardResponseBody = {
  card: CardRecord & {
    relativePath: string;
    modifiedAt: string;
    version: AssetVersion;
  };
  saveReceipt: {
    relativePath: string;
    absolutePath: string;
    modifiedAt: string;
  };
};

type IndexJson = {
  assets: Array<{
    id: string;
    assetType: string;
    title: string;
    concept: string | null;
    relativePath: string;
    mastery: string | null;
    nextReview: string | null;
    updatedAt: string;
    archived: boolean;
  }>;
};

type LegacyOrExampleCardType = LegacyCardType | "example";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../server/services/index-service");
  vi.restoreAllMocks();
});

function isErrorCode(error: unknown, ...codes: string[]): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}

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

async function createReading(
  app: ReturnType<typeof createApp>
): Promise<{ id: string; relativePath: string }> {
  const response = await request(app).post("/api/readings").send({
    title: "Compactness reading",
    concept: "Topology",
    body: "An open cover has a finite subcover.",
    source: "manual-paste"
  });

  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return {
    id: response.body.reading.id,
    relativePath: response.body.reading.relativePath
  };
}

function createCardInput(type: LegacyOrExampleCardType, sourceReadingId: string) {
  const common = {
    type,
    title: `${type} card`,
    concept: "Topology",
    relatedConcepts: ["Open cover"],
    sourceReadingId,
    excerpt: "A cover has a finite subcover.",
    understanding: "Compactness is about reducing infinite data.",
    blockType: "definition",
    nextAction: "Review the next example."
  } as const;

  switch (type) {
    case "definition":
      return {
        ...common,
        formalDefinition: "Every open cover has a finite subcover.",
        plainExplanation: "Infinitely many covering sets can be reduced.",
        quantifierStructure: "for every cover, there exists a finite subcover",
        commonMisunderstandings: "It is not just closed and bounded everywhere."
      };
    case "example":
      return {
        ...common,
        exampleContent: "[0, 1] with the usual topology.",
        whyItFits: "Heine-Borel supplies the finite subcover.",
        trainingPurpose: "Recognize standard compact objects."
      };
    case "counterexample":
      return {
        ...common,
        counterexampleContent: "The real line with cover (-n, n).",
        brokenCondition: "No finite subcover reaches every point.",
        whyItIsNot: "Any finite choice misses sufficiently large points."
      };
    case "proof":
      return {
        ...common,
        proposition: "Closed subsets of compact spaces are compact.",
        firstAttempt: "Try to use the cover directly.",
        keyMove: "Add the open complement.",
        proofOutline: "Extend the cover, reduce finitely, remove the complement.",
        failureReason: "The direct cover lives only on the subset."
      };
  }
}

function createGenericCardInput(type: string, sourceReadingId: string) {
  const common = {
    type,
    title: `${type} card`,
    concept: "Learning loops",
    relatedConcepts: ["Deliberate practice"],
    sourceReadingId,
    excerpt: "A learning loop turns mistakes into reusable next actions.",
    understanding: "The card should support non-math study material.",
    blockType: "transfer",
    nextAction: "Use this card in the next review."
  };

  switch (type) {
    case "concept":
      return {
        ...common,
        formalExplanation: "A learning loop captures input, practice, feedback, and adjustment.",
        myUnderstanding: "It is a repeatable way to improve instead of rereading passively.",
        commonMisunderstanding: "Mistaking activity volume for learning progress.",
        usageContext: "Use after reading notes or receiving feedback."
      };
    case "example":
      return {
        ...common,
        exampleContent: "A reading note becomes a prompt, answer, correction, and next review.",
        whyItFits: "It shows the loop with concrete study actions instead of math-only material.",
        trainingPurpose: "Recognize reusable learning examples."
      };
    case "boundary":
      return {
        ...common,
        confusingObjects: "Review schedule vs learning loop",
        similarity: "Both organize repeated study actions.",
        keyDifference: "The loop changes behavior from feedback; the schedule only times repetition.",
        judgementRule: "If the next action changes because of evidence, it belongs to the loop."
      };
    case "process":
      return {
        ...common,
        task: "Turn a failed exercise into a reusable practice step.",
        steps: "Name the failure, find the cause, write a recognition signal, schedule a retry.",
        keyTurn: "The cause must explain the wrong move, not just restate it.",
        pitfall: "Writing a vague reminder that cannot guide the next attempt.",
        usageContext: "Use after solving practice questions."
      };
    case "mistake":
      return {
        ...common,
        mistake: "I kept rereading instead of testing recall.",
        originalThinking: "More exposure would make the concept familiar enough.",
        realCause: "No retrieval attempt exposed what was actually missing.",
        correctMethod: "Close the note and answer a concrete prompt first.",
        recognitionSignal: "I feel fluent while looking at the material but freeze without it."
      };
    default:
      throw new Error(`Unhandled generic card type: ${type}`);
  }
}

function updateCardInput(
  sourceReadingId: string,
  expectedVersion: AssetVersion
) {
  return {
    expectedVersion,
    title: "Updated compactness card",
    concept: "Topology",
    relatedConcepts: ["Finite subcover"],
    sourceReadingId,
    excerpt: "Updated excerpt.",
    understanding: "Updated understanding.",
    blockType: null,
    nextAction: "Updated next action.",
    mastery: "mastered",
    formalDefinition: "Updated formal definition.",
    plainExplanation: "Updated plain explanation.",
    quantifierStructure: "Updated quantifiers.",
    commonMisunderstandings: "Updated misunderstanding."
  };
}

async function postCard(
  app: ReturnType<typeof createApp>,
  type: LegacyOrExampleCardType,
  sourceReadingId: string
): Promise<SupertestResponse> {
  return request(app).post("/api/cards").send(createCardInput(type, sourceReadingId));
}

async function createCard(
  app: ReturnType<typeof createApp>,
  type: LegacyOrExampleCardType,
  sourceReadingId: string
): Promise<CardResponseBody> {
  const response = await postCard(app, type, sourceReadingId);
  expect(response.status).toBe(200);
  return response.body as CardResponseBody;
}

async function createMockedAppWithFailingRebuild(): Promise<
  ReturnType<typeof createApp>
> {
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
  return createMockedApp();
}

function plusOneUtcDate(isoUtcMilliseconds: string): string {
  const date = new Date(isoUtcMilliseconds);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function vaultPath(vaultPathRoot: string, relativePath: string): string {
  return join(vaultPathRoot, ...relativePath.split("/"));
}

async function cardDirectoryFilenames(
  vaultPathRoot: string,
  type: LegacyCardType
): Promise<string[]> {
  try {
    return (await readdir(join(vaultPathRoot, CARD_DIRECTORIES[type]))).sort();
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

function expectApiError(
  response: SupertestResponse,
  code: string
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

async function expectIndexContains(
  vaultPathRoot: string,
  expected: {
    id: string;
    assetType: CardType;
    relativePath: string;
    archived: boolean;
  }
): Promise<void> {
  const index = await readJsonFile<IndexJson>(
    join(vaultPathRoot, ".aleksi", "index.json")
  );

  expect(index.assets).toContainEqual(
    expect.objectContaining({
      id: expected.id,
      assetType: expected.assetType,
      relativePath: expected.relativePath,
      archived: expected.archived
    })
  );
}

describe("cards API", () => {
  it.each(LEGACY_CARD_TYPES)(
    "creates an Obsidian-readable legacy %s card",
    async (type) => {
      const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
      const reading = await createReading(app);

      const response = await postCard(app, type, reading.id);

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toEqual({
        card: expect.objectContaining({
          id: expect.stringMatching(UUID_V4),
          type,
          title: `${type} card`,
          concept: "Topology",
          sourceReading: reading.relativePath,
          createdAt: expect.stringMatching(ISO_UTC_MS),
          mastery: "learning",
          relativePath: expect.stringMatching(
            new RegExp(`^${CARD_DIRECTORIES[type]}/.+\\.md$`, "u")
          ),
          modifiedAt: expect.stringMatching(ISO_UTC_MS)
        }),
        saveReceipt: {
          relativePath: expect.stringMatching(
            new RegExp(`^${CARD_DIRECTORIES[type]}/.+\\.md$`, "u")
          ),
          absolutePath: expect.any(String),
          modifiedAt: expect.stringMatching(ISO_UTC_MS)
        },
        projectionStatus: "fresh",
        projectionErrorId: null
      });
      const body = response.body as CardResponseBody;
      expect(body.card.schemaVersion).toBe(2);
      expect(body.card.compatibleMetadata).toEqual({});
      expect(body.card.nextReview).toBe(plusOneUtcDate(body.card.createdAt));
      expect(body.card.revisionLog).toEqual([
        {
          at: body.card.createdAt.slice(0, 10),
          note: expect.any(String),
          reviewId: null
        }
      ]);
      expect(body.card.lastAppliedReviewId).toBeNull();
      expect(body.card.lastAppliedReviewSequence).toBeNull();
      expect(body.card.reviewAppliedAt).toBeNull();
      expect(body.card.reviewOverrideAt).toBeNull();
      expect(body.card.pendingReviewId).toBeNull();
      expect(body.saveReceipt.relativePath).toBe(body.card.relativePath);
      expect(body.saveReceipt.absolutePath).toBe(
        await realpath(vaultPath(vaultPathRoot, body.card.relativePath))
      );
      expect(body.saveReceipt.modifiedAt).toBe(body.card.modifiedAt);
      expect(body.saveReceipt.modifiedAt).toBe(
        (await stat(body.saveReceipt.absolutePath)).mtime.toISOString()
      );

      const raw = await readFile(body.saveReceipt.absolutePath, "utf8");
      expect(raw).toContain("schemaVersion: 2\n");
      expect(raw).not.toContain("\r");
      expect(raw).toContain("[[Topology]]");
      const parsed = parseCardMarkdown(raw);
      expect(parsed).toMatchObject({
        id: body.card.id,
        type,
        sourceReading: reading.relativePath,
        mastery: "learning"
      });
      await expectIndexContains(vaultPathRoot, {
        id: body.card.id,
        assetType: type,
        relativePath: body.card.relativePath,
        archived: false
      });
    }
  );

  it.each(PRIMARY_CARD_TYPES)(
    "creates a V0.2 generic %s card and indexes it",
    async (type) => {
      const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
      const reading = await createReading(app);

      const response = await request(app)
        .post("/api/cards")
        .send(createGenericCardInput(type, reading.id));

      expect(response.status).toBe(200);
      const body = response.body as CardResponseBody;
      expect(body.card).toMatchObject({
        id: expect.stringMatching(UUID_V4),
        type,
        title: `${type} card`,
        concept: "Learning loops",
        sourceReading: reading.relativePath,
        mastery: "learning",
        relativePath: expect.stringMatching(
          new RegExp(`^${CARD_DIRECTORIES[type]}/.+\\.md$`, "u")
        )
      });

      const raw = await readFile(body.saveReceipt.absolutePath, "utf8");
      expect(raw).not.toContain("\r");
      expect(raw).toContain("[[Learning loops]]");
      expect(parseCardMarkdown(raw)).toMatchObject({
        id: body.card.id,
        type,
        sourceReading: reading.relativePath,
        mastery: "learning"
      });
      await expectIndexContains(vaultPathRoot, {
        id: body.card.id,
        assetType: type as CardType,
        relativePath: body.card.relativePath,
        archived: false
      });
    }
  );

  it("lists recent cards from the existing index with a read-only preview and no absolute paths", async () => {
    const { app } = await initializeActiveVault();
    const reading = await createReading(app);
    const definition = await createCard(app, "definition", reading.id);
    const example = await createCard(app, "example", reading.id);

    const response = await request(app).get("/api/cards/recent?limit=10");

    expect(response.status).toBe(200);
    expect(response.body.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: definition.card.id,
          title: "definition card",
          type: "definition",
          typeLabel: "定义卡",
          relativePath: definition.card.relativePath,
          modifiedAt: expect.stringMatching(ISO_UTC_MS),
          preview: expect.objectContaining({
            concept: "Topology",
            content: expect.stringContaining("finite subcover")
          })
        }),
        expect.objectContaining({
          id: example.card.id,
          title: "example card",
          type: "example",
          typeLabel: "例子卡",
          relativePath: example.card.relativePath,
          modifiedAt: expect.stringMatching(ISO_UTC_MS),
          preview: expect.objectContaining({
            concept: "Topology",
            content: expect.stringContaining("[0, 1]")
          })
        })
      ])
    );
    expect(JSON.stringify(response.body.cards)).not.toContain("absolutePath");
  });

  it("masks unsafe legacy source paths in normal card responses", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "definition", reading.id);
    const cardPath = vaultPath(vaultPathRoot, created.card.relativePath);
    const persisted = parseCardMarkdown(await readFile(cardPath, "utf8"));
    await writeFile(
      cardPath,
      serializeCardMarkdown({
        ...persisted,
        sourceReading: "C:/Users/pcp/private-reading.md"
      }),
      "utf8"
    );
    expect(
      (
        await request(app)
          .post("/api/index/rebuild")
          .send({ confirmed: true })
      ).status
    ).toBe(200);

    const detail = await request(app).get(`/api/cards/${created.card.id}`);
    const recent = await request(app).get("/api/cards/recent?limit=10");

    expect(detail.status).toBe(200);
    expect(detail.body.card).toMatchObject({
      sourceReading: "来源阅读不可用",
      sourceReadingId: null
    });
    expect(recent.status).toBe(200);
    expect(JSON.stringify([detail.body, recent.body])).not.toContain(
      "C:/Users/pcp"
    );
  });

  it("updates a card and appends a dated revision entry", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "definition", reading.id);
    const cardPath = vaultPath(vaultPathRoot, created.card.relativePath);
    const persisted = parseCardMarkdown(await readFile(cardPath, "utf8"));
    await writeFile(
      cardPath,
      serializeCardMarkdown({
        ...persisted,
        schemaVersion: 1,
        compatibleMetadata: {}
      }),
      "utf8"
    );
    expect(await readFile(cardPath, "utf8")).not.toContain("schemaVersion:");
    const rebuilt = await request(app)
      .post("/api/index/rebuild")
      .send({ confirmed: true });
    expect(rebuilt.status).toBe(200);
    const current = await request(app).get(`/api/cards/${created.card.id}`);
    expect(current.status).toBe(200);
    expect(current.body.card.sourceReadingId).toBe(reading.id);

    const response = await request(app)
      .put(`/api/cards/${created.card.id}`)
      .send(updateCardInput(reading.id, current.body.card.version));

    expect(response.status).toBe(200);
    const updated = response.body as CardResponseBody;
    expect(updated.card.schemaVersion).toBe(2);
    expect(updated.card.relativePath).toBe(created.card.relativePath);
    expect(updated.saveReceipt.relativePath).toBe(created.card.relativePath);
    expect(updated.card.title).toBe("Updated compactness card");
    expect(updated.card.mastery).toBe("mastered");
    expect(updated.card.revisionLog).toHaveLength(2);
    expect(updated.card.revisionLog[1]).toEqual({
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      note: expect.any(String),
      reviewId: null
    });

    const raw = await readFile(
      cardPath,
      "utf8"
    );
    expect(raw).toContain("schemaVersion: 2\n");
    const parsed = parseCardMarkdown(raw);
    expect(parsed).toMatchObject({
      id: created.card.id,
      title: "Updated compactness card",
      mastery: "mastered",
      formalDefinition: "Updated formal definition."
    });
    expect(parsed.revisionLog).toHaveLength(2);

    const getUpdated = await request(app).get(`/api/cards/${created.card.id}`);
    expect(getUpdated.status).toBe(200);
    expect(getUpdated.body.card).toMatchObject({
      id: created.card.id,
      relativePath: created.card.relativePath,
      title: "Updated compactness card"
    });
    await expectIndexContains(vaultPathRoot, {
      id: created.card.id,
      assetType: "definition",
      relativePath: created.card.relativePath,
      archived: false
    });
  });

  it("archives a card by moving it under 99-归档", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "example", reading.id);
    const originalRelativePath = created.card.relativePath;
    const archiveRelativePath = `${ARCHIVE_DIRECTORY}/${originalRelativePath}`;

    const response = await request(app)
      .post(`/api/cards/${created.card.id}/archive`)
      .send({ confirmed: true, expectedVersion: created.card.version });

    expect(response.status).toBe(200);
    const archived = response.body as CardResponseBody;
    expect(archived.card.relativePath).toBe(archiveRelativePath);
    expect(archived.card.mastery).toBe("archived");
    expect(archived.saveReceipt.relativePath).toBe(archiveRelativePath);
    expect(archived.saveReceipt.absolutePath).toBe(
      await realpath(vaultPath(vaultPathRoot, archiveRelativePath))
    );
    await expect(readFile(vaultPath(vaultPathRoot, originalRelativePath), "utf8"))
      .rejects.toThrow();

    const raw = await readFile(
      vaultPath(vaultPathRoot, archiveRelativePath),
      "utf8"
    );
    const parsed = parseCardMarkdown(raw);
    expect(parsed).toMatchObject({
      id: created.card.id,
      type: "example",
      mastery: "archived"
    });
    expect(parsed.revisionLog).toHaveLength(2);

    const archivedFolders = await readdir(
      join(vaultPathRoot, ARCHIVE_DIRECTORY)
    );
    expect(archivedFolders).toContain(CARD_DIRECTORIES.example);

    const getArchived = await request(app).get(`/api/cards/${created.card.id}`);
    expect(getArchived.status).toBe(200);
    expect(getArchived.body.card).toMatchObject({
      id: created.card.id,
      relativePath: archiveRelativePath,
      mastery: "archived"
    });
    await expectIndexContains(vaultPathRoot, {
      id: created.card.id,
      assetType: "example",
      relativePath: archiveRelativePath,
      archived: true
    });
  });

  it("keeps authoritative card Markdown when its index projection fails", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const mockedApp = await createMockedAppWithFailingRebuild();

    const response = await postCard(
      mockedApp,
      "definition",
      reading.id
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      card: {
        id: expect.stringMatching(UUID_V4),
        type: "definition",
        relativePath: expect.any(String)
      },
      projectionStatus: "stale",
      projectionErrorId: expect.stringMatching(UUID_V4)
    });
    const authoritativePath = vaultPath(
      vaultPathRoot,
      response.body.card.relativePath
    );
    await expect(readFile(authoritativePath, "utf8")).resolves.toContain(
      `id: "${response.body.card.id}"`
    );
    await expect(
      readFile(
        join(vaultPathRoot, ".aleksi", "projections", "index.pending.json"),
        "utf8"
      )
    ).resolves.toContain(response.body.projectionErrorId);
  });

  it("keeps updated authoritative bytes when index rebuild fails during update", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "definition", reading.id);
    const originalPath = vaultPath(vaultPathRoot, created.card.relativePath);
    const originalRaw = await readFile(originalPath, "utf8");
    const mockedApp = await createMockedAppWithFailingRebuild();

    const response = await request(mockedApp)
      .put(`/api/cards/${created.card.id}`)
      .send(updateCardInput(reading.id, created.card.version));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      card: {
        id: created.card.id,
        title: "Updated compactness card"
      },
      projectionStatus: "stale",
      projectionErrorId: expect.stringMatching(UUID_V4)
    });
    expect(await readFile(originalPath, "utf8")).not.toBe(originalRaw);
    expect(parseCardMarkdown(await readFile(originalPath, "utf8")).revisionLog)
      .toHaveLength(2);
  });

  it("keeps the committed archive move when index rebuild fails", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "example", reading.id);
    const originalRelativePath = created.card.relativePath;
    const archiveRelativePath = `${ARCHIVE_DIRECTORY}/${originalRelativePath}`;
    const originalPath = vaultPath(vaultPathRoot, originalRelativePath);
    const archivePath = vaultPath(vaultPathRoot, archiveRelativePath);
    const mockedApp = await createMockedAppWithFailingRebuild();

    const response = await request(mockedApp)
      .post(`/api/cards/${created.card.id}/archive`)
      .send({ confirmed: true, expectedVersion: created.card.version });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      card: {
        id: created.card.id,
        relativePath: archiveRelativePath,
        mastery: "archived"
      },
      projectionStatus: "stale",
      projectionErrorId: expect.stringMatching(UUID_V4)
    });
    await expect(readFile(originalPath, "utf8")).rejects.toThrow();
    await expect(readFile(archivePath, "utf8")).resolves.toContain(
      'mastery: "archived"'
    );
  });

  it("rejects archive target collisions without moving or overwriting files", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "example", reading.id);
    const originalRelativePath = created.card.relativePath;
    const archiveRelativePath = `${ARCHIVE_DIRECTORY}/${originalRelativePath}`;
    const originalPath = vaultPath(vaultPathRoot, originalRelativePath);
    const archivePath = vaultPath(vaultPathRoot, archiveRelativePath);
    const originalRaw = await readFile(originalPath, "utf8");
    const collidingRaw = "preexisting archive target\n";
    await mkdir(join(vaultPathRoot, ARCHIVE_DIRECTORY, CARD_DIRECTORIES.example), {
      recursive: true
    });
    await writeFile(archivePath, collidingRaw, "utf8");

    const response = await request(app)
      .post(`/api/cards/${created.card.id}/archive`)
      .send({ confirmed: true, expectedVersion: created.card.version });

    expectApiError(response, "ARCHIVE_TARGET_EXISTS");
    await expect(readFile(originalPath, "utf8")).resolves.toBe(originalRaw);
    await expect(readFile(archivePath, "utf8")).resolves.toBe(collidingRaw);
  });

  it("rejects symlinked archive subdirectories before moving a card", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "example", reading.id);
    const originalRelativePath = created.card.relativePath;
    const originalPath = vaultPath(vaultPathRoot, originalRelativePath);
    const originalRaw = await readFile(originalPath, "utf8");
    const outsidePath = join(vaultPathRoot, "outside-archive-target");
    const archiveSubdir = join(
      vaultPathRoot,
      ARCHIVE_DIRECTORY,
      CARD_DIRECTORIES.example
    );
    await mkdir(outsidePath);

    try {
      await symlink(outsidePath, archiveSubdir, "junction");
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

    const response = await request(app)
      .post(`/api/cards/${created.card.id}/archive`)
      .send({ confirmed: true, expectedVersion: created.card.version });

    expectApiError(response, "ARCHIVE_DESTINATION_UNSAFE");
    await expect(readFile(originalPath, "utf8")).resolves.toBe(originalRaw);
    await expect(readdir(outsidePath)).resolves.toEqual([]);
  });

  it("rejects a symlinked archive root before creating nested archive directories", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "example", reading.id);
    const originalPath = vaultPath(vaultPathRoot, created.card.relativePath);
    const originalRaw = await readFile(originalPath, "utf8");
    const outsidePath = join(vaultPathRoot, "outside-archive-root");
    const archiveRoot = join(vaultPathRoot, ARCHIVE_DIRECTORY);
    await mkdir(outsidePath);
    await rm(archiveRoot, { force: true, recursive: true });

    try {
      await symlink(outsidePath, archiveRoot, "junction");
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

    const response = await request(app)
      .post(`/api/cards/${created.card.id}/archive`)
      .send({ confirmed: true, expectedVersion: created.card.version });

    expectApiError(response, "ARCHIVE_DESTINATION_UNSAFE");
    await expect(readFile(originalPath, "utf8")).resolves.toBe(originalRaw);
    await expect(readdir(outsidePath)).resolves.toEqual([]);
  });

  it("rejects indexed card file symlinks without returning outside content", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "definition", reading.id);
    const originalPath = vaultPath(vaultPathRoot, created.card.relativePath);
    const originalRaw = await readFile(originalPath, "utf8");
    const outsidePath = join(vaultPathRoot, "outside-card.md");
    const outsideRaw = originalRaw.replaceAll("definition card", "outside card");
    await writeFile(outsidePath, outsideRaw, "utf8");
    await rm(originalPath);

    try {
      await symlink(outsidePath, originalPath, "file");
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

    const response = await request(app).get(`/api/cards/${created.card.id}`);

    expectApiError(response, "CARD_PATH_UNSAFE");
    expect(JSON.stringify(response.body)).not.toContain("outside card");
    await expect(readFile(outsidePath, "utf8")).resolves.toBe(outsideRaw);
  });

  it("rejects updates to archived cards without mutating archived bytes", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "example", reading.id);
    const archive = await request(app)
      .post(`/api/cards/${created.card.id}/archive`)
      .send({ confirmed: true, expectedVersion: created.card.version });
    expect(archive.status).toBe(200);
    const archived = archive.body as CardResponseBody;
    const archivedPath = vaultPath(vaultPathRoot, archived.card.relativePath);
    const archivedRaw = await readFile(archivedPath, "utf8");

    const response = await request(app)
      .put(`/api/cards/${created.card.id}`)
      .send({
        title: "Updated archived example",
        concept: "Topology",
        relatedConcepts: [],
        sourceReadingId: reading.id,
        excerpt: "Updated excerpt.",
        understanding: "",
        blockType: null,
        nextAction: "",
        mastery: "learning",
        exampleContent: "Updated example.",
        whyItFits: "Updated fit.",
        trainingPurpose: ""
      });

    expectApiError(response, "CARD_ALREADY_ARCHIVED");
    await expect(readFile(archivedPath, "utf8")).resolves.toBe(archivedRaw);
    expect(parseCardMarkdown(archivedRaw).mastery).toBe("archived");
  });

  it("rejects strict create body server-owned fields without mutation", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const before = await cardDirectoryFilenames(vaultPathRoot, "definition");
    const invalidFields = [
      { id: "11111111-1111-4111-8111-111111111111" },
      { createdAt: "2026-06-22T03:14:15.926Z" },
      { nextReview: "2026-06-23" },
      { sourceReading: reading.relativePath },
      { relativePath: `${CARD_DIRECTORIES.definition}/evil.md` },
      { revisionLog: [{ at: "2026-06-22", note: "client", reviewId: null }] },
      { mastery: "learning" }
    ];

    for (const invalidField of invalidFields) {
      const response = await request(app)
        .post("/api/cards")
        .send({
          ...createCardInput("definition", reading.id),
          ...invalidField
        });

      expectApiError(response, "INVALID_REQUEST_BODY");
      expect(await cardDirectoryFilenames(vaultPathRoot, "definition")).toEqual(
        before
      );
    }
  });

  it("rejects forbidden update fields and mastery values without mutation", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "definition", reading.id);
    const originalPath = vaultPath(vaultPathRoot, created.card.relativePath);
    const originalRaw = await readFile(originalPath, "utf8");

    for (const invalidField of [
      { mastery: "due" },
      { mastery: "archived" },
      { nextReview: "2026-06-23" }
    ]) {
      const response = await request(app)
        .put(`/api/cards/${created.card.id}`)
        .send({
          ...updateCardInput(reading.id, created.card.version),
          ...invalidField
        });

      expectApiError(response, "INVALID_REQUEST_BODY");
      expect(await readFile(originalPath, "utf8")).toBe(originalRaw);
    }
  });

  it("rejects missing or invalid sourceReadingId without mutation", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const before = await cardDirectoryFilenames(vaultPathRoot, "definition");
    const missingCreate = createCardInput("definition", reading.id);
    const {
      sourceReadingId: _createSourceReadingId,
      ...missingCreateSource
    } = missingCreate;

    const createMissing = await request(app)
      .post("/api/cards")
      .send(missingCreateSource);
    const createInvalid = await request(app)
      .post("/api/cards")
      .send(
        createCardInput(
          "definition",
          "11111111-1111-4111-8111-111111111111"
        )
      );

    expectApiError(createMissing, "INVALID_REQUEST_BODY");
    expectApiError(createInvalid, "READING_NOT_FOUND");
    expect(await cardDirectoryFilenames(vaultPathRoot, "definition")).toEqual(
      before
    );

    const created = await createCard(app, "definition", reading.id);
    const originalPath = vaultPath(vaultPathRoot, created.card.relativePath);
    const originalRaw = await readFile(originalPath, "utf8");
    const updateMissing = updateCardInput(reading.id, created.card.version);
    const {
      sourceReadingId: _updateSourceReadingId,
      ...missingUpdateSource
    } = updateMissing;

    const updateMissingResponse = await request(app)
      .put(`/api/cards/${created.card.id}`)
      .send(missingUpdateSource);
    const updateInvalidResponse = await request(app)
      .put(`/api/cards/${created.card.id}`)
      .send(
        updateCardInput(
          "22222222-2222-4222-8222-222222222222",
          created.card.version
        )
      );

    expectApiError(updateMissingResponse, "INVALID_REQUEST_BODY");
    expectApiError(updateInvalidResponse, "READING_NOT_FOUND");
    await expect(readFile(originalPath, "utf8")).resolves.toBe(originalRaw);
  });

  it("rejects archive confirmation bodies without mutation", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const created = await createCard(app, "example", reading.id);
    const originalRelativePath = created.card.relativePath;
    const archiveRelativePath = `${ARCHIVE_DIRECTORY}/${originalRelativePath}`;
    const originalPath = vaultPath(vaultPathRoot, originalRelativePath);
    const archivePath = vaultPath(vaultPathRoot, archiveRelativePath);
    const originalRaw = await readFile(originalPath, "utf8");

    for (const body of [{ confirmed: false }, {}, { confirmed: true, extra: true }]) {
      const response = await request(app)
        .post(`/api/cards/${created.card.id}/archive`)
        .send(body);

      expectApiError(response, "INVALID_ARCHIVE_CONFIRMATION");
      await expect(readFile(originalPath, "utf8")).resolves.toBe(originalRaw);
      await expect(readFile(archivePath, "utf8")).rejects.toThrow();
    }
  });

  it("does not expose a permanent delete route", async () => {
    const { app } = await initializeActiveVault();

    const response = await request(app).delete(
      "/api/cards/11111111-1111-4111-8111-111111111111"
    );

    expect(response.status).toBe(404);
  });
});
