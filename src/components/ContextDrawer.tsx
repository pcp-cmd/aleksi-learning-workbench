import type { ReactNode } from "react";

export interface ContextDrawerProps {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}

export function ContextDrawer({ children, open, onClose }: ContextDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <aside
      aria-label="上下文说明"
      className="context-drawer"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      role="complementary"
      tabIndex={0}
    >
      <div className="context-drawer__header">
        <div>
          <p className="eyebrow">Context</p>
          <h2>上下文说明</h2>
        </div>
        <button
          aria-label="关闭上下文说明"
          className="button button-ghost"
          onClick={onClose}
          type="button"
        >
          关闭
        </button>
      </div>
      <div className="context-drawer__body">{children}</div>
    </aside>
  );
}
