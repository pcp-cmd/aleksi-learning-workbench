import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";
import { CARD_LABELS } from "../../../shared/card-labels";
import { PRIMARY_CARD_TYPES, type PrimaryCardType } from "../../../shared/card-types";
import type { ReaderSelectionAnchor } from "./selection";

type SelectionActionsProps = {
  anchor: ReaderSelectionAnchor;
  onCard: (cardType: PrimaryCardType) => void;
  onClose: () => void;
  onDifficulty: () => void;
  onExcerpt: () => void;
  returnFocus: () => void;
};

function focusSibling(
  container: HTMLElement,
  current: HTMLElement,
  direction: -1 | 1
): void {
  const items = Array.from(
    container.querySelectorAll<HTMLElement>(
      ':scope > button, [role="menu"] > [role="menuitem"]'
    )
  );
  const index = items.indexOf(current);
  if (index === -1 || items.length === 0) {
    return;
  }
  items[(index + direction + items.length) % items.length]?.focus();
}

export function SelectionActions({
  anchor,
  onCard,
  onClose,
  onDifficulty,
  onExcerpt,
  returnFocus
}: SelectionActionsProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const cardButtonRef = useRef<HTMLButtonElement | null>(null);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    menuAbove: boolean;
    narrow: boolean;
    style: CSSProperties;
  }>({ menuAbove: false, narrow: false, style: {} });

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (toolbar === null) {
      return;
    }

    const place = () => {
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const narrow = viewportWidth < 640;
      if (narrow) {
        setPlacement({ menuAbove: false, narrow: true, style: {} });
        return;
      }

      const bounds = toolbar.getBoundingClientRect();
      const margin = 12;
      const left = Math.min(
        Math.max(anchor.rect.left, viewportLeft + margin),
        Math.max(
          viewportLeft + margin,
          viewportLeft + viewportWidth - bounds.width - margin
        )
      );
      const below = anchor.rect.bottom + 8;
      const desiredTop =
        below + bounds.height <= viewportTop + viewportHeight - margin
          ? below
          : Math.max(viewportTop + margin, anchor.rect.top - bounds.height - 8);
      const top = Math.min(
        Math.max(viewportTop + margin, desiredTop),
        Math.max(
          viewportTop + margin,
          viewportTop + viewportHeight - bounds.height - margin
        )
      );
      const menu = toolbar.querySelector<HTMLElement>("[role='menu']");
      const menuHeight = menu?.getBoundingClientRect().height ?? 0;
      const menuAbove =
        cardMenuOpen &&
        top + bounds.height + 8 + menuHeight > viewportTop + viewportHeight - margin;
      setPlacement({
        menuAbove,
        narrow: false,
        style: { left: Math.round(left), top: Math.round(top) }
      });
    };

    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [anchor, cardMenuOpen]);

  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (cardMenuOpen) {
        setCardMenuOpen(false);
        queueMicrotask(() => cardButtonRef.current?.focus());
      } else {
        onClose();
        queueMicrotask(returnFocus);
      }
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusSibling(event.currentTarget, target, 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSibling(event.currentTarget, target, -1);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && target.matches("button")) {
      event.preventDefault();
      target.click();
    }
  };

  return (
    <div
      aria-label="选区动作"
      className={`selection-actions${
        placement.narrow ? " selection-actions--sheet" : ""
      }`}
      onKeyDown={handleKeys}
      ref={toolbarRef}
      role="toolbar"
      style={placement.style}
    >
      <button className="button" onClick={onExcerpt} type="button">
        摘录
      </button>
      <button
        aria-expanded={cardMenuOpen}
        aria-haspopup="menu"
        className="button"
        onClick={() => setCardMenuOpen((current) => !current)}
        ref={cardButtonRef}
        type="button"
      >
        创建卡片
      </button>
      <button className="button" onClick={onDifficulty} type="button">
        记录困难
      </button>
      {cardMenuOpen ? (
        <div
          aria-label="选择卡片类型"
          className={`selection-actions__menu${
            placement.menuAbove ? " selection-actions__menu--above" : ""
          }`}
          role="menu"
        >
          {PRIMARY_CARD_TYPES.map((cardType) => (
            <button
              className="button button-ghost"
              key={cardType}
              onClick={() => onCard(cardType)}
              role="menuitem"
              type="button"
            >
              {CARD_LABELS[cardType].shortLabel}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
