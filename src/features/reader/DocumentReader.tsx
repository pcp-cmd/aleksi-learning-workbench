import { useQuery } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  DocumentChunkMetadata,
  DocumentSearchResult,
  LearningDocumentDescriptor
} from "../../../shared/document-contract";
import { DOCUMENT_READER_NEIGHBOR_COUNT } from "../../../shared/document-limits";
import { queryKeys } from "../../app/query-keys";
import { libraryQueryScope, useLibraryIdentity } from "../../lib/library-identity";
import { AuthenticatedReadingImage } from "./AuthenticatedReadingImage";
import { loadDocumentChunk } from "./document-api";
import { DocumentOutline } from "./DocumentOutline";
import { DocumentSearch } from "./DocumentSearch";

const MarkdownRenderer = lazy(() =>
  import("../../markdown/MarkdownRenderer").then((module) => ({
    default: module.MarkdownRenderer
  }))
);

const MAX_CACHED_DOCUMENT_HEIGHT_MAPS = 8;
const documentHeightCache = new Map<string, Map<string, number>>();

function measuredHeightsForDocument(
  descriptor: LearningDocumentDescriptor
): Map<string, number> {
  const key = `${descriptor.documentId}:${descriptor.sourceHash}`;
  const cached = documentHeightCache.get(key);
  if (cached !== undefined) {
    documentHeightCache.delete(key);
    documentHeightCache.set(key, cached);
    return cached;
  }
  const measured = new Map<string, number>();
  documentHeightCache.set(key, measured);
  while (documentHeightCache.size > MAX_CACHED_DOCUMENT_HEIGHT_MAPS) {
    const oldest = documentHeightCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    documentHeightCache.delete(oldest);
  }
  return measured;
}

function estimatedChunkHeight(chunk: DocumentChunkMetadata): number {
  return Math.max(180, Math.min(6_000, chunk.estimatedTokens * 0.62));
}

function cumulativeHeight(
  chunks: readonly DocumentChunkMetadata[],
  start: number,
  end: number,
  measured: ReadonlyMap<string, number>
): number {
  let height = 0;
  for (let index = start; index < end; index += 1) {
    const chunk = chunks[index];
    if (chunk !== undefined) {
      height += measured.get(chunk.chunkId) ?? estimatedChunkHeight(chunk);
    }
  }
  return height;
}

function chunkIndexAtHeight(
  chunks: readonly DocumentChunkMetadata[],
  offset: number,
  measured: ReadonlyMap<string, number>
): number {
  let cursor = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk === undefined) continue;
    cursor += measured.get(chunk.chunkId) ?? estimatedChunkHeight(chunk);
    if (offset < cursor) return index;
  }
  return Math.max(0, chunks.length - 1);
}

function DocumentChunkView({
  chunk,
  documentId,
  highlighted,
  onHeightChange,
  resolveImageUrl
}: {
  chunk: DocumentChunkMetadata;
  documentId: string;
  highlighted: boolean;
  onHeightChange: (chunkId: string, height: number) => void;
  resolveImageUrl: (source: string) => string;
}) {
  const identity = useLibraryIdentity();
  const sectionRef = useRef<HTMLElement | null>(null);
  const content = useQuery({
    queryKey: [...queryKeys.documents.chunk(documentId, chunk.chunkId), ...libraryQueryScope(identity)],
    queryFn: ({ signal }) => loadDocumentChunk(documentId, chunk.chunkId, signal)
  });

  useLayoutEffect(() => {
    const element = sectionRef.current;
    if (element === null) return;
    const report = () => {
      if (element.offsetHeight > 0) onHeightChange(chunk.chunkId, element.offsetHeight);
    };
    report();
    const frame = window.requestAnimationFrame(report);
    if (typeof ResizeObserver === "undefined") {
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [chunk.chunkId, content.data, content.isError, content.isPending, onHeightChange]);

  return (
    <section
      aria-busy={content.isPending}
      className={`document-chunk${highlighted ? " is-search-target" : ""}`}
      data-chunk-id={chunk.chunkId}
      data-source-end={chunk.sourceEndOffset}
      data-source-start={chunk.sourceStartOffset}
      ref={sectionRef}
      tabIndex={-1}
    >
      {content.isPending ? <p>正在载入本节…</p> : null}
      {content.isError ? (
        <div className="document-chunk__error" role="alert">
          <strong>这一节暂时无法排版</strong>
          <p>{content.error instanceof Error ? content.error.message : "请重试载入本节。"}</p>
          <button className="button button-ghost" onClick={() => void content.refetch()} type="button">
            重试本节
          </button>
        </div>
      ) : null}
      {content.data === undefined ? null : (
        <Suspense fallback={<p>正在排版本节…</p>}>
          <MarkdownRenderer
            components={{ img: AuthenticatedReadingImage }}
            resolveImageUrl={resolveImageUrl}
            source={content.data}
          />
        </Suspense>
      )}
    </section>
  );
}

export function DocumentReader({
  descriptor,
  initialChunkId,
  onActiveChunkChange,
  resolveImageUrl
}: {
  descriptor: LearningDocumentDescriptor;
  initialChunkId?: string;
  onActiveChunkChange: (chunkId: string) => void;
  resolveImageUrl: (source: string) => string;
}) {
  const initialIndex = Math.max(
    0,
    descriptor.chunks.findIndex((chunk) => chunk.chunkId === initialChunkId)
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [highlightedChunkId, setHighlightedChunkId] = useState<string | null>(null);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const measuredHeights = useMemo(
    () => measuredHeightsForDocument(descriptor),
    [descriptor]
  );
  const readerRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef<string | null>(initialChunkId ?? null);
  const programmaticScroll = useRef(false);
  const activeChunk = descriptor.chunks[activeIndex] ?? descriptor.chunks[0];
  const firstLoaded = Math.max(0, activeIndex - DOCUMENT_READER_NEIGHBOR_COUNT);
  const lastLoaded = Math.min(
    descriptor.chunks.length,
    activeIndex + DOCUMENT_READER_NEIGHBOR_COUNT + 1
  );
  const loaded = descriptor.chunks.slice(firstLoaded, lastLoaded);
  const topHeight = useMemo(
    () => cumulativeHeight(descriptor.chunks, 0, firstLoaded, measuredHeights),
    [descriptor.chunks, firstLoaded, measuredHeights, measurementVersion]
  );
  const bottomHeight = useMemo(
    () => cumulativeHeight(descriptor.chunks, lastLoaded, descriptor.chunks.length, measuredHeights),
    [descriptor.chunks, lastLoaded, measuredHeights, measurementVersion]
  );

  const recordChunkHeight = useCallback((chunkId: string, height: number) => {
    if (measuredHeights.get(chunkId) === height) return;
    measuredHeights.set(chunkId, height);
    setMeasurementVersion((version) => version + 1);
  }, [measuredHeights]);

  useEffect(() => {
    setActiveIndex(Math.max(0, descriptor.chunks.findIndex((chunk) => chunk.chunkId === initialChunkId)));
    pendingFocus.current = initialChunkId ?? null;
    // `initialChunkId` is a restore hint for a newly opened/indexed document.
    // Active-section callbacks update the parent route state; treating those
    // updates as a new restore request would repeatedly scroll the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor.documentId, descriptor.sourceHash]);

  useEffect(() => {
    if (activeChunk !== undefined) onActiveChunkChange(activeChunk.chunkId);
  }, [activeChunk, onActiveChunkChange]);

  useEffect(() => {
    let frame: number | null = null;
    const releaseForScrollIntent = () => {
      programmaticScroll.current = false;
    };
    const releaseForScrollKey = (event: KeyboardEvent) => {
      if ([
        "ArrowDown",
        "ArrowUp",
        "End",
        "Home",
        "PageDown",
        "PageUp",
        " "
      ].includes(event.key)) {
        releaseForScrollIntent();
      }
    };
    const releaseForScrollbarPointer = (event: PointerEvent) => {
      if (event.clientX >= document.documentElement.clientWidth - 24) {
        releaseForScrollIntent();
      }
    };
    const updateFromScroll = () => {
      frame = null;
      const reader = readerRef.current;
      if (reader === null) return;
      if (programmaticScroll.current) return;
      const contentOrigin = reader.querySelector<HTMLElement>(
        ".document-window-spacer"
      );
      if (contentOrigin === null) return;
      const documentTop = contentOrigin.getBoundingClientRect().top + window.scrollY;
      const readingLine = window.scrollY + window.innerHeight * 0.35;
      if (readingLine < documentTop) return;
      setActiveIndex(chunkIndexAtHeight(
        descriptor.chunks,
        readingLine - documentTop,
        measuredHeights
      ));
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateFromScroll);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("wheel", releaseForScrollIntent, { passive: true });
    window.addEventListener("touchmove", releaseForScrollIntent, { passive: true });
    window.addEventListener("keydown", releaseForScrollKey);
    window.addEventListener("pointerdown", releaseForScrollbarPointer);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wheel", releaseForScrollIntent);
      window.removeEventListener("touchmove", releaseForScrollIntent);
      window.removeEventListener("keydown", releaseForScrollKey);
      window.removeEventListener("pointerdown", releaseForScrollbarPointer);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [descriptor.chunks, measuredHeights]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const targetId = pendingFocus.current;
      if (targetId !== null) {
        const target = Array.from(
          document.querySelectorAll<HTMLElement>("[data-chunk-id]")
        ).find((element) => element.dataset.chunkId === targetId) ?? null;
        if (target !== null) {
          // A directory/search jump deliberately changes window.scrollY. Do not
          // feed that same programmatic movement back into the virtual-window
          // selector or a short chunk can immediately advance past the target.
          programmaticScroll.current = true;
          if (typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ behavior: "auto", block: "start" });
          }
          target.focus({ preventScroll: true });
          pendingFocus.current = null;
        }
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [descriptor.documentId, descriptor.sourceHash, firstLoaded, lastLoaded]);

  function activateChunk(chunkId: string) {
    const index = descriptor.chunks.findIndex((chunk) => chunk.chunkId === chunkId);
    if (index < 0) return;
    // Clicking a deep item in the expanded outline can scroll that button into
    // view before React commits the requested document window. Lock at the
    // interaction boundary so that preparatory scroll cannot replace `index`.
    programmaticScroll.current = true;
    pendingFocus.current = chunkId;
    setActiveIndex(index);
  }

  function activateSearchResult(result: DocumentSearchResult) {
    setHighlightedChunkId(result.chunkId);
    activateChunk(result.chunkId);
  }

  if (activeChunk === undefined) {
    return <p role="alert">文档索引中没有可读取的章节。</p>;
  }

  return (
    <div className="document-reader" ref={readerRef}>
      <div className="document-reader__utilities">
        <details>
          <summary>完整目录 · {descriptor.outline.length} 个主章节</summary>
          <DocumentOutline
            activeChunkId={activeChunk.chunkId}
            nodes={descriptor.outline}
            onActivate={activateChunk}
          />
        </details>
        <details>
          <summary>全文搜索</summary>
          <DocumentSearch documentId={descriptor.documentId} onActivate={activateSearchResult} />
        </details>
        <p>
          {descriptor.complexity.mode === "large" ? "大型材料 · 分节载入" : "材料已索引"}
          {" · "}{descriptor.lineCount.toLocaleString("zh-CN")} 行
        </p>
      </div>
      <div aria-hidden="true" className="document-window-spacer" style={{ height: topHeight }} />
      {loaded.map((chunk) => (
        <DocumentChunkView
          chunk={chunk}
          documentId={descriptor.documentId}
          highlighted={highlightedChunkId === chunk.chunkId}
          key={chunk.chunkId}
          onHeightChange={recordChunkHeight}
          resolveImageUrl={resolveImageUrl}
        />
      ))}
      <div aria-hidden="true" className="document-window-spacer" style={{ height: bottomHeight }} />
    </div>
  );
}
