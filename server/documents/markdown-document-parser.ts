import matter from "gray-matter";
import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type ParsedMarkdownDocument = {
  root: Root;
  source: string;
  content: string;
  contentStartCharacterOffset: number;
  frontmatterCharacterRange: { start: number; end: number } | null;
  diagnostics: string[];
};

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

function hasPosition(node: RootContent): node is RootContent & {
  position: NonNullable<RootContent["position"]>;
} {
  return node.position?.start.offset !== undefined && node.position.end.offset !== undefined;
}

export function parseMarkdownDocument(source: string): ParsedMarkdownDocument {
  const diagnostics: string[] = [];
  let content = source;
  let contentStartCharacterOffset = 0;
  let frontmatterCharacterRange: { start: number; end: number } | null = null;

  try {
    const parsedMatter = matter(source);
    // gray-matter caches parsed strings and omits its non-enumerable `matter`
    // field on later reads. Content displacement is the stable signal.
    if (parsedMatter.content !== source) {
      content = parsedMatter.content;
      contentStartCharacterOffset = source.length - content.length;
      frontmatterCharacterRange = {
        start: 0,
        end: contentStartCharacterOffset
      };
    }
  } catch (error) {
    diagnostics.push(
      `Front matter could not be interpreted and was parsed as Markdown: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }

  const root = parser.parse(content) as Root;
  const positionless = root.children.filter((node) => !hasPosition(node));
  if (positionless.length > 0) {
    diagnostics.push(`${positionless.length} top-level Markdown nodes have no source position`);
  }

  return {
    root,
    source,
    content,
    contentStartCharacterOffset,
    frontmatterCharacterRange,
    diagnostics
  };
}
