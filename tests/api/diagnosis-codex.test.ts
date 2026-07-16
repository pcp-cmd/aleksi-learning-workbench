import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import type { BlockType } from "../../server/domain/types";
import {
  CODEX_TASK_DIRECTORY as CODEX_DIRECTORY,
  DIAGNOSIS_DIRECTORY
} from "../../shared/vault-map";
import { createTempVaultContext, readJsonFile } from "../temp-vault";

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const BLOCK_TYPES = [
  "definition",
  "example",
  "counterexample",
  "proof-search",
  "technical",
  "expression",
  "transfer",
  "emotion"
] as const satisfies readonly BlockType[];

const REQUESTED_ACTIONS = [
  "请先复述我当前材料中已经明确的事实。",
  "请指出我卡住的最小前提、定义缺口或例子缺口。",
  "请给我一个不直接替我完成证明或答案的提示。",
  "请设计一个我可以自己做的下一步检查。",
  "请建议我应该沉淀成哪一种 Aleksi 卡片，并说明原因。"
] as const;

type IndexJson = {
  assets: Array<{
    id: string;
    assetType: string;
    title: string;
    concept: string | null;
    relativePath: string;
    updatedAt: string;
    archived: boolean;
  }>;
};

afterEach(() => {
  vi.resetModules();
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
    body: "如果 n 足够大，那么 |x_n-a| 可以任意小。",
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
    understanding: "这是一个先给精度再找阶段的结构。",
    blockType: "definition",
    nextAction: "补一个反例来区分量词顺序。",
    formalDefinition: "∀ε>0, ∃N, n>N ⇒ |x_n-a|<ε。",
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

function diagnosisInput(
  blockType: BlockType,
  relatedCardId?: string
): Record<string, unknown> {
  return {
    concept: "数列极限",
    ...(relatedCardId === undefined ? {} : { relatedCardId }),
    blockType,
    manifestation: "我能背定义，但不知道证明里什么时候该先选 ε。",
    assumedProblem: "我以为是计算技巧不够熟。",
    actualCause: "真实原因是量词依赖关系没有被拆开。",
    nextMinimumAction: "写出 ε、N、n 三者谁先谁后的依赖表。",
    targetCardType: "definition"
  };
}

function codexTaskInput(
  sourceReadingId: string,
  relatedCardId: string
): Record<string, unknown> {
  return {
    concept: "数列极限",
    sourceReadingId,
    relatedCardId,
    currentMaterial:
      "我正在读数列极限的 ε-N 定义，材料强调先给 ε，再找 N。",
    understanding:
      "我知道 N 可以依赖 ε，但证明里经常不知道该把哪个量固定下来。",
    blockType: "proof-search"
  };
}

async function filenames(
  vaultPath: string,
  directory: string
): Promise<string[]> {
  return (await readdir(join(vaultPath, directory))).sort();
}

function vaultPath(vaultPathRoot: string, relativePath: string): string {
  return join(vaultPathRoot, ...relativePath.split("/"));
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

describe("diagnosis and Codex task APIs", () => {
  it("persists one diagnosis for each supported block type with required Chinese sections", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const card = await createDefinitionCard(app, reading.id);

    for (const blockType of BLOCK_TYPES) {
      const response = await request(app)
        .post("/api/diagnoses")
        .send(diagnosisInput(blockType, card.id));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        diagnosis: {
          id: expect.stringMatching(UUID_V4),
          type: "diagnosis",
          title: "卡点诊断：数列极限",
          concept: "数列极限",
          relatedCard: card.relativePath,
          blockType,
          manifestation: "我能背定义，但不知道证明里什么时候该先选 ε。",
          assumedProblem: "我以为是计算技巧不够熟。",
          actualCause: "真实原因是量词依赖关系没有被拆开。",
          nextMinimumAction: "写出 ε、N、n 三者谁先谁后的依赖表。",
          targetCardType: "definition",
          createdAt: expect.stringMatching(ISO_UTC_MS),
          relativePath: expect.stringMatching(
            new RegExp(`^${DIAGNOSIS_DIRECTORY}/.+\\.md$`, "u")
          ),
          modifiedAt: expect.stringMatching(ISO_UTC_MS)
        },
        saveReceipt: {
          relativePath: expect.stringMatching(
            new RegExp(`^${DIAGNOSIS_DIRECTORY}/.+\\.md$`, "u")
          ),
          absolutePath: expect.any(String),
          modifiedAt: expect.stringMatching(ISO_UTC_MS)
        }
      });

      const relativePath = response.body.diagnosis.relativePath as string;
      const raw = await readFile(vaultPath(vaultPathRoot, relativePath), "utf8");
      expect(raw).not.toContain("\r");
      expect(raw).toContain('type: "diagnosis"');
      expect(raw).toContain(`blockType: "${blockType}"`);
      expect(raw).toContain('targetCardType: "definition"');
      expect(raw).toContain("所属概念：[[数列极限]]");
      expect(raw).toContain(`关联卡片：[[${card.relativePath.replace(/\.md$/u, "")}|ε-N 定义卡]]`);
      expect(raw).toContain("## 具体表现");
      expect(raw).toContain("## 我一开始以为的问题");
      expect(raw).toContain("## 现在判断的真实原因");
      expect(raw).toContain("## 下一步最小行动");
      expect(raw).toContain("## 要沉淀成哪类卡片");
    }

    const index = await readJsonFile<IndexJson>(
      join(vaultPathRoot, ".aleksi", "index.json")
    );
    const diagnoses = index.assets.filter(
      (asset) => asset.assetType === "diagnosis"
    );
    expect(diagnoses).toHaveLength(BLOCK_TYPES.length);
    expect(diagnoses.map((asset) => asset.concept)).toEqual(
      BLOCK_TYPES.map(() => "数列极限")
    );
  });

  it("rejects unknown diagnosis block types and server-owned fields without mutation", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const before = await filenames(vaultPathRoot, DIAGNOSIS_DIRECTORY);

    for (const body of [
      { ...diagnosisInput("definition"), blockType: "intuition" },
      { ...diagnosisInput("definition"), id: crypto.randomUUID() },
      { ...diagnosisInput("definition"), createdAt: "2026-06-22T03:14:15.926Z" },
      { ...diagnosisInput("definition"), relativePath: `${DIAGNOSIS_DIRECTORY}/evil.md` },
      { ...diagnosisInput("definition"), absolutePath: join(vaultPathRoot, DIAGNOSIS_DIRECTORY, "evil.md") },
      { ...diagnosisInput("definition"), reviewedAt: "2026-06-22T03:14:15.926Z" },
      { ...diagnosisInput("definition"), revisionLog: [] },
      { ...diagnosisInput("definition"), provenance: { source: "client" } },
      { ...diagnosisInput("definition"), relatedCard: "02-定义卡/evil.md" },
      { ...diagnosisInput("definition"), filename: "evil.md" }
    ]) {
      const response = await request(app).post("/api/diagnoses").send(body);

      expectApiError(response);
      expect(await filenames(vaultPathRoot, DIAGNOSIS_DIRECTORY)).toEqual(
        before
      );
    }

    const unresolvedCard = await request(app)
      .post("/api/diagnoses")
      .send({
        ...diagnosisInput("definition"),
        relatedCardId: crypto.randomUUID()
      });

    expectApiError(unresolvedCard, "CARD_NOT_FOUND");
    expect(await filenames(vaultPathRoot, DIAGNOSIS_DIRECTORY)).toEqual(
      before
    );
  });

  it("generates a Codex task file with material, understanding, five actions, and the learning guardrail", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const card = await createDefinitionCard(app, reading.id);

    const response = await request(app)
      .post("/api/codex/tasks")
      .send(codexTaskInput(reading.id, card.id));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      codexTask: {
        id: expect.stringMatching(UUID_V4),
        type: "codex-task",
        title: "Codex 任务：数列极限卡点诊断",
        concept: "数列极限",
        sourceReading: reading.relativePath,
        relatedCard: card.relativePath,
        currentMaterial:
          "我正在读数列极限的 ε-N 定义，材料强调先给 ε，再找 N。",
        understanding:
          "我知道 N 可以依赖 ε，但证明里经常不知道该把哪个量固定下来。",
        blockType: "proof-search",
        requestedActions: [...REQUESTED_ACTIONS],
        learningGuardrail: expect.stringContaining("Do not replace my learning"),
        createdAt: expect.stringMatching(ISO_UTC_MS),
        relativePath: expect.stringMatching(
          new RegExp(`^${CODEX_DIRECTORY}/\\d{8}-.+\\.md$`, "u")
        ),
        modifiedAt: expect.stringMatching(ISO_UTC_MS)
      },
      saveReceipt: {
        relativePath: expect.stringMatching(
          new RegExp(`^${CODEX_DIRECTORY}/\\d{8}-.+\\.md$`, "u")
        ),
        absolutePath: expect.any(String),
        modifiedAt: expect.stringMatching(ISO_UTC_MS)
      }
    });

    const relativePath = response.body.codexTask.relativePath as string;
    const raw = await readFile(vaultPath(vaultPathRoot, relativePath), "utf8");
    expect(raw).not.toContain("\r");
    expect(raw).toContain('type: "codex-task"');
    expect(raw).toContain('blockType: "proof-search"');
    expect(raw).toContain('sourceReading: ');
    expect(raw).toContain('relatedCard: ');
    expect(raw).toContain("## 当前材料");
    expect(raw).toContain("## 我的理解");
    expect(raw).toContain("## 当前卡点");
    expect(raw).toContain("## 请你执行");
    expect(raw).toContain("## 学习边界");
    expect(raw).toContain("Do not replace my learning");
    for (const [index, action] of REQUESTED_ACTIONS.entries()) {
      expect(raw).toContain(`${index + 1}. ${action}`);
    }

    const index = await readJsonFile<IndexJson>(
      join(vaultPathRoot, ".aleksi", "index.json")
    );
    expect(index.assets).toContainEqual(
      expect.objectContaining({
        id: response.body.codexTask.id,
        assetType: "codex-task",
        title: "Codex 任务：数列极限卡点诊断",
        concept: "数列极限",
        relativePath,
        archived: false
      })
    );
  });

  it("rejects Codex task server-owned fields and unresolved references without mutation", async () => {
    const { app, vaultPath: vaultPathRoot } = await initializeActiveVault();
    const reading = await createReading(app);
    const card = await createDefinitionCard(app, reading.id);
    const before = await filenames(vaultPathRoot, CODEX_DIRECTORY);

    const strictBodies = [
      { ...codexTaskInput(reading.id, card.id), id: crypto.randomUUID() },
      { ...codexTaskInput(reading.id, card.id), createdAt: "2026-06-22T03:14:15.926Z" },
      { ...codexTaskInput(reading.id, card.id), reviewedAt: "2026-06-22T03:14:15.926Z" },
      { ...codexTaskInput(reading.id, card.id), sourceReading: reading.relativePath },
      { ...codexTaskInput(reading.id, card.id), relatedCard: card.relativePath },
      { ...codexTaskInput(reading.id, card.id), requestedActions: ["client action"] },
      { ...codexTaskInput(reading.id, card.id), learningGuardrail: "client guardrail" },
      { ...codexTaskInput(reading.id, card.id), relativePath: `${CODEX_DIRECTORY}/evil.md` },
      { ...codexTaskInput(reading.id, card.id), absolutePath: join(vaultPathRoot, CODEX_DIRECTORY, "evil.md") },
      { ...codexTaskInput(reading.id, card.id), filename: "evil.md" },
      { ...codexTaskInput(reading.id, card.id), revisionLog: [] },
      { ...codexTaskInput(reading.id, card.id), provenance: { source: "client" } }
    ];

    for (const body of strictBodies) {
      const response = await request(app).post("/api/codex/tasks").send(body);

      expectApiError(response);
      expect(await filenames(vaultPathRoot, CODEX_DIRECTORY)).toEqual(before);
    }

    const unresolvedReading = await request(app)
      .post("/api/codex/tasks")
      .send(codexTaskInput(crypto.randomUUID(), card.id));
    const unresolvedCard = await request(app)
      .post("/api/codex/tasks")
      .send(codexTaskInput(reading.id, crypto.randomUUID()));

    expectApiError(unresolvedReading, "READING_NOT_FOUND");
    expectApiError(unresolvedCard, "CARD_NOT_FOUND");
    expect(await filenames(vaultPathRoot, CODEX_DIRECTORY)).toEqual(before);
  });
});
