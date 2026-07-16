import { TextDecoder } from "node:util";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const OPENING_MARKER = /^<!-- aleksi:value bytes=(0|[1-9]\d*) -->$/u;
const CLOSING_MARKER = "\n<!-- /aleksi:value -->";

export type MarkdownValueUnit = {
  byteLength: number;
  sourceEnd: number;
  sourceStart: number;
  value: string;
};

export class MarkdownValueUnitError extends Error {
  constructor(message = "Markdown value unit is invalid") {
    super(message);
    this.name = "MarkdownValueUnitError";
  }
}

export function markdownFrontmatterValue(value: unknown): string {
  return JSON.stringify(value);
}

export function serializeMarkdownValueUnit(value: string): string;
export function serializeMarkdownValueUnit(
  heading: string,
  value: string
): string;
export function serializeMarkdownValueUnit(
  headingOrValue: string,
  possibleValue?: string
): string {
  const value = possibleValue ?? headingOrValue;
  const unit = [
    `<!-- aleksi:value bytes=${Buffer.byteLength(value, "utf8")} -->`,
    value,
    "<!-- /aleksi:value -->"
  ].join("\n");
  return possibleValue === undefined
    ? unit
    : `## ${headingOrValue}\n${unit}`;
}

export function extractMarkdownValueUnit(
  markdown: string,
  heading?: string
): MarkdownValueUnit | null {
  const sourceStart =
    heading === undefined
      ? markdown.search(/(?:^|\n)<!-- aleksi:value bytes=/u) +
        (markdown.startsWith("<!-- aleksi:value bytes=") ? 0 : 1)
      : (() => {
          const headingText = `## ${heading}\n`;
          const headingIndex = markdown.indexOf(headingText);
          return headingIndex < 0 ? -1 : headingIndex + headingText.length;
        })();
  if (sourceStart < 0 || !markdown.startsWith("<!-- aleksi:value bytes=", sourceStart)) {
    return null;
  }

  const markerEnd = markdown.indexOf("\n", sourceStart);
  if (markerEnd < 0) {
    return null;
  }
  const marker = OPENING_MARKER.exec(markdown.slice(sourceStart, markerEnd));
  if (marker === null) {
    return null;
  }
  const byteLength = Number(marker[1]);
  if (!Number.isSafeInteger(byteLength)) {
    return null;
  }

  const valueStart = markerEnd + 1;
  const remaining = Buffer.from(markdown.slice(valueStart), "utf8");
  if (byteLength > remaining.length) {
    return null;
  }
  let value: string;
  try {
    value = UTF8_DECODER.decode(remaining.subarray(0, byteLength));
  } catch {
    return null;
  }
  const closingStart = valueStart + value.length;
  if (!markdown.startsWith(CLOSING_MARKER, closingStart)) {
    return null;
  }

  return {
    byteLength,
    sourceStart,
    sourceEnd: closingStart + CLOSING_MARKER.length,
    value
  };
}

export function requireMarkdownValueUnit(
  markdown: string,
  heading?: string
): MarkdownValueUnit {
  const unit = extractMarkdownValueUnit(markdown, heading);
  if (unit === null) {
    throw new MarkdownValueUnitError();
  }
  return unit;
}
