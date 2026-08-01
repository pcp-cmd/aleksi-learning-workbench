export type DocumentProfileFixture = {
  name: string;
  description: string;
  source: string;
  searchMarker: string;
};

function repeatUntil(prefix: string, unit: string, targetBytes: number, suffix = ""): string {
  const parts = [prefix];
  let byteSize = Buffer.byteLength(prefix, "utf8");
  let ordinal = 0;
  while (byteSize < targetBytes) {
    const part = unit.replaceAll("{{n}}", String(++ordinal));
    parts.push(part);
    byteSize += Buffer.byteLength(part, "utf8");
  }
  parts.push(suffix);
  return parts.join("");
}

export function createDocumentProfileFixtures(): DocumentProfileFixture[] {
  const marker = "ALEKSI-PROFILE-FINAL-MARKER";
  return [
    {
      name: "short-note",
      description: "A short Markdown note",
      source: `# 短笔记\n\n普通段落、**粗体**、*斜体* 与 \`code\`。\n\n${marker}\n`,
      searchMarker: marker
    },
    {
      name: "medium-lecture",
      description: "A medium lecture note",
      source: repeatUntil("# 中型讲义\n\n", `## 小节 {{n}}\n\n${"定义、例子与证明思路。".repeat(24)}\n\n`, 256 * 1024, `\n${marker}\n`),
      searchMarker: marker
    },
    {
      name: "large-book",
      description: "A large book-like Markdown file",
      source: repeatUntil("# 大型教材\n\n", `## 第 {{n}} 章\n\n${"本章包含概念、例子、边界与练习。".repeat(180)}\n\n1. **承载对象：**集合与空间。\n\n`, 3 * 1024 * 1024, `\n${marker}\n`),
      searchMarker: marker
    },
    {
      name: "formula-heavy",
      description: "A document with many formulas",
      source: repeatUntil("# 公式密集材料\n\n", `## 公式组 {{n}}\n\n${"$$\n\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}\n$$\n\n".repeat(10)}`, 512 * 1024, `\n${marker}\n`),
      searchMarker: marker
    },
    {
      name: "code-heavy",
      description: "A document with many code blocks",
      source: repeatUntil("# 代码密集材料\n\n", `## 程序 {{n}}\n\n\`\`\`ts\n${"export const value = 42;\n".repeat(48)}\`\`\`\n\n`, 512 * 1024, `\n${marker}\n`),
      searchMarker: marker
    },
    {
      name: "table-heavy",
      description: "A document with many tables",
      source: repeatUntil("# 表格密集材料\n\n", `## 表格 {{n}}\n\n| 项目 | 值 |\n| --- | ---: |\n${"| A | {{n}} |\n| B | {{n}} |\n".repeat(8)}\n`, 128 * 1024, `\n${marker}\n`),
      searchMarker: marker
    },
    {
      name: "few-headings",
      description: "A large document with few headings",
      source: repeatUntil("# 少标题长文\n\n", `${"这是完整段落；它用于验证按段落边界回退分节，而不是固定字符切片。".repeat(42)} 编号 {{n}}。\n\n`, 2 * 1024 * 1024, `\n${marker}\n`),
      searchMarker: marker
    },
    {
      name: "partially-malformed",
      description: "Malformed front matter with readable Markdown content",
      source: repeatUntil("---\ninvalid: [unterminated\n---\n\n# 可读正文\n\n", `${"仍可读取的段落。".repeat(36)} 编号 {{n}}。\n\n`, 256 * 1024, `\n${marker}\n`),
      searchMarker: marker
    },
    {
      name: "oversized-block",
      description: "A document containing one extremely large structural block",
      source: `# 超大单块\n\n\`\`\`text\n${"x".repeat(1024 * 1024)}\n${marker}\n\`\`\`\n`,
      searchMarker: marker
    }
  ];
}
