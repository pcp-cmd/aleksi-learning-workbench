import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownNode = {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
};

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

export const markdownRemarkPlugins = [
  remarkGfm,
  remarkMath,
  remarkDoubleEqualsHighlight
];
