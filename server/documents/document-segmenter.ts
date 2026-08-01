import { createHash } from "node:crypto";
import type { Heading, RootContent } from "mdast";
import {
  DOCUMENT_CHUNK_SOFT_MAX_BYTES,
  DOCUMENT_CHUNK_TARGET_BYTES,
  DOCUMENT_COMPLEXITY_THRESHOLDS
} from "../../shared/document-limits";
import type {
  DocumentComplexity,
  DocumentOutlineNode,
  StoredDocumentChunk
} from "../../shared/document-contract";
import {
  countMarkdownNodes,
  markdownNodeText,
  visitMarkdownNodes
} from "./document-text";
import type { ParsedMarkdownDocument } from "./markdown-document-parser";
import { mapCharacterOffsetsToSourceLocations } from "./source-offset-map";

type PositionedBlock = {
  node: RootContent;
  startCharacterOffset: number;
  endCharacterOffset: number;
  startByteOffset: number;
  endByteOffset: number;
  startLine: number;
  endLine: number;
  headingPath: string[];
};

export type SegmentedDocument = {
  chunks: StoredDocumentChunk[];
  outline: DocumentOutlineNode[];
  definitionMarkdown: string;
  complexity: DocumentComplexity;
  lineCount: number;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function estimatedTokens(value: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(value, "utf8") / 3.2));
}

function headingTitle(node: Heading): string {
  return markdownNodeText(node).replace(/\s+/gu, " ").trim() || "未命名小节";
}

function isDefinition(node: RootContent): boolean {
  return node.type === "definition" || node.type === "footnoteDefinition";
}

function positionedBlocks(parsed: ParsedMarkdownDocument): PositionedBlock[] {
  const positioned = parsed.root.children.filter(
    (node): node is RootContent & { position: NonNullable<RootContent["position"]> } =>
      node.position?.start.offset !== undefined && node.position.end.offset !== undefined
  );
  const absoluteOffsets = positioned.flatMap((node) => [
    parsed.contentStartCharacterOffset + (node.position.start.offset ?? 0),
    parsed.contentStartCharacterOffset + (node.position.end.offset ?? 0)
  ]);
  const locations = mapCharacterOffsetsToSourceLocations(parsed.source, absoluteOffsets);
  const headingStack: string[] = [];

  return positioned.map((node) => {
    if (node.type === "heading") {
      headingStack.length = node.depth - 1;
      headingStack[node.depth - 1] = headingTitle(node);
    }
    const startCharacterOffset =
      parsed.contentStartCharacterOffset + (node.position.start.offset ?? 0);
    const endCharacterOffset =
      parsed.contentStartCharacterOffset + (node.position.end.offset ?? 0);
    const start = locations.get(startCharacterOffset);
    const end = locations.get(endCharacterOffset);
    if (start === undefined || end === undefined) {
      throw new Error("Markdown source location mapping is incomplete");
    }
    return {
      node,
      startCharacterOffset,
      endCharacterOffset,
      startByteOffset: start.byteOffset,
      endByteOffset: end.byteOffset,
      startLine: start.line,
      endLine: end.line,
      headingPath: headingStack.filter((value) => value !== undefined)
    };
  });
}

function shouldStartNewChunk(
  current: readonly PositionedBlock[],
  next: PositionedBlock
): boolean {
  if (current.length === 0) {
    return false;
  }
  const currentBytes =
    current[current.length - 1]!.endByteOffset - current[0]!.startByteOffset;
  if (next.node.type === "heading") {
    return next.node.depth <= 3 || currentBytes >= DOCUMENT_CHUNK_TARGET_BYTES / 2;
  }
  const combinedBytes = next.endByteOffset - current[0]!.startByteOffset;
  return (
    currentBytes >= DOCUMENT_CHUNK_TARGET_BYTES ||
    combinedBytes > DOCUMENT_CHUNK_SOFT_MAX_BYTES
  );
}

function buildOutline(
  documentId: string,
  blocks: readonly PositionedBlock[],
  chunkByBlock: ReadonlyMap<RootContent, string>
): DocumentOutlineNode[] {
  const roots: DocumentOutlineNode[] = [];
  const stack: DocumentOutlineNode[] = [];
  const collisionCount = new Map<string, number>();

  for (const block of blocks) {
    if (block.node.type !== "heading") {
      continue;
    }
    const title = headingTitle(block.node);
    const chunkId = chunkByBlock.get(block.node);
    if (chunkId === undefined) {
      continue;
    }
    const base = sha256(
      `${documentId}\u0000${block.node.depth}\u0000${block.headingPath.join("\u0000")}`
    ).slice(0, 20);
    const occurrence = (collisionCount.get(base) ?? 0) + 1;
    collisionCount.set(base, occurrence);
    const outlineNode: DocumentOutlineNode = {
      nodeId: `outline-${base}-${occurrence}`,
      documentId,
      chunkId,
      title,
      level: block.node.depth,
      sourceStartOffset: block.startByteOffset,
      sourceStartLine: block.startLine,
      children: []
    };
    while (stack.length > 0 && stack[stack.length - 1]!.level >= outlineNode.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      roots.push(outlineNode);
    } else {
      parent.children.push(outlineNode);
    }
    stack.push(outlineNode);
  }
  return roots;
}

function assessComplexity(
  parsed: ParsedMarkdownDocument,
  blocks: readonly PositionedBlock[]
): DocumentComplexity {
  let headingCount = 0;
  let paragraphCount = 0;
  let mathBlockCount = 0;
  let codeBlockCount = 0;
  let tableCount = 0;
  let renderedNodeCount = 0;
  visitMarkdownNodes(parsed.root, (node) => {
    renderedNodeCount += 1;
    if (node.type === "heading") headingCount += 1;
    if (node.type === "paragraph") paragraphCount += 1;
    if (node.type === "math") mathBlockCount += 1;
    if (node.type === "code") codeBlockCount += 1;
    if (node.type === "table") tableCount += 1;
  });
  const byteSize = Buffer.byteLength(parsed.source, "utf8");
  const metrics = {
    byteSize,
    lineCount: parsed.source.length === 0 ? 0 : parsed.source.split("\n").length,
    astNodeCount: countMarkdownNodes(parsed.root),
    headingCount,
    paragraphCount,
    mathBlockCount,
    codeBlockCount,
    tableCount,
    estimatedRenderedNodeCount: renderedNodeCount,
    estimatedTokens: estimatedTokens(parsed.source),
    maximumSingleBlockBytes: blocks.reduce(
      (maximum, block) => Math.max(maximum, block.endByteOffset - block.startByteOffset),
      0
    )
  };
  const reasons = Object.entries(DOCUMENT_COMPLEXITY_THRESHOLDS)
    .filter(([key, threshold]) => metrics[key as keyof typeof metrics] >= threshold)
    .map(([key]) => key);
  return { mode: reasons.length === 0 ? "standard" : "large", reasons, metrics };
}

export function segmentMarkdownDocument(
  documentId: string,
  parsed: ParsedMarkdownDocument
): SegmentedDocument {
  const allBlocks = positionedBlocks(parsed);
  const definitionBlocks = allBlocks.filter((block) => isDefinition(block.node));
  const contentBlocks = allBlocks.filter((block) => !isDefinition(block.node));
  const groups: PositionedBlock[][] = [];
  let current: PositionedBlock[] = [];

  for (const block of contentBlocks) {
    if (shouldStartNewChunk(current, block)) {
      groups.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) {
    groups.push(current);
  }

  const collisionCount = new Map<string, number>();
  const chunkByBlock = new Map<RootContent, string>();
  const chunks: StoredDocumentChunk[] = groups.map((group) => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const markdown = parsed.source.slice(
      first.startCharacterOffset,
      last.endCharacterOffset
    );
    const contentHash = sha256(Buffer.from(markdown, "utf8"));
    const identityBase = sha256(
      `${documentId}\u0000${first.headingPath.join("\u0000")}\u0000${contentHash}`
    ).slice(0, 24);
    const occurrence = (collisionCount.get(identityBase) ?? 0) + 1;
    collisionCount.set(identityBase, occurrence);
    const chunkId = `chunk-${identityBase}-${occurrence}`;
    for (const block of group) {
      chunkByBlock.set(block.node, chunkId);
    }
    const firstHeading = group.find((block) => block.node.type === "heading");
    const bytes = last.endByteOffset - first.startByteOffset;
    return {
      chunkId,
      documentId,
      ...(firstHeading?.node.type === "heading"
        ? {
            title: headingTitle(firstHeading.node),
            headingLevel: firstHeading.node.depth
          }
        : {}),
      headingPath: first.headingPath,
      sourceStartOffset: first.startByteOffset,
      sourceEndOffset: last.endByteOffset,
      sourceStartLine: first.startLine,
      sourceEndLine: last.endLine,
      contentHash,
      estimatedTokens: estimatedTokens(markdown),
      oversized: bytes > DOCUMENT_CHUNK_SOFT_MAX_BYTES,
      plainText: group
        .map((block) => markdownNodeText(block.node))
        .filter((value) => value.length > 0)
        .join("\n\n")
    } satisfies StoredDocumentChunk;
  });

  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) chunk.previousChunkId = chunks[index - 1]!.chunkId;
    if (index + 1 < chunks.length) chunk.nextChunkId = chunks[index + 1]!.chunkId;
  }

  return {
    chunks,
    outline: buildOutline(documentId, contentBlocks, chunkByBlock),
    definitionMarkdown: definitionBlocks
      .map((block) =>
        parsed.source.slice(block.startCharacterOffset, block.endCharacterOffset)
      )
      .join("\n\n"),
    complexity: assessComplexity(parsed, allBlocks),
    lineCount: parsed.source.length === 0 ? 0 : parsed.source.split("\n").length
  };
}
