import type { Dispatch, RefObject, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import {
  stateWithReturnContext,
  type NavigationReturnContext
} from "../../app/navigation-return";
import { confirmDiscardForNavigation } from "../../lib/unsaved-guard";
import {
  createExcerptBasketItem,
  writeExcerptBasketItems,
  type ExcerptBasketItem
} from "./excerpt-basket";
import type { ReadingListEntry } from "./reader-queries";
import {
  type ReaderCardType,
  type ReaderSelectionAnchor,
  type ReaderSelectionPayload
} from "./selection";
import { writeReaderSelectionPayload } from "./reader-selection-transfer";
import { persistReadingReturnContext, readReadingScrollTop } from "./reader-return";

export type ReaderTool = "materials" | "basket" | "import" | null;

type SelectionWorkspaceOptions = {
  activeDocumentChunkId?: string;
  inheritedReturnContext: NavigationReturnContext | null;
  navigate: NavigateFunction;
  readerRef: RefObject<HTMLElement | null>;
  readings: ReadingListEntry[];
  selectedReadingId: string | null;
  selectionAnchor: ReaderSelectionAnchor | null;
  setActiveTool: Dispatch<SetStateAction<ReaderTool>>;
  setExcerptBasket: Dispatch<SetStateAction<ExcerptBasketItem[]>>;
  setSelectionAnchor: Dispatch<SetStateAction<ReaderSelectionAnchor | null>>;
};

export function createReaderSelectionWorkspace(options: SelectionWorkspaceOptions) {
  function currentReturnContext(
    payload: ReaderSelectionPayload,
    sectionAnchor?: string,
    chunkId?: string
  ) {
    const scrollTop = options.selectedReadingId === payload.sourceReadingId
      ? readReadingScrollTop(options.readerRef.current)
      : 0;
    const resolvedChunkId = chunkId ?? options.activeDocumentChunkId;
    return persistReadingReturnContext({
      documentId: payload.sourceReadingId,
      scrollTop,
      focusExcerpt: payload.excerpt,
      ...(sectionAnchor === undefined ? {} : { sectionAnchor }),
      ...(resolvedChunkId === undefined ? {} : { activeChunkId: resolvedChunkId })
    });
  }

  function updateBasket(updater: (items: ExcerptBasketItem[]) => ExcerptBasketItem[]) {
    options.setExcerptBasket((items) => {
      const next = updater(items);
      writeExcerptBasketItems(next);
      return next;
    });
  }

  function openPayload(
    payload: ReaderSelectionPayload,
    sectionAnchor?: string,
    chunkId?: string
  ) {
    writeReaderSelectionPayload(payload);
    const returnContext = options.inheritedReturnContext ??
      currentReturnContext(payload, sectionAnchor, chunkId);
    options.navigate(payload.target === "cards" ? "/cards" : "/diagnosis", {
      state: stateWithReturnContext(returnContext, { readerSelection: payload })
    });
  }

  function payloadFromBasketItem(
    item: ExcerptBasketItem,
    target: "cards" | "diagnosis",
    cardType?: ReaderCardType
  ): ReaderSelectionPayload {
    return {
      source: "reader-selection",
      target,
      sourceReadingId: item.sourceReadingId,
      sourcePath: item.sourcePath,
      concept: item.concept,
      excerpt: item.excerptText,
      ...(target === "cards" && cardType !== undefined ? { cardType } : {})
    };
  }

  return {
    clearBasket() {
      updateBasket(() => []);
    },
    addSelectionToBasket() {
      const reading = options.readings.find(
        (entry) => entry.id === options.selectedReadingId
      );
      if (reading === undefined || options.selectionAnchor === null) return;
      updateBasket((items) => [
        createExcerptBasketItem({
          sourceReadingId: reading.id,
          sourcePath: reading.relativePath,
          concept: reading.concept,
          excerptText: options.selectionAnchor?.excerpt ?? ""
        }),
        ...items
      ]);
      options.setSelectionAnchor(null);
      options.setActiveTool("basket");
      window.getSelection()?.removeAllRanges();
    },
    transferSelection(target: "cards" | "diagnosis", cardType?: ReaderCardType) {
      const reading = options.readings.find(
        (entry) => entry.id === options.selectedReadingId
      );
      if (reading === undefined || options.selectionAnchor === null) return;
      const targetPath = target === "cards" ? "/cards" : "/diagnosis";
      if (!confirmDiscardForNavigation(targetPath)) return;
      openPayload({
        source: "reader-selection",
        target,
        sourceReadingId: reading.id,
        sourcePath: reading.relativePath,
        concept: reading.concept,
        excerpt: options.selectionAnchor.excerpt,
        ...(target === "cards" && cardType !== undefined ? { cardType } : {})
      }, options.selectionAnchor.sectionAnchor, options.selectionAnchor.chunkId);
      options.setSelectionAnchor(null);
    },
    activateBasketCard(item: ExcerptBasketItem, cardType: ReaderCardType) {
      if (!confirmDiscardForNavigation("/cards")) return;
      updateBasket((items) => items.filter((entry) => entry.id !== item.id));
      openPayload(payloadFromBasketItem(item, "cards", cardType));
    },
    activateBasketDiagnosis(item: ExcerptBasketItem) {
      if (!confirmDiscardForNavigation("/diagnosis")) return;
      updateBasket((items) => items.filter((entry) => entry.id !== item.id));
      openPayload(payloadFromBasketItem(item, "diagnosis"));
    }
  };
}
