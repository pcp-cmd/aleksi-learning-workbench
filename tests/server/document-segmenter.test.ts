import { describe, expect, it } from "vitest";
import { parseMarkdownDocument } from "../../server/documents/markdown-document-parser";
import { segmentMarkdownDocument } from "../../server/documents/document-segmenter";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

describe("structural Markdown document segmentation", () => {
  it("preserves source mappings and indivisible Markdown blocks", () => {
    const source = [
      "---",
      "topic: calculus",
      "---",
      "",
      "# 重复标题",
      "",
      "1. **承载对象：**元素生活在哪个集合？",
      "   - 嵌套项",
      "",
      "> 完整引用",
      "> 第二行",
      "",
      "```ts",
      "const marker = 'CODE_END';",
      "```",
      "",
      "$$",
      "x^2 + y^2 = z^2",
      "$$",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "<aside data-kind=\"note\">完整 HTML 块</aside>",
      "",
      "# 重复标题",
      "",
      "[引用链接][target]",
      "",
      "[target]: https://example.com",
      ""
    ].join("\n");
    const segmented = segmentMarkdownDocument(
      DOCUMENT_ID,
      parseMarkdownDocument(source)
    );

    expect(segmented.chunks).toHaveLength(2);
    expect(segmented.outline).toHaveLength(2);
    expect(segmented.outline[0]?.nodeId).not.toBe(segmented.outline[1]?.nodeId);
    expect(segmented.definitionMarkdown).toContain("[target]: https://example.com");
    const first = segmented.chunks[0]!;
    const firstBytes = Buffer.from(source, "utf8").subarray(
      first.sourceStartOffset,
      first.sourceEndOffset
    ).toString("utf8");
    expect(firstBytes).toContain("```ts\nconst marker = 'CODE_END';\n```");
    expect(firstBytes).toContain("$$\nx^2 + y^2 = z^2\n$$");
    expect(firstBytes).toContain("| A | B |");
    expect(firstBytes).toContain('<aside data-kind="note">完整 HTML 块</aside>');
    expect(firstBytes).toContain("1. **承载对象：**元素生活在哪个集合？");
    expect(first.plainText).toContain("承载对象");
    expect(first.sourceStartLine).toBe(5);
    expect(parsedFrontMatter(source)).toBe("---\ntopic: calculus\n---\n");
  });

  it("falls back to paragraph boundaries when headings are sparse", () => {
    const paragraphs = Array.from(
      { length: 120 },
      (_, index) => `第 ${index + 1} 个段落：${"保持语义边界。".repeat(80)}`
    );
    const source = `# 少标题长文\n\n${paragraphs.join("\n\n")}\n`;
    const segmented = segmentMarkdownDocument(
      DOCUMENT_ID,
      parseMarkdownDocument(source)
    );
    expect(segmented.chunks.length).toBeGreaterThan(2);
    for (const chunk of segmented.chunks) {
      const bytes = Buffer.from(source, "utf8").subarray(
        chunk.sourceStartOffset,
        chunk.sourceEndOffset
      ).toString("utf8");
      const trimmed = bytes.trim();
      expect(trimmed.startsWith("#") || /^第\s*\d+\s*个段落：/u.test(trimmed))
        .toBe(true);
      expect(trimmed.endsWith("。")).toBe(true);
    }
  });

  it("keeps an oversized single structural block valid", () => {
    const hugeCode = `# Code\n\n\`\`\`text\n${"x".repeat(300_000)}\n\`\`\`\n`;
    const segmented = segmentMarkdownDocument(
      DOCUMENT_ID,
      parseMarkdownDocument(hugeCode)
    );
    const oversized = segmented.chunks.find((chunk) => chunk.oversized);
    expect(oversized).toBeDefined();
    expect(oversized?.plainText).toContain("x".repeat(100));
  });

  it("keeps stable chunk IDs when unrelated earlier sections are inserted", () => {
    const original = "# A\n\nalpha\n\n# B\n\nbeta\n";
    const inserted = "# New\n\nnew\n\n# A\n\nalpha\n\n# B\n\nbeta\n";
    const before = segmentMarkdownDocument(DOCUMENT_ID, parseMarkdownDocument(original));
    const after = segmentMarkdownDocument(DOCUMENT_ID, parseMarkdownDocument(inserted));
    expect(after.chunks.find((chunk) => chunk.title === "A")?.chunkId)
      .toBe(before.chunks.find((chunk) => chunk.title === "A")?.chunkId);
    expect(after.chunks.find((chunk) => chunk.title === "B")?.chunkId)
      .toBe(before.chunks.find((chunk) => chunk.title === "B")?.chunkId);
  });
});

function parsedFrontMatter(source: string): string {
  const parsed = parseMarkdownDocument(source);
  const range = parsed.frontmatterCharacterRange;
  return range === null ? "" : source.slice(range.start, range.end);
}
