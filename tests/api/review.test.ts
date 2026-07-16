import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { parseCardMarkdown } from "../../server/lib/markdown-codec";
import {
  LEGACY_REVIEW_DIRECTORY,
  REVIEW_DIRECTORY
} from "../../shared/vault-map";
import { createTempVaultContext, readJsonFile } from "../temp-vault";

const REVIEW_KEY = "11111111-1111-4111-8111-111111111111";
const ANSWER_SENTINEL = "ANSWER_SENTINEL_FOR_QUEUE_PRIVACY";

type IndexJson = {
  assets: Array<{
    id: string;
    assetType: string;
    concept: string | null;
    mastery: string | null;
    nextReview: string | null;
  }>;
};

afterEach(() => {
  vi.useRealTimers();
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

async function createReading(
  app: ReturnType<typeof createApp>
): Promise<{ id: string; relativePath: string }> {
  const response = await request(app).post("/api/readings").send({
    title: "数列极限 ε-N 定义",
    concept: "数列极限",
    body: "对任意 ε > 0，存在 N，使得 n>N 时距离小于 ε。",
    source: "manual-paste"
  });

  expect(response.status).toBe(200);
  return {
    id: response.body.reading.id,
    relativePath: response.body.reading.relativePath
  };
}

async function createDefinitionCard(
  app: ReturnType<typeof createApp>,
  sourceReadingId: string
): Promise<{ id: string; relativePath: string }> {
  const response = await request(app).post("/api/cards").send({
    type: "definition",
    title: "ε-N 定义卡",
    concept: "数列极限",
    relatedConcepts: ["极限"],
    sourceReadingId,
    excerpt: "对任意 ε > 0，存在 N。",
    understanding: "这是先给精度再找阶段的结构。",
    blockType: "definition",
    nextAction: "补一个反例来区分量词顺序。",
    formalDefinition: `${ANSWER_SENTINEL}：∀ε>0, ∃N, n>N ⇒ |x_n-a|<ε。`,
    plainExplanation: "后面的项会稳定进入任意小邻域。",
    quantifierStructure: "∀ε ∃N ∀n",
    commonMisunderstandings: "N 可以依赖 ε，但不能依赖 n。"
  });

  expect(response.status).toBe(200);
  return {
    id: response.body.card.id,
    relativePath: response.body.card.relativePath
  };
}

async function createDueCard(): Promise<{
  app: ReturnType<typeof createApp>;
  vaultPath: string;
  card: { id: string; relativePath: string };
}> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-22T03:14:15.926Z"));
  const { app, vaultPath } = await initializeActiveVault();
  const reading = await createReading(app);
  const card = await createDefinitionCard(app, reading.id);
  vi.setSystemTime(new Date("2026-06-23T03:14:15.926Z"));
  return { app, vaultPath, card };
}

function reviewIdFor(cardId: string, key: string): string {
  return `review-${createHash("sha256")
    .update(`${cardId}\u0000${key.toLowerCase()}`, "utf8")
    .digest("hex")}`;
}

function attemptBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: REVIEW_KEY,
    answer: "先给任意精度，再找到统一控制后续项的阶段。",
    declaredDontKnow: false,
    confidenceBeforeReveal: 3,
    durationMs: 42_000,
    assistanceLevel: "none",
    ...overrides
  };
}

function resultBody(
  attemptId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    attemptId,
    feedback: "known",
    blockType: null,
    selfCorrection: "",
    diagnosisDraft: null,
    ...overrides
  };
}

function weakResultBody(
  attemptId: string,
  feedback: "forgot" | "fuzzy"
) {
  return resultBody(attemptId, {
    feedback,
    blockType: "definition",
    selfCorrection: "N 依赖 ε，但不能依赖 n。",
    diagnosisDraft: {
      assumedProblem: "我以为只是记不住符号。",
      causeHypothesis: "量词依赖关系还没有形成稳定提取线索。",
      nextMinimumAction: "闭卷写一次量词顺序，再造一个错误顺序反例。",
      targetCardType: "boundary"
    }
  });
}

function vaultPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

function expectApiError(
  response: SupertestResponse,
  code: string
): void {
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThanOrEqual(409);
  expect(response.body).toMatchObject({
    error: {
      code,
      message: expect.any(String)
    }
  });
}

describe("review evidence API", () => {
  it("reads an existing attempt from the legacy review directory without moving it", async () => {
    const { app, vaultPath: vaultRoot, card } = await createDueCard();
    const expectedReviewId = reviewIdFor(card.id, REVIEW_KEY);
    const attempt = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(attemptBody());
    expect(attempt.status).toBe(201);

    const legacyDirectory = join(vaultRoot, LEGACY_REVIEW_DIRECTORY);
    await mkdir(legacyDirectory, { recursive: true });
    await rename(
      join(vaultRoot, REVIEW_DIRECTORY, `${expectedReviewId}.md`),
      join(legacyDirectory, `${expectedReviewId}.md`)
    );

    const resumed = await request(app).get(
      `/api/review/attempts/${expectedReviewId}`
    );
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({
      attemptId: expectedReviewId,
      answer: attemptBody().answer
    });
    await expect(
      readFile(join(legacyDirectory, `${expectedReviewId}.md`), "utf8")
    ).resolves.toContain("commitState: \"attempted\"");
  });

  it("keeps the due queue and its cache answer-free", async () => {
    const { app, vaultPath: vaultRoot, card } = await createDueCard();

    const response = await request(app).get("/api/review/today");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      generatedAt: "2026-06-23T03:14:15.926Z",
      items: [
        {
          cardId: card.id,
          cardPath: card.relativePath,
          cardType: "definition",
          concept: "数列极限",
          mastery: "due",
          nextReview: "2026-06-23",
          lastReviewSequence: null,
          lastReviewed: null,
          due: true,
          prompt: expect.any(String)
        }
      ]
    });
    expect(response.body.items[0]).not.toHaveProperty("card");
    expect(JSON.stringify(response.body)).not.toContain(ANSWER_SENTINEL);

    const queuePath = join(vaultRoot, ".aleksi", "review-queue.json");
    const queueCache = await readFile(queuePath, "utf8");
    expect(queueCache).not.toContain(ANSWER_SENTINEL);
    expect(queueCache).not.toContain("formalDefinition");
    const firstMtime = (await stat(queuePath)).mtimeMs;
    const second = await request(app).get("/api/review/today");
    expect(second.body).toEqual(response.body);
    expect((await stat(queuePath)).mtimeMs).toBe(firstMtime);

    await writeFile(queuePath, "{broken projection\n", "utf8");
    const recovered = await request(app).get("/api/review/today");
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual(response.body);
    await expect(readJsonFile(queuePath)).resolves.toEqual(response.body);
  });

  it("persists an attempt before reveal, resumes it, and commits evidence idempotently", async () => {
    const { app, vaultPath: vaultRoot, card } = await createDueCard();
    const expectedReviewId = reviewIdFor(card.id, REVIEW_KEY);

    const attempt = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(attemptBody());

    expect(attempt.status).toBe(201);
    expect(attempt.body).toMatchObject({
      attemptId: expectedReviewId,
      replayed: false,
      promptVersion: "recall-v1",
      revealedCard: {
        id: card.id,
        formalDefinition: expect.stringContaining(ANSWER_SENTINEL)
      }
    });

    const resumed = await request(app).get(
      `/api/review/attempts/${expectedReviewId}`
    );
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({
      attemptId: expectedReviewId,
      cardId: card.id,
      answer: attemptBody().answer,
      confidenceBeforeReveal: 3,
      assistanceLevel: "none"
    });

    const first = await request(app)
      .post(`/api/review/${card.id}/result`)
      .send(resultBody(expectedReviewId));
    const replay = await request(app)
      .post(`/api/review/${card.id}/result`)
      .send(resultBody(expectedReviewId));

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      result: {
        reviewId: expectedReviewId,
        cardId: card.id,
        feedback: "known",
        blockType: null,
        reviewSequence: 1,
        intervalDays: 7,
        nextReview: "2026-06-30",
        nextMastery: "learning",
        evidenceQuality: "independent"
      },
      replayed: false,
      projectionStatus: "fresh"
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({
      ...first.body,
      replayed: true
    });

    const cardRaw = await readFile(
      vaultPath(vaultRoot, card.relativePath),
      "utf8"
    );
    expect(parseCardMarkdown(cardRaw)).toMatchObject({
      nextReview: "2026-06-30",
      mastery: "learning",
      lastAppliedReviewId: expectedReviewId,
      lastAppliedReviewSequence: 1,
      pendingReviewId: null
    });

    const reviewFiles = await readdir(join(vaultRoot, REVIEW_DIRECTORY));
    expect(reviewFiles).toEqual([`${expectedReviewId}.md`]);
    const reviewRaw = await readFile(
      join(vaultRoot, REVIEW_DIRECTORY, `${expectedReviewId}.md`),
      "utf8"
    );
    expect(reviewRaw).toContain("schemaVersion: 2");
    expect(reviewRaw).toContain('commitState: "committed"');
    expect(reviewRaw).toContain("先给任意精度");
    expect(reviewRaw).toContain("## 自我纠正");

    const index = await readJsonFile<IndexJson>(
      join(vaultRoot, ".aleksi", "index.json")
    );
    expect(index.assets).toContainEqual(
      expect.objectContaining({
        id: expectedReviewId,
        assetType: "review",
        concept: "数列极限"
      })
    );
  });

  it("requires a correction draft for weak evidence and caps assisted intervals", async () => {
    const { app, card } = await createDueCard();
    const key = crypto.randomUUID();
    const attempt = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(attemptBody({ idempotencyKey: key, assistanceLevel: "source" }));

    const invalid = await request(app)
      .post(`/api/review/${card.id}/result`)
      .send(resultBody(attempt.body.attemptId, { feedback: "fuzzy" }));
    expectApiError(invalid, "INVALID_REQUEST_BODY");

    const weak = await request(app)
      .post(`/api/review/${card.id}/result`)
      .send(weakResultBody(attempt.body.attemptId, "fuzzy"));

    expect(weak.status).toBe(201);
    expect(weak.body.result).toMatchObject({
      feedback: "fuzzy",
      intervalDays: 3,
      nextMastery: "rebuild",
      evidenceQuality: "insufficient"
    });

    vi.setSystemTime(new Date("2026-06-26T03:14:15.926Z"));
    const dontKnowAttempt = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(
        attemptBody({
          idempotencyKey: crypto.randomUUID(),
          answer: "",
          declaredDontKnow: true,
          confidenceBeforeReveal: 1,
          assistanceLevel: "none"
        })
      );
    const revealedSelfRating = await request(app)
      .post(`/api/review/${card.id}/result`)
      .send(
        resultBody(dontKnowAttempt.body.attemptId, {
          feedback: "fluent"
        })
      );
    expect(revealedSelfRating.status).toBe(201);
    expect(revealedSelfRating.body.result).toMatchObject({
      feedback: "fluent",
      intervalDays: 3,
      nextMastery: "rebuild",
      evidenceQuality: "insufficient"
    });
  });

  it("serializes concurrent results for one card without duplicate sequences or rollback loss", async () => {
    const { app, vaultPath: vaultRoot, card } = await createDueCard();
    const firstAttempt = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(attemptBody({ idempotencyKey: crypto.randomUUID() }));
    const secondAttempt = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(
        attemptBody({
          idempotencyKey: crypto.randomUUID(),
          answer: "另一份独立回答"
        })
      );

    const responses = await Promise.all([
      request(app)
        .post(`/api/review/${card.id}/result`)
        .send(resultBody(firstAttempt.body.attemptId)),
      request(app)
        .post(`/api/review/${card.id}/result`)
        .send(resultBody(secondAttempt.body.attemptId))
    ]);
    const committed = responses.find((response) => response.status === 201);
    const stale = responses.find((response) => response.status === 409);

    expect(committed?.body.result.reviewSequence).toBe(1);
    expect(stale?.body.error.code).toBe("REVIEW_ATTEMPT_STALE");

    const cardRaw = await readFile(
      vaultPath(vaultRoot, card.relativePath),
      "utf8"
    );
    expect(parseCardMarkdown(cardRaw).lastAppliedReviewSequence).toBe(1);
    const index = await readJsonFile<IndexJson>(
      join(vaultRoot, ".aleksi", "index.json")
    );
    expect(
      index.assets.filter((asset) => asset.assetType === "review")
    ).toHaveLength(1);
  });

  it("never promotes a card to mastered from one review result", async () => {
    const expectations = [
      ["forgot", 1, "rebuild"],
      ["fuzzy", 3, "rebuild"],
      ["known", 7, "learning"],
      ["fluent", 14, "learning"]
    ] as const;

    for (const [feedback, intervalDays, nextMastery] of expectations) {
      const { app, card } = await createDueCard();
      const attempt = await request(app)
        .post(`/api/review/${card.id}/attempt`)
        .send(attemptBody({ idempotencyKey: crypto.randomUUID() }));
      const body =
        feedback === "forgot" || feedback === "fuzzy"
          ? weakResultBody(attempt.body.attemptId, feedback)
          : resultBody(attempt.body.attemptId, { feedback });
      const result = await request(app)
        .post(`/api/review/${card.id}/result`)
        .send(body);

      expect(result.status).toBe(201);
      expect(result.body.result).toMatchObject({
        feedback,
        intervalDays,
        nextMastery
      });
      expect(result.body.result.nextMastery).not.toBe("mastered");
    }
  });

  it("rejects idempotency conflicts, route mismatches, stale cards, and unknown fields", async () => {
    const { app, vaultPath: vaultRoot, card } = await createDueCard();
    const first = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(attemptBody());
    const replay = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(attemptBody());

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);

    const changed = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(attemptBody({ answer: "同一个键下的另一份回答" }));
    expectApiError(changed, "IDEMPOTENCY_KEY_REUSE");

    const mismatch = await request(app)
      .post(`/api/review/${crypto.randomUUID()}/result`)
      .send(resultBody(first.body.attemptId));
    expectApiError(mismatch, "REVIEW_ATTEMPT_CARD_MISMATCH");

    const invalidAttempt = await request(app)
      .post(`/api/review/${card.id}/attempt`)
      .send(attemptBody({ mastery: "mastered" }));
    expectApiError(invalidAttempt, "INVALID_REQUEST_BODY");

    const cardPath = vaultPath(vaultRoot, card.relativePath);
    const originalCard = await readFile(cardPath, "utf8");
    const changedCard = originalCard.replace(
      "补一个反例来区分量词顺序。",
      "卡片在揭示后被编辑。"
    );
    expect(changedCard).not.toBe(originalCard);
    await writeFile(cardPath, changedCard, "utf8");

    const stale = await request(app)
      .post(`/api/review/${card.id}/result`)
      .send(resultBody(first.body.attemptId));
    expectApiError(stale, "REVIEW_ATTEMPT_STALE");
    await expect(readFile(cardPath, "utf8")).resolves.toBe(changedCard);
  });
});
