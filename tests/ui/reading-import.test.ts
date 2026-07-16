import { describe, expect, it } from "vitest";
import {
  decodeReadingFile,
  isSupportedReadingFile,
  normalizeReadingImport,
  READING_IMPORT_WARNING_BYTES
} from "../../src/features/reader/reading-import";

function fakeFile(name: string, bytes: number[], size = bytes.length): File {
  return {
    name,
    size,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer
  } as File;
}

describe("reading file import", () => {
  it("accepts Markdown and text extensions and decodes UTF-8 with LF normalization", async () => {
    expect(isSupportedReadingFile("note.md")).toBe(true);
    expect(isSupportedReadingFile("note.MARKDOWN")).toBe(true);
    expect(isSupportedReadingFile("note.txt")).toBe(true);
    expect(isSupportedReadingFile("note.pdf")).toBe(false);

    const bytes = Array.from(new TextEncoder().encode("# 积分\r\n\r\n正文"));
    await expect(decodeReadingFile(fakeFile("积分.md", bytes))).resolves.toMatchObject({
      body: "# 积分\n\n正文",
      titleSuggestion: "积分",
      warning: null
    });
  });

  it("rejects invalid UTF-8 and warns without truncating large text files", async () => {
    await expect(decodeReadingFile(fakeFile("broken.txt", [0xc3, 0x28]))).rejects.toThrow(
      "不是有效的 UTF-8"
    );

    const result = await decodeReadingFile(
      fakeFile("large.txt", [0x6f, 0x6b], READING_IMPORT_WARNING_BYTES + 1)
    );
    expect(result.body).toBe("ok");
    expect(result.warning).toContain("MB");
  });

  it("normalizes native desktop selections through the same import contract", () => {
    expect(
      normalizeReadingImport({
        body: "\uFEFF# 中文标题\r\n\r\n正文",
        fileName: "中文材料.md",
        size: 32
      })
    ).toMatchObject({
      body: "# 中文标题\n\n正文",
      fileName: "中文材料.md",
      titleSuggestion: "中文材料",
      warning: null
    });

    expect(() =>
      normalizeReadingImport({ body: "bad\u0000text", fileName: "bad.txt", size: 8 })
    ).toThrow("空字符");
  });
});
