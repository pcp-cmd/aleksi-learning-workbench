import { describe, expect, it } from "vitest";
import {
  decodeReadingFile,
  isSupportedReadingFile,
  normalizeReadingImport,
  READING_IMPORT_WARNING_BYTES
} from "../../src/features/reader/reading-import";

function fakeFile(name: string, bytes: number[], size = bytes.length): File {
  const source = Uint8Array.from(bytes);
  return {
    name,
    size,
    slice: (start = 0, end = source.length) => ({
      arrayBuffer: async () => source.slice(start, end).buffer
    }) as Blob
  } as File;
}

describe("reading file import", () => {
  it("accepts Markdown and text extensions and decodes only a UTF-8 preview", async () => {
    expect(isSupportedReadingFile("note.md")).toBe(true);
    expect(isSupportedReadingFile("note.MARKDOWN")).toBe(true);
    expect(isSupportedReadingFile("note.txt")).toBe(true);
    expect(isSupportedReadingFile("note.pdf")).toBe(false);

    const bytes = Array.from(new TextEncoder().encode("# 积分\r\n\r\n正文"));
    await expect(decodeReadingFile(fakeFile("积分.md", bytes))).resolves.toMatchObject({
      preview: "# 积分\r\n\r\n正文",
      titleSuggestion: "积分",
      warning: null
    });
  });

  it("rejects invalid UTF-8 and warns without loading a large file body", async () => {
    await expect(decodeReadingFile(fakeFile("broken.txt", [0xc3, 0x28]))).rejects.toThrow(
      "不是有效的 UTF-8"
    );

    const result = await decodeReadingFile(
      fakeFile("large.txt", [0x6f, 0x6b], READING_IMPORT_WARNING_BYTES + 1)
    );
    expect(result.preview).toBe("ok");
    expect(result.warning).toContain("MB");
  });

  it("normalizes native desktop selections through the same import contract", () => {
    expect(
      normalizeReadingImport({
        preview: "\uFEFF# 中文标题\r\n\r\n正文",
        fileName: "中文材料.md",
        size: 32
      })
    ).toMatchObject({
      preview: "# 中文标题\r\n\r\n正文",
      fileName: "中文材料.md",
      titleSuggestion: "中文材料",
      warning: null
    });

    expect(() =>
      normalizeReadingImport({ preview: "bad\u0000text", fileName: "bad.txt", size: 8 })
    ).toThrow("空字符");
  });
});
