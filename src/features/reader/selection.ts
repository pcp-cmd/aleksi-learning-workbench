import { CARD_LABELS } from "../../../shared/card-labels";
import {
  PRIMARY_CARD_TYPES,
  type CardType,
  type PrimaryCardType
} from "../../../shared/card-types";

export type ReaderCardType = CardType;

export type ReaderSelectionAction =
  | {
      label: string;
      target: "basket";
    }
  | {
      cardType: PrimaryCardType;
      label: string;
      target: "cards";
    }
  | {
      label: string;
      target: "diagnosis";
    };

export type ReaderSelectionAnchor = {
  excerpt: string;
  rect: {
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
  };
};

export {
  READER_SELECTION_STORAGE_KEY,
  type ReaderSelectionPayload
} from "./reader-selection-transfer";

export const READER_SELECTION_ACTIONS: ReaderSelectionAction[] = [
  { target: "basket", label: "加入摘录篮" },
  ...PRIMARY_CARD_TYPES.map((cardType) => ({
    target: "cards" as const,
    cardType,
    label: `生成${CARD_LABELS[cardType].label}`
  })),
  { target: "diagnosis", label: "记录卡点" }
];

function isNodeInside(root: HTMLElement, node: Node | null): boolean {
  return node !== null && (node === root || root.contains(node));
}

export function readReaderSelection(
  readerElement: HTMLElement
): ReaderSelectionAnchor | null {
  const activeSelection = window.getSelection();

  if (
    activeSelection === null ||
    activeSelection.rangeCount === 0 ||
    activeSelection.isCollapsed ||
    !isNodeInside(readerElement, activeSelection.anchorNode) ||
    !isNodeInside(readerElement, activeSelection.focusNode)
  ) {
    return null;
  }

  const excerpt = activeSelection.toString().trim();

  if (excerpt.length === 0) {
    return null;
  }

  const range = activeSelection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const fallbackRect = readerElement.getBoundingClientRect();
  const source =
    Number.isFinite(rect.left) && rect.width > 0 ? rect : fallbackRect;

  return {
    excerpt,
    rect: {
      bottom: source.bottom,
      height: source.height,
      left: source.left,
      right: source.right,
      top: source.top,
      width: source.width
    }
  };
}
