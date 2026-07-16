import { z } from "zod";
import { describe, expect, it } from "vitest";
import { AppSettingsError } from "../../server/config/app-settings";
import { FilenameError } from "../../server/lib/filename";
import { VaultPathError } from "../../server/lib/path-safety";
import { CardServiceError } from "../../server/services/card-service";
import { mapHttpError } from "../../server/http/error-mapper";

describe("central HTTP error mapping", () => {
  it("maps validation failures to one stable request error", () => {
    const schema = z.object({ title: z.string().min(1) }).strict();
    const parsed = schema.safeParse({ title: "", extra: true });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected invalid request fixture");

    expect(mapHttpError(parsed.error)).toEqual({
      status: 400,
      body: {
        error: {
          code: "INVALID_REQUEST_BODY",
          message: parsed.error.issues.map((issue) => issue.message).join("; ")
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

  it("keeps the existing oversized-reading recovery message", () => {
    const error = Object.assign(new Error("request entity too large"), {
      status: 413,
      type: "entity.too.large"
    });

    expect(mapHttpError(error)).toEqual({
      status: 413,
      body: {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "阅读材料太长，请缩短到 10MB 以内后再保存。"
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
