import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import {
  blockTypeSchema,
  cardRecordSchema,
  cardTypeSchema,
  isWellFormedString,
  parseRevisionNoteMetadata
} from "../domain/schemas";
import type {
  BlockType,
  CardRecord,
  CardType,
  RevisionEntry
} from "../domain/types";
import {
  markdownFrontmatterValue,
  serializeMarkdownValueUnit
} from "../persistence/markdown-value";

const FRONTMATTER_KEYS = [
  "id",
  "type",
  "title",
  "concept",
  "relatedConcepts",
  "sourceReading",
  "blockType",
  "mastery",
  "createdAt",
  "nextReview",
  "lastAppliedReviewId",
  "lastAppliedReviewSequence",
  "reviewAppliedAt",
  "reviewOverrideAt",
  "pendingReviewId"
] as const;

const V2_RESTATEMENT_HEADING = "闭卷重述";
const V2_INTEGRATED_HEADING = "整合理解";
const RESERVED_FRONTMATTER_KEYS = new Set<string>([
  "schemaVersion",
  ...FRONTMATTER_KEYS
]);

const CARD_FORMATS: Record<
  CardType,
  {
    h1Label: string;
    fields: ReadonlyArray<{
      key: string;
      heading: string;
      v2Heading?: string;
    }>;
  }
> = {
  concept: {
    h1Label: "概念卡",
    fields: [
      { key: "formalExplanation", heading: "正式解释" },
      {
        key: "myUnderstanding",
        heading: "我的理解",
        v2Heading: V2_INTEGRATED_HEADING
      },
      { key: "commonMisunderstanding", heading: "常见误解" },
      { key: "usageContext", heading: "使用场景" }
    ]
  },
  definition: {
    h1Label: "定义卡",
    fields: [
      { key: "formalDefinition", heading: "正式定义" },
      { key: "plainExplanation", heading: "大白话解释" },
      { key: "quantifierStructure", heading: "量词结构" },
      { key: "commonMisunderstandings", heading: "常见误解" }
    ]
  },
  example: {
    h1Label: "例子卡",
    fields: [
      { key: "exampleContent", heading: "例子内容" },
      { key: "whyItFits", heading: "为什么它符合" },
      { key: "trainingPurpose", heading: "它训练我什么" }
    ]
  },
  boundary: {
    h1Label: "边界卡",
    fields: [
      { key: "confusingObjects", heading: "易混对象" },
      { key: "similarity", heading: "相似之处" },
      { key: "keyDifference", heading: "关键区别" },
      { key: "judgementRule", heading: "判断标准" }
    ]
  },
  counterexample: {
    h1Label: "反例卡",
    fields: [
      { key: "counterexampleContent", heading: "反例内容" },
      { key: "brokenCondition", heading: "它破坏了哪个条件" },
      { key: "whyItIsNot", heading: "为什么它不是" }
    ]
  },
  process: {
    h1Label: "流程卡",
    fields: [
      { key: "task", heading: "任务" },
      { key: "steps", heading: "步骤" },
      { key: "keyTurn", heading: "关键转折" },
      { key: "pitfall", heading: "易错点" },
      { key: "usageContext", heading: "使用场景" }
    ]
  },
  mistake: {
    h1Label: "错误卡",
    fields: [
      { key: "mistake", heading: "错误表现" },
      { key: "originalThinking", heading: "原来怎么想" },
      { key: "realCause", heading: "真正原因" },
      { key: "correctMethod", heading: "正确方法" },
      { key: "recognitionSignal", heading: "识别信号" }
    ]
  },
  proof: {
    h1Label: "证明卡",
    fields: [
      { key: "proposition", heading: "命题内容" },
      { key: "firstAttempt", heading: "我的第一次尝试" },
      { key: "keyMove", heading: "关键动作" },
      { key: "proofOutline", heading: "证明骨架" },
      { key: "failureReason", heading: "失败原因" }
    ]
  }
};

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  definition: "定义",
  example: "例子",
  counterexample: "反例",
  "proof-search": "证明搜索",
  technical: "技术",
  expression: "表达",
  transfer: "迁移",
  emotion: "情绪"
};

const LABEL_TO_BLOCK_TYPE = new Map(
  Object.entries(BLOCK_TYPE_LABELS).map(([key, label]) => [
    label,
    key as BlockType
  ])
);

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function fail(message: string): never {
  throw new Error(`Invalid canonical card Markdown: ${message}`);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalJsonValue(item)])
    );
  }
  return value;
}

function serializeFrontmatterValue(value: unknown): string {
  const serialized = markdownFrontmatterValue(canonicalJsonValue(value));
  if (typeof serialized === "string") {
    return serialized;
  }

  return fail("unsupported frontmatter value");
}

function headingForVersion(
  field: { heading: string; v2Heading?: string },
  schemaVersion: 1 | 2
): string {
  return schemaVersion === 2
    ? field.v2Heading ?? field.heading
    : field.heading;
}

function serializeRevisionEntry(entry: RevisionEntry): string {
  const reviewPrefix =
    entry.reviewId === null ? "" : `[review:${entry.reviewId}] `;
  return `- ${entry.at}：${reviewPrefix}${entry.note}`;
}

export function serializeCardMarkdown(card: CardRecord): string {
  const normalized = cardRecordSchema.parse(card) as CardRecord;
  const record = normalized as CardRecord & Record<string, unknown>;
  const format = CARD_FORMATS[normalized.type];
  const compatibleMetadata = Object.entries(normalized.compatibleMetadata)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (normalized.schemaVersion === 1 && compatibleMetadata.length > 0) {
    return fail("v1 cards cannot serialize compatible metadata");
  }
  const frontmatter = [
    "---",
    ...(normalized.schemaVersion === 2 ? ["schemaVersion: 2"] : []),
    ...FRONTMATTER_KEYS.map(
      (key) => `${key}: ${serializeFrontmatterValue(record[key])}`
    ),
    ...compatibleMetadata.map(
      ([key, value]) => `${key}: ${serializeFrontmatterValue(value)}`
    ),
    "---"
  ].join("\n");
  const metadata = [`所属概念：[[${normalized.concept}]]`];

  if (normalized.relatedConcepts.length > 0) {
    metadata.push(
      `相关概念：${normalized.relatedConcepts
        .map((concept) => `[[${concept}]]`)
        .join("、")}`
    );
  }

  const sections = [serializeMarkdownValueUnit("原文摘录", normalized.excerpt)];

  for (const field of format.fields) {
    sections.push(
      serializeMarkdownValueUnit(
        headingForVersion(field, normalized.schemaVersion),
        record[field.key] as string
      )
    );
  }

  if (normalized.understanding !== "") {
    sections.push(
      serializeMarkdownValueUnit(
        normalized.schemaVersion === 2
          ? V2_RESTATEMENT_HEADING
          : "我的理解",
        normalized.understanding
      )
    );
  }

  if (normalized.blockType !== null) {
    sections.push(
      serializeMarkdownValueUnit(
        "当前卡点",
        BLOCK_TYPE_LABELS[normalized.blockType]
      )
    );
  }

  if (normalized.nextAction !== "") {
    sections.push(
      serializeMarkdownValueUnit("下一步行动", normalized.nextAction)
    );
  }

  sections.push(
    [
      "## 修订记录",
      ...normalized.revisionLog.map(serializeRevisionEntry)
    ].join("\n")
  );

  return (
    `${frontmatter}\n\n` +
    `# ${format.h1Label}：${normalized.title}\n\n` +
    `${metadata.join("\n")}\n\n` +
    `${sections.join("\n\n")}\n`
  );
}

class ByteCursor {
  private readonly bytes: Buffer;
  private offset = 0;

  constructor(markdown: string) {
    this.bytes = Buffer.from(markdown, "utf8");
  }

  startsWith(value: string): boolean {
    const expected = Buffer.from(value, "utf8");
    return this.bytes.subarray(
      this.offset,
      this.offset + expected.length
    ).equals(expected);
  }

  expect(value: string): void {
    if (!this.startsWith(value)) {
      fail(`expected ${JSON.stringify(value)} at byte ${this.offset}`);
    }
    this.offset += Buffer.byteLength(value, "utf8");
  }

  readLine(): string {
    const newline = this.bytes.indexOf(0x0a, this.offset);
    if (newline === -1) {
      return fail(`unterminated line at byte ${this.offset}`);
    }

    const value = UTF8_DECODER.decode(
      this.bytes.subarray(this.offset, newline)
    );
    this.offset = newline + 1;
    return value;
  }

  readValueUnit(heading: string): string {
    this.expect(`## ${heading}\n`);
    const marker = this.readLine();
    const match =
      /^<!-- aleksi:value bytes=(0|[1-9]\d*) -->$/.exec(marker);

    if (!match) {
      return fail(`invalid value marker for ${heading}`);
    }

    const byteCount = Number(match[1]);
    if (!Number.isSafeInteger(byteCount)) {
      return fail(`unsafe byte count for ${heading}`);
    }

    const end = this.offset + byteCount;
    if (end > this.bytes.length) {
      return fail(`value for ${heading} exceeds the file`);
    }

    let value: string;
    try {
      value = UTF8_DECODER.decode(this.bytes.subarray(this.offset, end));
    } catch {
      return fail(`value for ${heading} splits invalid UTF-8`);
    }

    this.offset = end;
    this.expect("\n<!-- /aleksi:value -->\n");
    return value;
  }

  isAtEnd(): boolean {
    return this.offset === this.bytes.length;
  }
}

function parseCanonicalJson(value: string, key: string): unknown {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return fail(`frontmatter ${key} is not JSON`);
  }

  if (serializeFrontmatterValue(parsed) !== value) {
    return fail(`frontmatter ${key} is not canonical JSON`);
  }

  return parsed;
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    return fail(`frontmatter ${key} must be a string`);
  }
  return value;
}

function requireStringArray(value: unknown, key: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return fail(`frontmatter ${key} must be a string array`);
  }
  return value;
}

function parseRevisionEntry(line: string): RevisionEntry {
  const match = /^- (\d{4}-\d{2}-\d{2})：(.+)$/.exec(line);

  if (!match) {
    return fail("invalid revision entry");
  }

  const metadata = parseRevisionNoteMetadata(match[2]);

  return {
    at: match[1],
    note: metadata?.note ?? match[2],
    reviewId: metadata?.reviewId ?? null
  };
}

export function parseCardMarkdown(markdown: string): CardRecord {
  if (!isWellFormedString(markdown)) {
    return fail("input string must be well-formed UTF-16");
  }
  if (markdown.startsWith("\uFEFF")) {
    return fail("BOM is forbidden");
  }
  if (markdown.includes("\r")) {
    return fail("CR is forbidden");
  }
  if (!markdown.endsWith("\n") || markdown.endsWith("\n\n")) {
    return fail("file must end with exactly one LF");
  }

  const cursor = new ByteCursor(markdown);
  cursor.expect("---\n");

  const frontmatter: Record<string, unknown> = {};
  let schemaVersion: 1 | 2 = 1;
  if (cursor.startsWith("schemaVersion: ")) {
    const line = cursor.readLine();
    const value = parseCanonicalJson(
      line.slice("schemaVersion: ".length),
      "schemaVersion"
    );
    if (value !== 2) {
      return fail("explicit schemaVersion must be 2");
    }
    schemaVersion = 2;
  }
  frontmatter.schemaVersion = schemaVersion;

  for (const key of FRONTMATTER_KEYS) {
    const line = cursor.readLine();
    const prefix = `${key}: `;

    if (!line.startsWith(prefix)) {
      return fail(`expected frontmatter key ${key}`);
    }

    frontmatter[key] = parseCanonicalJson(line.slice(prefix.length), key);
  }

  const compatibleMetadata: Record<string, unknown> = {};
  let previousMetadataKey: string | null = null;
  if (schemaVersion === 2) {
    while (!cursor.startsWith("---\n")) {
      const line = cursor.readLine();
      const separator = line.indexOf(": ");
      if (separator <= 0) {
        return fail("compatible frontmatter entry is malformed");
      }
      const key = line.slice(0, separator);
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key)) {
        return fail("compatible frontmatter key is invalid");
      }
      if (
        RESERVED_FRONTMATTER_KEYS.has(key) ||
        Object.prototype.hasOwnProperty.call(compatibleMetadata, key)
      ) {
        return fail(`compatible frontmatter key ${key} is reserved or repeated`);
      }
      if (previousMetadataKey !== null && previousMetadataKey >= key) {
        return fail("compatible frontmatter keys are not in stable order");
      }
      compatibleMetadata[key] = parseCanonicalJson(
        line.slice(separator + 2),
        key
      );
      previousMetadataKey = key;
    }
  }
  frontmatter.compatibleMetadata = compatibleMetadata;

  if (cursor.readLine() !== "---") {
    return fail("frontmatter must close after the fixed card keys");
  }
  cursor.expect("\n");

  const type = cardTypeSchema.parse(frontmatter.type);
  const format = CARD_FORMATS[type];
  const title = requireString(frontmatter.title, "title");
  const concept = requireString(frontmatter.concept, "concept");
  const relatedConcepts = requireStringArray(
    frontmatter.relatedConcepts,
    "relatedConcepts"
  );

  if (cursor.readLine() !== `# ${format.h1Label}：${title}`) {
    return fail("H1 does not match frontmatter");
  }
  cursor.expect("\n");

  if (cursor.readLine() !== `所属概念：[[${concept}]]`) {
    return fail("concept link does not match frontmatter");
  }

  if (relatedConcepts.length > 0) {
    const expectedRelated = `相关概念：${relatedConcepts
      .map((item) => `[[${item}]]`)
      .join("、")}`;
    if (cursor.readLine() !== expectedRelated) {
      return fail("related concept links do not match frontmatter");
    }
  }
  cursor.expect("\n");

  const body: Record<string, unknown> = {
    excerpt: cursor.readValueUnit("原文摘录"),
    understanding: "",
    nextAction: ""
  };

  for (const field of format.fields) {
    cursor.expect("\n");
    body[field.key] = cursor.readValueUnit(
      headingForVersion(field, schemaVersion)
    );
  }

  const understandingHeading =
    schemaVersion === 2 ? V2_RESTATEMENT_HEADING : "我的理解";
  if (cursor.startsWith(`\n## ${understandingHeading}\n`)) {
    cursor.expect("\n");
    body.understanding = cursor.readValueUnit(understandingHeading);
  }

  let bodyBlockType: BlockType | null = null;
  if (cursor.startsWith("\n## 当前卡点\n")) {
    cursor.expect("\n");
    const label = cursor.readValueUnit("当前卡点");
    bodyBlockType = LABEL_TO_BLOCK_TYPE.get(label) ?? null;
    if (bodyBlockType === null) {
      return fail("unknown current-block label");
    }
  }

  if (cursor.startsWith("\n## 下一步行动\n")) {
    cursor.expect("\n");
    body.nextAction = cursor.readValueUnit("下一步行动");
  }

  const frontmatterBlockType = blockTypeSchema
    .nullable()
    .parse(frontmatter.blockType);
  if (bodyBlockType !== frontmatterBlockType) {
    return fail("current-block body does not match frontmatter");
  }

  cursor.expect("\n## 修订记录\n");
  const revisionLog: RevisionEntry[] = [];
  while (!cursor.isAtEnd()) {
    revisionLog.push(parseRevisionEntry(cursor.readLine()));
  }

  if (revisionLog.length === 0) {
    return fail("revision log must be nonempty");
  }

  const payload: Record<string, unknown> = {};
  for (const field of format.fields) {
    payload[field.key] = body[field.key];
  }

  const card = cardRecordSchema.parse({
    ...frontmatter,
    ...body,
    ...payload,
    revisionLog
  }) as CardRecord;

  if (serializeCardMarkdown(card) !== markdown) {
    return fail("file is not in canonical form");
  }

  return card;
}

export function parseCardMarkdownBytes(input: Uint8Array): CardRecord {
  if (
    input.length >= 3 &&
    input[0] === 0xef &&
    input[1] === 0xbb &&
    input[2] === 0xbf
  ) {
    return fail("UTF-8 BOM is forbidden");
  }

  let markdown: string;
  try {
    markdown = UTF8_DECODER.decode(input);
  } catch {
    return fail("input is not valid UTF-8");
  }

  return parseCardMarkdown(markdown);
}
