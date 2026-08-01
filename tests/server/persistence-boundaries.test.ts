import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasErrorCode } from "../../server/lib/error-code";
import { activeLearningLibrary } from "../../server/persistence/library-context";
import { learningLibraryRelativePath } from "../../server/persistence/library-context";
import {
  extractMarkdownValueUnit,
  markdownFrontmatterValue,
  requireMarkdownValueUnit,
  serializeMarkdownValueUnit
} from "../../server/persistence/markdown-value";
import { createSaveReceipt } from "../../server/persistence/save-receipt";
import { initializeVault } from "../../server/services/vault-service";
import { createTempVaultContext } from "../temp-vault";

describe("focused persistence boundaries", () => {
  it("recognizes only declared string error codes", () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });

    expect(hasErrorCode(missing, "ENOENT")).toBe(true);
    expect(hasErrorCode(missing, "EEXIST", "EPERM")).toBe(false);
    expect(hasErrorCode({ code: "ENOENT" }, "ENOENT")).toBe(false);
  });

  it("serializes frontmatter and guarded Markdown value units canonically", () => {
    const value = "汉字\nmath $x$";

    expect(markdownFrontmatterValue(value)).toBe(JSON.stringify(value));
    expect(serializeMarkdownValueUnit("我的理解", value)).toBe(
      [
        "## 我的理解",
        `<!-- aleksi:value bytes=${Buffer.byteLength(value, "utf8")} -->`,
        value,
        "<!-- /aleksi:value -->"
      ].join("\n")
    );
  });

  it("round-trips Chinese, emoji, math, multiline, and empty Markdown values", () => {
    for (const value of [
      "汉字 😀 $x^2$\n第二行",
      "",
      "正文里出现 <!-- /aleksi:value --> 也不会截断"
    ]) {
      const serialized = serializeMarkdownValueUnit(value);
      expect(extractMarkdownValueUnit(serialized)).toMatchObject({
        byteLength: Buffer.byteLength(value, "utf8"),
        value
      });
      expect(requireMarkdownValueUnit(serialized).value).toBe(value);
    }
  });

  it("rejects malformed byte counts, truncation, and partial UTF-8", () => {
    expect(
      extractMarkdownValueUnit(
        "<!-- aleksi:value bytes=9007199254740993 -->\nx\n<!-- /aleksi:value -->"
      )
    ).toBeNull();
    expect(
      extractMarkdownValueUnit(
        "<!-- aleksi:value bytes=9 -->\n短\n<!-- /aleksi:value -->"
      )
    ).toBeNull();
    expect(
      extractMarkdownValueUnit(
        "<!-- aleksi:value bytes=2 -->\n汉\n<!-- /aleksi:value -->"
      )
    ).toBeNull();
    expect(() => requireMarkdownValueUnit("not a unit")).toThrow(
      "Markdown value unit is invalid"
    );
  });

  it("converts only inside-library absolute paths to normalized relative paths", () => {
    const root = resolve("C:/Learning Library");
    expect(
      learningLibraryRelativePath(
        root,
        resolve(root, "02-概念卡", "中文.md")
      )
    ).toBe("02-概念卡/中文.md");
    expect(() =>
      learningLibraryRelativePath(root, resolve(root, "..", "escape.md"))
    ).toThrow("outside the Vault root");
  });

  it("creates one shared save receipt shape", () => {
    const absolutePath = resolve("C:/Learning Library/02-概念卡/a.md");
    const modifiedAt = "2026-07-16T03:14:15.926Z";

    expect(
      createSaveReceipt("02-概念卡/a.md", absolutePath, modifiedAt)
    ).toEqual({ relativePath: "02-概念卡/a.md", absolutePath, modifiedAt });
  });

  it("resolves and validates the configured active learning library", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Learning Library");
    await initializeVault(vaultPath);

    await expect(activeLearningLibrary()).resolves.toBe(resolve(vaultPath));
  });
});
