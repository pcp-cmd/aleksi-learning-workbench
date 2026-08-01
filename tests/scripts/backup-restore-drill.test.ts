import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { createTempVaultContext } from "../temp-vault";

type TestApp = ReturnType<typeof createApp>;

type LearningFixture = Readonly<{
  readingId: string;
  cardId: string;
  attemptId: string;
}>;

async function createChineseReading(
  app: TestApp,
  title: string
): Promise<{ id: string }> {
  const response = await request(app).post("/api/readings").send({
    title,
    concept: "恢复演练",
    body: "这是一段由自动化测试生成的中文阅读材料，用来验证本地数据可以完整恢复。",
    source: "manual-paste"
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { id: response.body.reading.id as string };
}

async function createConceptCard(
  app: TestApp,
  sourceReadingId: string,
  title: string
): Promise<{ id: string }> {
  const response = await request(app).post("/api/cards").send({
    type: "concept",
    title,
    concept: "恢复演练",
    relatedConcepts: ["本地备份", "逐文件校验"],
    sourceReadingId,
    excerpt: "本地数据可以完整恢复。",
    understanding: "恢复必须先验证全部文件，再切换当前学习库。",
    blockType: "transfer",
    nextAction: "完成一次闭卷恢复流程复述。",
    formalExplanation: "备份由文件路径、大小与 SHA-256 共同验证。",
    myUnderstanding: "目标位置保持独立，验证失败不会替换当前学习库。",
    commonMisunderstanding: "只看目录存在就认为备份可恢复。",
    usageContext: "本地学习库迁移或设备恢复时。"
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { id: response.body.card.id as string };
}

async function completeReview(
  app: TestApp,
  cardId: string
): Promise<{ attemptId: string }> {
  const attempt = await request(app)
    .post(`/api/review/${cardId}/attempt`)
    .send({
      idempotencyKey: randomUUID(),
      answer: "先验证备份，再恢复到新位置，最后切换学习库。",
      declaredDontKnow: false,
      confidenceBeforeReveal: 3,
      durationMs: 12_000,
      assistanceLevel: "none"
    });
  expect(attempt.status, JSON.stringify(attempt.body)).toBe(201);

  const result = await request(app)
    .post(`/api/review/${cardId}/result`)
    .send({
      attemptId: attempt.body.attemptId,
      feedback: "known",
      blockType: null,
      selfCorrection: "",
      diagnosisDraft: null
    });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { attemptId: attempt.body.attemptId as string };
}

async function createLearningFixture(
  app: TestApp,
  label: string
): Promise<LearningFixture> {
  const reading = await createChineseReading(app, `${label}中文阅读`);
  const card = await createConceptCard(app, reading.id, `${label}恢复概念卡`);
  vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1_000));
  const review = await completeReview(app, card.id);
  return {
    readingId: reading.id,
    cardId: card.id,
    attemptId: review.attemptId
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("backup restore automated drill", () => {
  it("emits a machine-readable pass report for backup, restore, relaunch, reading, card, and review", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    const context = await createTempVaultContext();
    const sourcePath = context.path("source-vault");
    const destinationPath = context.path("restored-vault");
    const sourceApp = createApp();

    const initialized = await request(sourceApp)
      .post("/api/vault/initialize")
      .send({ path: sourcePath });
    expect(initialized.status, JSON.stringify(initialized.body)).toBe(200);

    const sourceFixture = await createLearningFixture(sourceApp, "备份前");
    const backup = await request(sourceApp)
      .post("/api/vault/backup")
      .send({ confirmed: true });
    expect(backup.status, JSON.stringify(backup.body)).toBe(200);

    const restore = await request(sourceApp)
      .post("/api/vault/backups/restore")
      .send({
        backupPath: backup.body.backupPath,
        destinationPath,
        confirmed: true
      });
    expect(restore.status, JSON.stringify(restore.body)).toBe(200);
    expect(restore.body.status.path).toBe(destinationPath);

    const relaunchedApp = createApp();
    const launchStatus = await request(relaunchedApp).get("/api/vault/status");
    expect(launchStatus.status, JSON.stringify(launchStatus.body)).toBe(200);
    expect(launchStatus.body.status.path).toBe(destinationPath);

    const restoredReading = await request(relaunchedApp).get(
      `/api/readings/${sourceFixture.readingId}`
    );
    const restoredCard = await request(relaunchedApp).get(
      `/api/cards/${sourceFixture.cardId}`
    );
    expect(restoredReading.status, JSON.stringify(restoredReading.body)).toBe(200);
    expect(restoredReading.body.reading.rawMarkdown).toContain("中文阅读材料");
    expect(restoredCard.status, JSON.stringify(restoredCard.body)).toBe(200);
    expect(restoredCard.body.card.title).toContain("恢复概念卡");
    expect(restoredCard.body.card.lastAppliedReviewId).toBe(
      sourceFixture.attemptId
    );

    const postLaunchFixture = await createLearningFixture(relaunchedApp, "恢复后");
    const report = {
      schemaVersion: 1,
      drill: "backup-restore-launch-learning-loop",
      result: "pass",
      generatedAt: new Date().toISOString(),
      sourceFixture: {
        readingRecovered: restoredReading.status === 200,
        cardRecovered: restoredCard.status === 200,
        reviewRecovered:
          restoredCard.body.card.lastAppliedReviewId === sourceFixture.attemptId
      },
      postLaunchFixture: {
        readingCreated: postLaunchFixture.readingId.length > 0,
        cardCreated: postLaunchFixture.cardId.length > 0,
        reviewCommitted: postLaunchFixture.attemptId.length > 0
      },
      restore: {
        selectedDestination: launchStatus.body.status.path === destinationPath,
        verifiedFileCount: restore.body.restored.fileCount as number,
        verifiedBytes: restore.body.restored.totalBytes as number
      }
    } as const;

    const serialized = JSON.stringify(report);
    expect(JSON.parse(serialized)).toMatchObject({
      schemaVersion: 1,
      result: "pass",
      sourceFixture: {
        readingRecovered: true,
        cardRecovered: true,
        reviewRecovered: true
      },
      postLaunchFixture: {
        readingCreated: true,
        cardCreated: true,
        reviewCommitted: true
      },
      restore: {
        selectedDestination: true
      }
    });
    console.info(`ALEKSI_BACKUP_RESTORE_DRILL_REPORT ${serialized}`);
  }, 30_000);
});
