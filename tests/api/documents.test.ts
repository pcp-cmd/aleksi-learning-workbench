import { appendFile, link, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { DOCUMENT_IMPORT_PART_BYTES } from "../../shared/document-limits";
import {
  DOCUMENT_IMPORT_DIRECTORY,
  DOCUMENT_INDEX_DIRECTORY,
  READING_DIRECTORY
} from "../../shared/vault-map";
import { createTempVaultContext } from "../temp-vault";

async function initializedApp() {
  const context = await createTempVaultContext();
  const vaultPath = context.path("Vault");
  const app = createApp();
  const initialized = await request(app)
    .post("/api/vault/initialize")
    .send({ path: vaultPath });
  expect(initialized.status).toBe(200);
  return { app, vaultPath };
}

function bookSource(): Buffer {
  const sections = Array.from({ length: 420 }, (_, index) => [
    `# 第 ${index + 1} 章`,
    "",
    `本章唯一检索标记 marker-${index + 1}。`,
    "",
    `1. **承载对象：**${"拓扑空间与连续映射。".repeat(250)}`,
    "",
    "```ts",
    `export const chapter = ${index + 1};`,
    "```",
    ""
  ].join("\n"));
  return Buffer.from(`${sections.join("\n")}\n[target]: https://example.com/reference\n`, "utf8");
}

describe("unified document API", () => {
  it("imports exact large bytes, indexes once, searches unloaded sections, and returns bounded chunks", async () => {
    const { app, vaultPath } = await initializedApp();
    const source = bookSource();
    expect(source.byteLength).toBeGreaterThan(1_900_000);
    const created = await request(app)
      .post("/api/document-imports")
      .send({
        fileName: "complete-book.md",
        expectedBytes: source.byteLength,
        title: "完整教材",
        concept: "高等数学"
      });
    expect(created.status).toBe(201);
    const sessionId = created.body.session.sessionId as string;

    for (let offset = 0; offset < source.byteLength; offset += DOCUMENT_IMPORT_PART_BYTES) {
      const part = source.subarray(
        offset,
        Math.min(source.byteLength, offset + DOCUMENT_IMPORT_PART_BYTES)
      );
      const uploaded = await request(app)
        .put(`/api/document-imports/${sessionId}/parts?offset=${offset}`)
        .set("Content-Type", "application/octet-stream")
        .send(part);
      expect(uploaded.status).toBe(200);
      expect(uploaded.body.session.receivedBytes).toBe(offset + part.byteLength);
    }

    const finalized = await request(app)
      .post(`/api/document-imports/${sessionId}/finalize`)
      .send({});
    expect(finalized.status).toBe(200);
    expect(finalized.body.session).toMatchObject({ status: "ready", stage: "ready" });
    const documentId = finalized.body.reading.documentId as string;
    const relativePath = finalized.body.reading.relativePath as string;
    const canonical = await readFile(join(vaultPath, ...relativePath.split("/")));
    expect(canonical.equals(source)).toBe(true);

    const descriptor = await request(app).get(`/api/documents/${documentId}`);
    expect(descriptor.status).toBe(200);
    expect(descriptor.body.document).toMatchObject({
      documentId,
      processingStatus: "ready",
      complexity: { mode: "large" }
    });
    expect(descriptor.body.document.outline).toHaveLength(420);
    expect(descriptor.body.document.chunks.length).toBeGreaterThan(100);
    expect(JSON.stringify(descriptor.body)).not.toContain("marker-420");

    const search = await request(app)
      .get(`/api/documents/${documentId}/search`)
      .query({ q: "marker-420" });
    expect(search.status).toBe(200);
    expect(search.body.results[0]).toMatchObject({ documentId });
    const chunkId = search.body.results[0].chunkId as string;
    const content = await request(app)
      .get(`/api/documents/${documentId}/chunks/${chunkId}/content`);
    expect(content.status).toBe(200);
    expect(content.text).toContain("marker-420");
    expect(content.text).toContain("[target]: https://example.com/reference");

    const context = await request(app)
      .post(`/api/documents/${documentId}/ai-context`)
      .send({
        activeChunkId: chunkId,
        query: "marker-420",
        mode: "question-answering",
        budgetTokens: 16_000
      });
    expect(context.status).toBe(200);
    expect(context.body.context.totalEstimatedTokens).toBeLessThanOrEqual(13_600);
    expect(context.body.context.chunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ chunkId })])
    );
    expect(new Set(context.body.context.chunks.map(
      (chunk: { chunkId: string }) => chunk.chunkId
    )).size).toBe(context.body.context.chunks.length);
    expect(context.body.context.chunks.every(
      (chunk: { content: string }) => !chunk.content.includes("[target]:")
    )).toBe(true);

    const summary = await request(app)
      .get(`/api/documents/${documentId}/summary-plan`)
      .query({ budgetTokens: 16_000 });
    expect(summary.status).toBe(200);
    const finalBatch = summary.body.plan.batches.at(-1);
    expect(finalBatch).toMatchObject({ level: "document" });
    expect(finalBatch.dependsOn.length).toBeGreaterThan(1);

    const visibleFiles = await readdir(join(vaultPath, READING_DIRECTORY));
    expect(visibleFiles).toHaveLength(1);
    const generated = await readdir(join(vaultPath, DOCUMENT_INDEX_DIRECTORY));
    expect(generated).toEqual([`${documentId}.json`]);

    const readings = await request(app).get("/api/readings");
    expect(readings.status).toBe(200);
    expect(readings.body.readings).toContainEqual(
      expect.objectContaining({ id: documentId, title: "完整教材" })
    );

    const indexPath = join(vaultPath, DOCUMENT_INDEX_DIRECTORY, `${documentId}.json`);
    const originalHash = descriptor.body.document.sourceHash as string;
    await rm(indexPath);
    const rebuilt = await request(app).get(`/api/documents/${documentId}`);
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.document.sourceHash).toBe(originalHash);

    const outdated = JSON.parse(await readFile(indexPath, "utf8")) as {
      schemaVersion: number;
      parserVersion: number;
    };
    await writeFile(indexPath, JSON.stringify({ ...outdated, schemaVersion: 0 }), "utf8");
    expect((await request(app).get(`/api/documents/${documentId}`)).status).toBe(200);
    const parserOutdated = JSON.parse(await readFile(indexPath, "utf8")) as {
      schemaVersion: number;
      parserVersion: number;
    };
    await writeFile(indexPath, JSON.stringify({ ...parserOutdated, parserVersion: 0 }), "utf8");
    expect((await request(app).get(`/api/documents/${documentId}`)).status).toBe(200);

    await appendFile(join(vaultPath, ...relativePath.split("/")), "\n# 附加章节\n\n增量失效验证。\n");
    const refreshed = await request(app).get(`/api/documents/${documentId}`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.document.sourceHash).not.toBe(originalHash);
    expect(refreshed.body.document.outline).toHaveLength(421);
  }, 30_000);

  it("replaces a canonical large source atomically while preserving its identity and rejects invalid staged text", async () => {
    const { app, vaultPath } = await initializedApp();
    const original = Buffer.from("# 同名材料\n\n旧正文。\n", "utf8");
    const created = await request(app).post("/api/document-imports").send({
      fileName: "same.md",
      expectedBytes: original.byteLength,
      title: "同名材料",
      concept: "替换"
    });
    const originalSession = created.body.session.sessionId as string;
    await request(app)
      .put(`/api/document-imports/${originalSession}/parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(original);
    const first = await request(app)
      .post(`/api/document-imports/${originalSession}/finalize`)
      .send({});
    expect(first.status).toBe(200);
    const documentId = first.body.reading.documentId as string;
    const relativePath = first.body.reading.relativePath as string;
    const opened = await request(app).get(`/api/documents/${documentId}`);
    const expectedVersion = {
      sha256: opened.body.document.sourceHash,
      size: opened.body.document.sourceVersion.byteSize,
      mtimeNs: opened.body.document.sourceVersion.modifiedNanoseconds,
      inode: opened.body.document.sourceVersion.inode
    };

    const replacement = Buffer.from("# 同名材料\n\n新正文，且保持原材料 ID。\n", "utf8");
    const replacementSession = await request(app).post("/api/document-imports").send({
      fileName: "same-new.md",
      expectedBytes: replacement.byteLength,
      title: "同名材料",
      concept: "替换",
      conflictMode: "replace",
      replaceReadingId: documentId,
      expectedVersion
    });
    expect(replacementSession.status).toBe(201);
    const replacementSessionId = replacementSession.body.session.sessionId as string;
    await request(app)
      .put(`/api/document-imports/${replacementSessionId}/parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(replacement);
    const replaced = await request(app)
      .post(`/api/document-imports/${replacementSessionId}/finalize`)
      .send({});
    expect(replaced.status).toBe(200);
    expect(replaced.body.reading).toMatchObject({ id: documentId, documentId, relativePath });
    expect((await readFile(join(vaultPath, ...relativePath.split("/")))).equals(replacement))
      .toBe(true);
    expect(await readdir(join(vaultPath, READING_DIRECTORY))).toHaveLength(1);

    const invalid = Buffer.from([0xff, 0xfe, 0x00]);
    const current = await request(app).get(`/api/documents/${documentId}`);
    const invalidSession = await request(app).post("/api/document-imports").send({
      fileName: "same-invalid.md",
      expectedBytes: invalid.byteLength,
      title: "同名材料",
      concept: "替换",
      conflictMode: "replace",
      replaceReadingId: documentId,
      expectedVersion: {
        sha256: current.body.document.sourceHash,
        size: current.body.document.sourceVersion.byteSize,
        mtimeNs: current.body.document.sourceVersion.modifiedNanoseconds,
        inode: current.body.document.sourceVersion.inode
      }
    });
    const invalidSessionId = invalidSession.body.session.sessionId as string;
    await request(app)
      .put(`/api/document-imports/${invalidSessionId}/parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(invalid);
    const rejected = await request(app)
      .post(`/api/document-imports/${invalidSessionId}/finalize`)
      .send({});
    expect(rejected.status).toBe(422);
    expect((await readFile(join(vaultPath, ...relativePath.split("/")))).equals(replacement))
      .toBe(true);
  });

  it("reports durable offsets so interrupted uploads can resume", async () => {
    const { app } = await initializedApp();
    const source = Buffer.from("# Resume\n\ncontent\n", "utf8");
    const created = await request(app).post("/api/document-imports").send({
      fileName: "resume.md",
      expectedBytes: source.byteLength,
      title: "恢复导入",
      concept: "恢复"
    });
    const sessionId = created.body.session.sessionId as string;
    const first = source.subarray(0, 8);
    await request(app)
      .put(`/api/document-imports/${sessionId}/parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(first);
    const verified = await request(app)
      .put(`/api/document-imports/${sessionId}/verify-parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(first);
    expect(verified.status).toBe(200);
    const altered = Buffer.from(first);
    altered[0] = altered[0] === 0x23 ? 0x21 : 0x23;
    const mismatch = await request(app)
      .put(`/api/document-imports/${sessionId}/verify-parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(altered);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("IMPORT_SOURCE_MISMATCH");
    const conflict = await request(app)
      .put(`/api/document-imports/${sessionId}/parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(first);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IMPORT_OFFSET_CONFLICT");
    const status = await request(app).get(`/api/document-imports/${sessionId}`);
    expect(status.body.session.receivedBytes).toBe(first.byteLength);
  });

  it("reuses a durably reserved canonical path after a finalize crash", async () => {
    const { app, vaultPath } = await initializedApp();
    const source = Buffer.from("# Crash recovery\n\nCanonical content\n", "utf8");
    const created = await request(app).post("/api/document-imports").send({
      fileName: "crash-recovery.md",
      expectedBytes: source.byteLength,
      title: "Crash recovery",
      concept: "Recovery"
    });
    const sessionId = created.body.session.sessionId as string;
    await request(app)
      .put(`/api/document-imports/${sessionId}/parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(source);

    const relativePath = `${READING_DIRECTORY}/Crash recovery.md`;
    const sessionPath = join(vaultPath, DOCUMENT_IMPORT_DIRECTORY, `${sessionId}.json`);
    const session = JSON.parse(await readFile(sessionPath, "utf8")) as Record<string, unknown>;
    await writeFile(sessionPath, JSON.stringify({
      ...session,
      documentId: "77777777-7777-4777-8777-777777777777",
      relativePath,
      status: "processing",
      stage: "analyzing-structure"
    }), "utf8");
    await link(
      join(vaultPath, DOCUMENT_IMPORT_DIRECTORY, `${sessionId}.part`),
      join(vaultPath, ...relativePath.split("/"))
    );

    const finalized = await request(app)
      .post(`/api/document-imports/${sessionId}/finalize`)
      .send({});
    expect(finalized.status).toBe(200);
    expect(finalized.body.reading.relativePath).toBe(relativePath);
    expect(await readdir(join(vaultPath, READING_DIRECTORY))).toEqual(["Crash recovery.md"]);
  });

  it("preserves missing-source metadata and relinks to a recovered canonical file", async () => {
    const { app, vaultPath } = await initializedApp();
    const source = Buffer.from("# 可恢复材料\n\n原文仍然完整。\n", "utf8");
    const created = await request(app).post("/api/document-imports").send({
      fileName: "recover.md",
      expectedBytes: source.byteLength,
      title: "可恢复材料",
      concept: "恢复"
    });
    const sessionId = created.body.session.sessionId as string;
    await request(app)
      .put(`/api/document-imports/${sessionId}/parts?offset=0`)
      .set("Content-Type", "application/octet-stream")
      .send(source);
    const finalized = await request(app)
      .post(`/api/document-imports/${sessionId}/finalize`)
      .send({});
    const documentId = finalized.body.reading.documentId as string;
    const originalRelativePath = finalized.body.reading.relativePath as string;
    const recoveredRelativePath = `${READING_DIRECTORY}/恢复后的原文件.md`;
    await rename(
      join(vaultPath, ...originalRelativePath.split("/")),
      join(vaultPath, ...recoveredRelativePath.split("/"))
    );

    const missing = await request(app).get(`/api/documents/${documentId}`);
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe("DOCUMENT_SOURCE_UNAVAILABLE");
    const readings = await request(app).get("/api/readings");
    expect(readings.body.readings).toContainEqual(
      expect.objectContaining({ id: documentId, title: "可恢复材料" })
    );

    const relinked = await request(app)
      .post(`/api/documents/${documentId}/relink`)
      .send({ relativePath: recoveredRelativePath });
    expect(relinked.status).toBe(200);
    expect(relinked.body.document).toMatchObject({
      documentId,
      sourcePath: recoveredRelativePath,
      processingStatus: "ready"
    });
    expect((await readFile(join(vaultPath, ...recoveredRelativePath.split("/")))).equals(source))
      .toBe(true);
  });
});
