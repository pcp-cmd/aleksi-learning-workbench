import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownNode = {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
};

const LIST_STRONG_CJK_BOUNDARY =
  /\*\*([^*\n]*[\p{P}])\*\*(?=[\p{L}\p{N}])/gu;

function highlightedTextNodes(value: string): MarkdownNode[] {
  const parts: MarkdownNode[] = [];
  const pattern = /==([^=\n]+?)==/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    parts.push({
      type: "emphasis",
      data: { hName: "mark" },
      children: [{ type: "text", value: match[1] }]
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push({ type: "text", value: value.slice(cursor) });
  }

  return parts;
}

export function remarkDoubleEqualsHighlight() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!Array.isArray(node.children)) {
        return;
      }

      const nextChildren: MarkdownNode[] = [];
      for (const child of node.children) {
        if (
          child.type === "text" &&
          typeof child.value === "string" &&
          child.value.includes("==")
        ) {
          nextChildren.push(...highlightedTextNodes(child.value));
        } else {
          visit(child);
          nextChildren.push(child);
        }
      }
      node.children = nextChildren;
    }

    visit(tree);
  };
}

function compatibleListStrongNodes(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  LIST_STRONG_CJK_BOUNDARY.lastIndex = 0;

  while ((match = LIST_STRONG_CJK_BOUNDARY.exec(value)) !== null) {
    if (match.index > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    nodes.push({
      type: "strong",
      children: [{ type: "text", value: match[1] }]
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }

  return nodes;
}

/**
 * CommonMark does not close `**` when a punctuation-ending label is followed
 * immediately by a CJK letter, for example `**承载对象：**元素`. Reading notes
 * use that compact label style heavily. Keep the compatibility rule inside the
 * shared Markdown AST pipeline and scope it to list items so code, source files,
 * and ordinary literal asterisks remain untouched.
 */
export function remarkListItemStrongCompatibility() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode, insideListItem: boolean) {
      if (!Array.isArray(node.children)) {
        return;
      }

      const nextChildren: MarkdownNode[] = [];
      const childInsideListItem = insideListItem || node.type === "listItem";
      for (const child of node.children) {
        if (
          childInsideListItem &&
          child.type === "text" &&
          typeof child.value === "string" &&
          LIST_STRONG_CJK_BOUNDARY.test(child.value)
        ) {
          nextChildren.push(...compatibleListStrongNodes(child.value));
        } else {
          visit(child, childInsideListItem);
          nextChildren.push(child);
        }
        LIST_STRONG_CJK_BOUNDARY.lastIndex = 0;
      }
      node.children = nextChildren;
    }

    visit(tree, false);
  };
}

export const markdownRemarkPlugins = [
  remarkGfm,
  remarkMath,
  remarkListItemStrongCompatibility,
  remarkDoubleEqualsHighlight
];
