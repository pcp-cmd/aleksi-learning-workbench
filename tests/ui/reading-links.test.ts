import { describe, expect, it } from "vitest";
import {
  normalizeReadingRelativePath,
  resolveReadingLinkPath
} from "../../src/features/reader/reading-links";

describe("Reader Markdown links", () => {
  const source = "01-阅读材料/01-主线课程/F00/01-lesson.md";

  it("resolves sibling and next-unit Markdown links from the current reading", () => {
    expect(resolveReadingLinkPath(source, "03-lab.md")).toBe(
      "01-阅读材料/01-主线课程/F00/03-lab.md"
    );
    expect(resolveReadingLinkPath(source, "../F01/01-lesson.md")).toBe(
      "01-阅读材料/01-主线课程/F01/01-lesson.md"
    );
  });

  it("preserves vault-relative identity while ignoring query and fragment suffixes", () => {
    expect(resolveReadingLinkPath(source, "./05-reference.md#边界")).toBe(
      "01-阅读材料/01-主线课程/F00/05-reference.md"
    );
    expect(resolveReadingLinkPath(source, "/01-阅读材料/00-开始/00-START-HERE.md?from=F00")).toBe(
      "01-阅读材料/00-开始/00-START-HERE.md"
    );
  });

  it("does not treat external, anchor-only, malformed, or escaping links as library documents", () => {
    expect(resolveReadingLinkPath(source, "https://example.com/guide.md")).toBeNull();
    expect(resolveReadingLinkPath(source, "mailto:test@example.com")).toBeNull();
    expect(resolveReadingLinkPath(source, "#本节")).toBeNull();
    expect(resolveReadingLinkPath("01-阅读材料/a.md", "../../outside.md")).toBeNull();
    expect(resolveReadingLinkPath(source, "%E0%A4%A")).toBeNull();
  });

  it("normalizes Windows separators used by imported reading metadata", () => {
    expect(normalizeReadingRelativePath("01-阅读材料\\F00\\01-lesson.md")).toBe(
      "01-阅读材料/F00/01-lesson.md"
    );
  });
});
