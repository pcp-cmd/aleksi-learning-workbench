import { stat } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { readJsonFile, createTempVaultContext } from "../temp-vault";

const NOW = "2026-06-22T03:14:15.926Z";

afterEach(() => {
  vi.useRealTimers();
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

async function createReading(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await request(app).post("/api/readings").send({
    title: "ε-N 定义阅读",
    concept: "ε-N",
    body: "对任意 ε > 0，存在 N，使得 n>N 时距离小于 ε。",
    source: "manual-paste"
  });

  expect(response.status).toBe(200);
  return response.body.reading.id as string;
}

async function createDefinitionCard(
  app: ReturnType<typeof createApp>,
  sourceReadingId: string
): Promise<string> {
  const response = await request(app).post("/api/cards").send({
    type: "concept",
    title: "ε-N 概念卡",
    concept: "ε-N",
    relatedConcepts: [],
    sourceReadingId,
    excerpt: "对任意 ε > 0，存在 N。",
    understanding: "",
    blockType: null,
    nextAction: "",
    formalExplanation: "∀ε>0, ∃N, n>N ⇒ |x_n-a|<ε。",
    myUnderstanding: "先给精度，再找稳定阶段。",
    commonMisunderstanding: "N 可以依赖 ε，但不能依赖 n。",
    usageContext: "判断数列是否收敛。"
  });

  expect(response.status).toBe(200);
  return response.body.card.id as string;
}

describe("graph API", () => {
  it("rebuilds and returns the cached concept flywheel state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { app, vaultPath } = await initializeActiveVault();
    const readingId = await createReading(app);
    await createDefinitionCard(app, readingId);

    const response = await request(app).get("/api/graph/state");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      generatedAt: NOW,
      sourceIndexFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      concepts: {
        "ε-N": {
          concept: "ε-N",
          rings: {
            concept: {
              count: 1,
              coverage: "established",
              learningStatus: "learning",
              evidenceConfidence: "unverified"
            },
            example: {
              count: 0,
              coverage: "missing",
              learningStatus: "not-started",
              evidenceConfidence: "unverified"
            },
            boundary: {
              count: 0,
              coverage: "missing",
              learningStatus: "not-started",
              evidenceConfidence: "unverified"
            },
            process: {
              count: 0,
              coverage: "missing",
              learningStatus: "not-started",
              evidenceConfidence: "unverified"
            },
            mistake: {
              count: 0,
              coverage: "missing",
              learningStatus: "not-started",
              evidenceConfidence: "unverified"
            }
          },
          currentBlock: null,
          nextAction: "补 1 张例子卡",
          hasDueReview: false,
          relatedConcepts: [],
          suggestedNextActions: [
            "补 1 张例子卡",
            "补 1 张边界卡",
            "补 1 张流程卡",
            "补 1 张错误卡"
          ]
        }
      }
    });

    const cachePath = join(vaultPath, ".aleksi", "graph-state.json");
    await expect(readJsonFile(cachePath)).resolves.toEqual(response.body);
    const firstMtime = (await stat(cachePath)).mtimeMs;
    const second = await request(app).get("/api/graph/state");
    expect(second.status).toBe(200);
    expect(second.body).toEqual(response.body);
    expect((await stat(cachePath)).mtimeMs).toBe(firstMtime);
  });
});
