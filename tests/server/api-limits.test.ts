import { writeFile } from "node:fs/promises";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import {
  READING_BODY_JSON_LIMIT_BYTES,
  READING_DETAIL_JSON_LIMIT_BYTES,
  READING_JSON_BODY_LIMIT_BYTES
} from "../../server/http/error-mapper";
import { READING_DIRECTORY } from "../../shared/vault-map";
import { createTempVaultContext } from "../temp-vault";

const STANDARD_JSON_LIMIT_BYTES = 256 * 1024;

describe("API JSON request limits", () => {
  it("rejects ordinary API payloads above 256 KiB with bounded recovery metadata", async () => {
    const response = await request(createApp())
      .post("/api/cards")
      .send({ padding: "x".repeat(STANDARD_JSON_LIMIT_BYTES + 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "请求内容过大，请缩短到 256 KiB 以内后重试。",
        recovery: {
          action: "reduce_payload",
          target: "request_body",
          maxBytes: STANDARD_JSON_LIMIT_BYTES
        }
      }
    });
  });

  it("keeps a bounded reading allowance exclusive to reading material", async () => {
    const acceptedByReadingParser = await request(createApp())
      .post("/api/readings")
      .send({ padding: "x".repeat(STANDARD_JSON_LIMIT_BYTES + 1024) });
    const rejectedAboveReadingLimit = await request(createApp())
      .post("/api/readings")
      .send({
        title: "Oversized reading",
        concept: "limits",
        source: "manual-paste",
        body: "x".repeat(READING_JSON_BODY_LIMIT_BYTES + 1024)
      });

    expect(acceptedByReadingParser.status).toBe(422);
    expect(acceptedByReadingParser.body.error).toMatchObject({
      code: "INVALID_REQUEST_BODY",
      recovery: {
        action: "correct_fields"
      }
    });
    expect(rejectedAboveReadingLimit.status).toBe(413);
    expect(rejectedAboveReadingLimit.body.error.recovery).toEqual({
      action: "reduce_payload",
      target: "reading_material",
      maxBytes: READING_JSON_BODY_LIMIT_BYTES
    });
  });

  it("rejects a reading body whose JSON representation would exhaust response headroom", async () => {
    const response = await request(createApp())
      .post("/api/readings")
      .send({
        title: "Oversized body",
        concept: "limits",
        source: "manual-paste",
        body: "x".repeat(READING_BODY_JSON_LIMIT_BYTES)
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: "INVALID_REQUEST_BODY",
      recovery: {
        action: "correct_fields",
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "body" })
        ])
      }
    });
  });

  it("can reopen a near-limit imported reading without crossing the 2 MiB client boundary", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const app = createApp();
    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);

    const body = "x".repeat(READING_BODY_JSON_LIMIT_BYTES - 2);
    const created = await request(app).post("/api/readings").send({
      title: "Near-limit reading",
      concept: "limits",
      source: "file-import",
      sourceFileName: "near-limit.md",
      body
    });
    expect(created.status).toBe(200);

    const reopened = await request(app).get(
      `/api/readings/${created.body.reading.id as string}`
    );
    expect(reopened.status).toBe(200);
    expect(reopened.body.reading.rawMarkdown).toContain(body);
    expect(Buffer.byteLength(reopened.text, "utf8")).toBeLessThanOrEqual(
      READING_DETAIL_JSON_LIMIT_BYTES
    );

    const targetPath = context.path(
      "Vault",
      READING_DIRECTORY,
      String(created.body.reading.relativePath).split("/").at(-1) ?? ""
    );
    expect(targetPath).toContain(READING_DIRECTORY);
  });

  it("rejects a legacy reading file above the response budget with recovery guidance", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const app = createApp();
    await request(app).post("/api/vault/initialize").send({ path: vaultPath });
    const created = await request(app).post("/api/readings").send({
      title: "Legacy oversized reading",
      concept: "limits",
      source: "manual-paste",
      body: "small"
    });
    expect(created.status).toBe(200);
    const relativePath = String(created.body.reading.relativePath);
    await writeFile(
      context.path("Vault", ...relativePath.split("/")),
      "x".repeat(READING_DETAIL_JSON_LIMIT_BYTES + 1),
      "utf8"
    );

    const reopened = await request(app).get(
      `/api/readings/${created.body.reading.id as string}`
    );
    expect(reopened.status).toBe(413);
    expect(reopened.body.error).toEqual({
      code: "READING_TOO_LARGE",
      message: "Reading Markdown is too large to reopen safely",
      recovery: {
        action: "reduce_payload",
        target: "reading_material",
        maxBytes: READING_BODY_JSON_LIMIT_BYTES
      }
    });
  });

  it("maps Zod input failures to 422 with field-level recovery guidance", async () => {
    const response = await request(createApp())
      .post("/api/cards")
      .send({});

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: "INVALID_REQUEST_BODY",
      message: expect.any(String),
      recovery: {
        action: "correct_fields",
        fields: expect.arrayContaining([
          {
            path: expect.any(String),
            message: expect.any(String)
          }
        ])
      }
    });
    expect(response.body.error.recovery.fields).not.toContainEqual(
      expect.objectContaining({ received: expect.anything() })
    );
  });
});
