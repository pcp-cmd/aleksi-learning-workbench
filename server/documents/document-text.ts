import type { Nodes } from "mdast";

type TraversableNode = Nodes & { children?: TraversableNode[]; value?: string };

export function markdownNodeText(node: TraversableNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }

  if (node.type === "image") {
    return node.alt ?? "";
  }

  const children = node.children ?? [];
  const separator =
    node.type === "root" ||
    node.type === "list" ||
    node.type === "listItem" ||
    node.type === "blockquote" ||
    node.type === "table" ||
    node.type === "tableRow"
      ? "\n"
      : "";
  return children
    .map((child) => markdownNodeText(child))
    .filter((value) => value.length > 0)
    .join(separator);
}

export function countMarkdownNodes(node: TraversableNode): number {
  return 1 + (node.children ?? []).reduce(
    (total, child) => total + countMarkdownNodes(child),
    0
  );
}

export function visitMarkdownNodes(
  node: TraversableNode,
  visitor: (node: TraversableNode) => void
): void {
  visitor(node);
  for (const child of node.children ?? []) {
    visitMarkdownNodes(child, visitor);
  }
}
