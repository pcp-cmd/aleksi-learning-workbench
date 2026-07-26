import { z } from "zod";
import { describe, expect, it } from "vitest";
import { AppSettingsError } from "../../server/config/app-settings";
import { FilenameError } from "../../server/lib/filename";
import { VaultPathError } from "../../server/lib/path-safety";
import { CardServiceError } from "../../server/services/card-service";
import { ReadingServiceError } from "../../server/services/reading-service";
import { mapHttpError } from "../../server/http/error-mapper";
import { READING_JSON_BODY_LIMIT_BYTES } from "../../shared/api-limits";

describe("central HTTP error mapping", () => {
  it("maps validation failures to one stable request error", () => {
    const schema = z.object({ title: z.string().min(1) }).strict();
    const parsed = schema.safeParse({ title: "", extra: true });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected invalid request fixture");

    expect(mapHttpError(parsed.error)).toEqual({
      status: 422,
      body: {
        error: {
          code: "INVALID_REQUEST_BODY",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
          recovery: {
            action: "correct_fields",
            fields: parsed.error.issues.map((issue) => ({
              path: issue.path.length === 0 ? "$" : issue.path.join("."),
              message: issue.message
            }))
          }
        }
      }
    });
  });

  it("preserves service status, code, and user-visible meaning", () => {
    expect(
      mapHttpError(new CardServiceError("CARD_NOT_FOUND", "Card not found", 404))
    ).toEqual({
      status: 404,
      body: {
        error: {
          code: "CARD_NOT_FOUND",
          message: "Card not found"
        }
      }
    });
  });

  it("does not misclassify a service-level 413 as a body-parser failure", () => {
    expect(
      mapHttpError(
        new ReadingServiceError(
          "READING_TOO_LARGE",
          "Reading Markdown is too large to reopen safely",
          413,
          {
            action: "reduce_payload",
            target: "reading_material",
            maxBytes: READING_JSON_BODY_LIMIT_BYTES
          }
        )
      )
    ).toEqual({
      status: 413,
      body: {
        error: {
          code: "READING_TOO_LARGE",
          message: "Reading Markdown is too large to reopen safely",
          recovery: {
            action: "reduce_payload",
            target: "reading_material",
            maxBytes: READING_JSON_BODY_LIMIT_BYTES
          }
        }
      }
    });
  });

  it.each([
    new FilenameError("INVALID_FILENAME", "Invalid file name"),
    new VaultPathError("PATH_OUTSIDE_VAULT", "Unsafe learning-library path")
  ])("maps path-boundary failures to 400", (error) => {
    expect(mapHttpError(error)).toEqual({
      status: 400,
      body: {
        error: {
          code: error.code,
          message: error.message
        }
      }
    });
  });

  it("maps invalid app settings without exposing a stack", () => {
    expect(mapHttpError(new AppSettingsError("Settings are invalid"))).toEqual({
      status: 500,
      body: {
        error: {
          code: "INVALID_APP_SETTINGS",
          message: "Settings are invalid"
        }
      }
    });
  });

  it("maps an unscoped oversized body to the ordinary request limit", () => {
    const error = Object.assign(new Error("request entity too large"), {
      status: 413,
      type: "entity.too.large"
    });

    expect(mapHttpError(error)).toEqual({
      status: 413,
      body: {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "请求内容过大，请缩短到 256 KiB 以内后重试。",
          recovery: {
            action: "reduce_payload",
            target: "request_body",
            maxBytes: 256 * 1024
          }
        }
      }
    });
  });

  it("keeps the larger recovery limit for reading material", () => {
    const error = Object.assign(new Error("request entity too large"), {
      payloadTarget: "reading_material",
      status: 413,
      type: "entity.too.large"
    });

    expect(mapHttpError(error)).toEqual({
      status: 413,
      body: {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "阅读材料太长，请缩短到 2 MiB 以内后再保存。",
          recovery: {
            action: "reduce_payload",
            target: "reading_material",
            maxBytes: READING_JSON_BODY_LIMIT_BYTES
          }
        }
      }
    });
  });

  it("uses one non-leaking response for unknown errors", () => {
    expect(mapHttpError(new Error("C:\\Users\\pcp\\secret.txt"))).toEqual({
      status: 500,
      body: {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Unexpected server error"
        }
      }
    });
  });
});
