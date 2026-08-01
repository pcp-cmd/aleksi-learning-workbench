import { useLayoutEffect, type RefObject } from "react";
import {
  createReadingReturnContext,
  type ReadingReturnContext
} from "../../app/navigation-return";
import {
  readReaderStateDraft,
  writeReaderStateDraft
} from "./reader-draft-store";

function readerHasIndependentScroll(reader: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(reader).overflowY;
  return (
    reader.scrollHeight > reader.clientHeight + 1 &&
    (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
  );
}

export function readReadingScrollTop(reader: HTMLElement | null): number {
  return reader !== null && readerHasIndependentScroll(reader)
    ? reader.scrollTop
    : window.scrollY;
}

function restoreReadingScrollTop(reader: HTMLElement, scrollTop: number): void {
  if (readerHasIndependentScroll(reader)) {
    reader.scrollTop = scrollTop;
    return;
  }
  window.scrollTo({ behavior: "auto", left: window.scrollX, top: scrollTop });
}

function persistReaderPosition(
  selectedReadingId: string | null,
  scrollTop: number
): void {
  const current = readReaderStateDraft();
  const preservesContext = current?.selectedReadingId === selectedReadingId;
  writeReaderStateDraft({
    selectedReadingId,
    scrollTop,
    readingMode: "intensive",
    ...(preservesContext && current.sectionAnchor !== undefined
      ? { sectionAnchor: current.sectionAnchor }
      : {}),
    ...(preservesContext && current.focusExcerpt !== undefined
      ? { focusExcerpt: current.focusExcerpt }
      : {}),
    ...(preservesContext && current.activeChunkId !== undefined
      ? { activeChunkId: current.activeChunkId }
      : {})
  });
}

function focusRestoredReadingContext(
  reader: HTMLElement,
  context: Pick<ReadingReturnContext, "focusExcerpt" | "sectionAnchor">
): boolean {
  const elements = Array.from(
    reader.querySelectorAll<HTMLElement>(
      "h1, h2, h3, h4, h5, h6, p, li, blockquote"
    )
  );
  const target =
    (context.sectionAnchor === undefined
      ? undefined
      : elements.find(
          (element) => element.textContent?.trim() === context.sectionAnchor
        )) ??
    (context.focusExcerpt === undefined
      ? undefined
      : elements.find((element) =>
          element.textContent?.includes(context.focusExcerpt ?? "")
        )) ??
    reader;

  if (target !== reader && !target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  return target !== reader;
}

export function useReaderScrollRestoration(options: {
  contentReady: boolean;
  readerRef: RefObject<HTMLElement | null>;
  readingRestore: ReadingReturnContext | null;
  selectedReadingId: string | null;
}): void {
  useLayoutEffect(() => {
    const reader = options.readerRef.current;
    if (!options.contentReady || reader === null) return undefined;
    const restored =
      options.readingRestore?.documentId === options.selectedReadingId
        ? options.readingRestore
        : readReaderStateDraft();
    const matches =
      restored !== null &&
      (("selectedReadingId" in restored &&
        restored.selectedReadingId === options.selectedReadingId) ||
        ("documentId" in restored &&
          restored.documentId === options.selectedReadingId));

    const restoreScroll = () => {
      if (!matches || restored === null) return false;
      const contextReady = focusRestoredReadingContext(reader, restored);
      restoreReadingScrollTop(reader, restored.scrollTop);
      return contextReady;
    };
    restoreScroll();
    const scrollTarget: HTMLElement | Window = readerHasIndependentScroll(reader)
      ? reader
      : window;
    const persistScroll = () =>
      persistReaderPosition(
        options.selectedReadingId,
        readReadingScrollTop(reader)
      );
    scrollTarget.addEventListener("scroll", persistScroll, { passive: true });
    let frame: number | null = null;
    const hasContextAnchor =
      restored !== null &&
      (restored.sectionAnchor !== undefined || restored.focusExcerpt !== undefined);
    if (
      matches &&
      restored !== null &&
      (options.readingRestore !== null || hasContextAnchor)
    ) {
      let attempts = 0;
      let stableFrames = 0;
      const restoreUntilReady = () => {
        const contextReady = restoreScroll();
        const distance = Math.abs(readReadingScrollTop(reader) - restored!.scrollTop);
        stableFrames = contextReady && distance <= 1 ? stableFrames + 1 : 0;
        attempts += 1;
        if (stableFrames < 3 && attempts < 120) {
          frame = window.requestAnimationFrame(restoreUntilReady);
        }
      };
      frame = window.requestAnimationFrame(restoreUntilReady);
    }
    return () => {
      scrollTarget.removeEventListener("scroll", persistScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [
    options.contentReady,
    options.readerRef,
    options.readingRestore,
    options.selectedReadingId
  ]);
}

export function persistReadingReturnContext(options: {
  documentId: string;
  scrollTop: number;
  focusExcerpt: string;
  sectionAnchor?: string;
  activeChunkId?: string;
}): ReadingReturnContext {
  writeReaderStateDraft({
    selectedReadingId: options.documentId,
    scrollTop: options.scrollTop,
    readingMode: "intensive",
    focusExcerpt: options.focusExcerpt,
    ...(options.sectionAnchor === undefined
      ? {}
      : { sectionAnchor: options.sectionAnchor }),
    ...(options.activeChunkId === undefined
      ? {}
      : { activeChunkId: options.activeChunkId })
  });
  return createReadingReturnContext(options);
}
