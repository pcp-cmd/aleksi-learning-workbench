import type { DocumentOutlineNode } from "../../../shared/document-contract";

export function DocumentOutline({
  activeChunkId,
  nodes,
  onActivate
}: {
  activeChunkId: string;
  nodes: DocumentOutlineNode[];
  onActivate: (chunkId: string) => void;
}) {
  return (
    <nav aria-label="完整文档目录" className="document-outline">
      <ol>
        {nodes.map((node) => (
          <OutlineItem
            activeChunkId={activeChunkId}
            key={node.nodeId}
            node={node}
            onActivate={onActivate}
          />
        ))}
      </ol>
    </nav>
  );
}

function OutlineItem({
  activeChunkId,
  node,
  onActivate
}: {
  activeChunkId: string;
  node: DocumentOutlineNode;
  onActivate: (chunkId: string) => void;
}) {
  return (
    <li>
      <button
        aria-current={node.chunkId === activeChunkId ? "location" : undefined}
        className={node.chunkId === activeChunkId ? "is-active" : undefined}
        onClick={() => onActivate(node.chunkId)}
        type="button"
      >
        {node.title}
      </button>
      {node.children.length === 0 ? null : (
        <ol>
          {node.children.map((child) => (
            <OutlineItem
              activeChunkId={activeChunkId}
              key={child.nodeId}
              node={child}
              onActivate={onActivate}
            />
          ))}
        </ol>
      )}
    </li>
  );
}
