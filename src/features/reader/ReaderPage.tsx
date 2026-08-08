import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { readReadingRestoreContext } from "../../app/navigation-return";
import { CARD_LABELS } from "../../../shared/card-labels";
import { invalidateAfterMutation } from "../../app/query-invalidation";
import { SaveReceipt } from "../../components/SaveReceipt";
import { StatusDot } from "../../components/StatusDot";
import {
  ContextualReturnControl,
  useNavigationReturnContext
} from "../../components/ContextualReturnControl";
import { ApiClientError } from "../../lib/api-client";
import {
  readExcerptBasketItems,
  type ExcerptBasketItem
} from "./excerpt-basket";
import { ReadingForm } from "./ReadingForm";
import { DocumentReader } from "./DocumentReader";
import { DocumentRelinkPanel } from "./DocumentRelinkPanel";
import { useDocumentDescriptor, useReadings } from "./reader-queries";
import {
  readReaderSelection,
  type ReaderCardType,
  type ReaderSelectionAnchor,
} from "./selection";
import { ReaderToolsDrawer } from "./ReaderToolsDrawer";
import { SelectionActions } from "./SelectionActions";
import { readGraphWorkTransfer } from "./reader-selection-transfer";
import { readReaderStateDraft, writeReaderStateDraft } from "./reader-draft-store";
import {
  readReadingScrollTop,
  useReaderScrollRestoration
} from "./reader-return";
import { readingImageUrl } from "./AuthenticatedReadingImage";
import {
  createReaderSelectionWorkspace,
  type ReaderTool
} from "./useReaderSelectionWorkspace";

export { AuthenticatedReadingImage, readingImageUrl } from "./AuthenticatedReadingImage";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const READER_CARD_TYPES: ReaderCardType[] = [
  "concept",
  "example",
  "boundary",
  "process",
  "mistake"
];

export function ReaderPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const inheritedReturnContext = useNavigationReturnContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const readerRef = useRef<HTMLElement | null>(null);
  const pendingReadingSelectionRef = useRef<string | null>(null);
  const materialsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const basketTriggerRef = useRef<HTMLButtonElement | null>(null);
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const readings = useReadings();
  const [readingRestore] = useState(() =>
    readReadingRestoreContext(location.state)
  );
  const graphWork = useMemo(
    () => readGraphWorkTransfer({ clearAfterRead: true }),
    []
  );
  const [selectedReadingId, setSelectedReadingId] = useState<string | null>(
    () =>
      readingRestore?.documentId ??
      readReaderStateDraft()?.selectedReadingId ??
      null
  );
  const [selectionAnchor, setSelectionAnchor] =
    useState<ReaderSelectionAnchor | null>(null);
  const [activeDocumentChunkId, setActiveDocumentChunkId] =
    useState<string | undefined>(
      () => readingRestore?.activeChunkId ?? readReaderStateDraft()?.activeChunkId
    );
  const [activeTool, setActiveTool] = useState<ReaderTool>(null);
  const [excerptBasket, setExcerptBasket] = useState<ExcerptBasketItem[]>(() =>
    readExcerptBasketItems()
  );
  const [lastReceipt, setLastReceipt] = useState<{
    at: string;
    path: string;
  } | null>(null);
  const selectedDocument = useDocumentDescriptor(selectedReadingId);
  const requestedReadingId = searchParams.get("reading");
  const autoOpenImportKey = searchParams.get("import");
  const selectReading = useCallback(
    (readingId: string) => {
      pendingReadingSelectionRef.current = readingId;
      setSelectedReadingId(readingId);
      setActiveDocumentChunkId(undefined);
      writeReaderStateDraft({
        selectedReadingId: readingId,
        scrollTop: 0,
        readingMode: "intensive"
      });
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("reading", readingId);
          return next;
        },
        { replace: true, state: location.state }
      );
    },
    [location.state, setSearchParams]
  );

  useEffect(() => {
    if (autoOpenImportKey !== null) {
      setActiveTool("import");
    }
  }, [autoOpenImportKey]);

  useEffect(() => {
    const readingList = readings.data?.readings ?? [];
    const requestedReading =
      requestedReadingId === null
        ? null
        : readingList.find((reading) => reading.id === requestedReadingId) ?? null;
    const pendingReading =
      pendingReadingSelectionRef.current === null
        ? null
        : readingList.find(
            (reading) => reading.id === pendingReadingSelectionRef.current
          ) ?? null;
    const conceptReading =
      graphWork === null
        ? null
        : readingList.find((reading) => reading.concept === graphWork.concept) ?? null;
    const restoredReading =
      selectedReadingId === null
        ? null
        : readingList.find((reading) => reading.id === selectedReadingId) ?? null;
    const firstReading =
      pendingReading ??
      requestedReading ??
      conceptReading ??
      restoredReading ??
      readingList[0] ??
      null;

    if (
      pendingReading !== null &&
      requestedReadingId === pendingReading.id
    ) {
      pendingReadingSelectionRef.current = null;
    }

    if (firstReading !== null && selectedReadingId !== firstReading.id) {
      selectReading(firstReading.id);
    } else if (firstReading !== null && requestedReadingId !== firstReading.id) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("reading", firstReading.id);
          return next;
        },
        { replace: true, state: location.state }
      );
    }
  }, [
    graphWork,
    readings.data,
    requestedReadingId,
    selectReading,
    selectedReadingId,
    location.state,
    setSearchParams
  ]);

  useReaderScrollRestoration({
    contentReady: selectedDocument.data !== undefined,
    readerRef,
    readingRestore,
    selectedReadingId
  });

  const captureSelection = useCallback(() => {
    if (readerRef.current === null || selectedDocument.data === undefined) {
      setSelectionAnchor(null);
      return;
    }

    setSelectionAnchor(readReaderSelection(readerRef.current));
  }, [selectedDocument.data]);

  const handleActiveChunkChange = useCallback((chunkId: string) => {
    setActiveDocumentChunkId(chunkId);
    const current = readReaderStateDraft();
    writeReaderStateDraft({
      selectedReadingId,
      scrollTop:
        current?.selectedReadingId === selectedReadingId
          ? current.scrollTop
          : readReadingScrollTop(readerRef.current),
      readingMode: "intensive",
      activeChunkId: chunkId,
      ...(current?.selectedReadingId === selectedReadingId &&
      current.sectionAnchor !== undefined
        ? { sectionAnchor: current.sectionAnchor }
        : {}),
      ...(current?.selectedReadingId === selectedReadingId &&
      current.focusExcerpt !== undefined
        ? { focusExcerpt: current.focusExcerpt }
        : {})
    });
  }, [selectedReadingId]);

  const handleCreated = useCallback(
    async (response: {
      reading: { id: string };
      saveReceipt: { modifiedAt: string; relativePath: string };
    }) => {
      setLastReceipt({
        at: response.saveReceipt.modifiedAt,
        path: response.saveReceipt.relativePath
      });
      setActiveTool(null);
      selectReading(response.reading.id);
      await invalidateAfterMutation(queryClient, "reading-saved");
    },
    [queryClient, selectReading]
  );

  const readingList = readings.data?.readings ?? [];
  const {
    activateBasketCard,
    activateBasketDiagnosis,
    addSelectionToBasket,
    clearBasket,
    transferSelection
  } = createReaderSelectionWorkspace({
    activeDocumentChunkId,
    inheritedReturnContext,
    navigate,
    readerRef,
    readings: readingList,
    selectedReadingId,
    selectionAnchor,
    setActiveTool,
    setExcerptBasket,
    setSelectionAnchor
  });
  const activeReading =
    readingList.find((reading) => reading.id === selectedReadingId) ?? null;
  const resolveActiveReadingImage = useCallback(
    (source: string) =>
      activeReading === null
        ? source
        : readingImageUrl(activeReading.id, source),
    [activeReading]
  );
  const isStartOnlyReader = readings.isPending || readingList.length === 0;
  const readingsError = readings.isError
    ? errorMessage(readings.error, "读取阅读材料失败")
    : null;
  const selectedReadingError = selectedDocument.isError
    ? errorMessage(selectedDocument.error, "打开阅读材料失败")
    : null;
  const sourceUnavailable =
    selectedDocument.error instanceof ApiClientError &&
    selectedDocument.error.code === "DOCUMENT_SOURCE_UNAVAILABLE";

  const closeTools = useCallback(() => setActiveTool(null), []);
  const clearAutoImportRequest = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("import");
    setSearchParams(next, { replace: true, state: location.state });
  }, [location.state, searchParams, setSearchParams]);

  return (
    <section className="route-stage reader-page" aria-labelledby="reader-title">
      <ContextualReturnControl />
      <p className="eyebrow">Reader</p>
      <h1 id="reader-title">精读工作台</h1>
      <p className="route-stage__summary">
        先把关键句放进摘录篮，再把摘录整理成卡片或卡点诊断。
      </p>
      {graphWork === null ? null : (
        <section
          aria-label="飞轮工作上下文"
          className="surface-static reader-graph-work"
        >
          <StatusDot label="来自主题飞轮的下一步" tone="active" />
          <p>
            围绕「{graphWork.concept}」补一张
            {CARD_LABELS[graphWork.cardType].label}。请在正文中选中能支撑这一步的原文，
            再选择“创建卡片”。
          </p>
        </section>
      )}
      <div aria-label="Reader 工具" className="reader-tools-triggerbar" role="toolbar">
        <button
          className="button button-ghost"
          onClick={() => setActiveTool("materials")}
          ref={materialsTriggerRef}
          type="button"
        >
          材料
        </button>
        <button
          className="button button-ghost"
          onClick={() => setActiveTool("basket")}
          ref={basketTriggerRef}
          type="button"
        >
          摘录篮 · {excerptBasket.length}
        </button>
        <button
          className="button"
          onClick={() => setActiveTool("import")}
          ref={importTriggerRef}
          type="button"
        >
          + 新材料
        </button>
      </div>
      {lastReceipt === null ? null : (
        <div className="reader-inline-receipt">
          <SaveReceipt
            at={lastReceipt.at}
            label="最近保存"
            path={lastReceipt.path}
          />
        </div>
      )}
      {readingsError === null ? null : (
        <p className="settings-error" role="alert">
          {readingsError}
        </p>
      )}
      <div className="reader-layout">
        <article
          className="reader-surface reader-paper reader-paper--reading-first"
          data-testid="reader-surface"
          onKeyUp={captureSelection}
          onMouseUp={captureSelection}
          ref={readerRef}
          tabIndex={-1}
        >
          {readings.isPending ? (
            <p>正在读取阅读材料。</p>
          ) : isStartOnlyReader ? (
            <div className="today-empty">
              <StatusDot label="等待第一篇阅读材料" />
              <p>用“+ 新材料”导入或粘贴一篇材料，然后从正文开始摘录。</p>
            </div>
          ) : selectedDocument.isPending && selectedReadingId !== null ? (
            <p>正在打开阅读材料。</p>
          ) : selectedReadingError !== null ? (
            sourceUnavailable ? (
              <DocumentRelinkPanel
                documentId={selectedReadingId!}
                message={selectedReadingError}
              />
            ) : (
              <p className="settings-error" role="alert">
                {selectedReadingError}
              </p>
            )
          ) : activeReading === null ? (
            <div className="today-empty">
              <StatusDot label="等待第一篇阅读材料" />
              <p>先创建第一篇阅读材料，再从摘录生成第一张概念卡。</p>
            </div>
          ) : (
            <>
              <StatusDot label="阅读材料 · 当前打开" tone="active" />
              {selectedDocument.data === undefined ? null : (
                <DocumentReader
                  descriptor={selectedDocument.data.document}
                  initialChunkId={
                    readingRestore?.documentId === selectedReadingId
                      ? readingRestore.activeChunkId
                      : activeDocumentChunkId
                  }
                  onActiveChunkChange={handleActiveChunkChange}
                  resolveImageUrl={resolveActiveReadingImage}
                />
              )}
            </>
          )}
        </article>
      </div>

      {activeTool === "materials" ? (
        <ReaderToolsDrawer
          label="材料"
          onClose={closeTools}
          returnFocusRef={materialsTriggerRef}
        >
          <section aria-label="阅读材料列表" className="reader-list surface-static">
            <StatusDot label="本地学习库阅读材料" tone="active" />
            {readingList.length === 0 ? (
              <p>还没有阅读材料。关闭此面板后选择“+ 新材料”。</p>
            ) : (
              <ul>
                {readingList.map((reading) => (
                  <li key={reading.id}>
                    <button
                      className={`reading-row${
                        reading.id === selectedReadingId ? " is-selected" : ""
                      }`}
                      onClick={() => {
                        selectReading(reading.id);
                        setSelectionAnchor(null);
                        closeTools();
                      }}
                      type="button"
                    >
                      <strong>{reading.title}</strong>
                      <span>{reading.concept}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </ReaderToolsDrawer>
      ) : null}

      {activeTool === "basket" ? (
        <ReaderToolsDrawer
          label="摘录篮"
          onClose={closeTools}
          returnFocusRef={basketTriggerRef}
        >
          <section aria-label="摘录篮" className="reader-basket surface-static" role="region">
            <StatusDot label="临时摘录篮" tone="active" />
            <p>
              这里的摘录会安全保存在本机。做成卡片或卡点后，摘录会从篮中移除。
            </p>
            {excerptBasket.length === 0 ? (
              <p>在正文中拖选一句话后，可以摘录、创建卡片或记录困难。</p>
            ) : (
              <>
                <button
                  className="button button-ghost"
                  onClick={clearBasket}
                  type="button"
                >
                  清空摘录篮
                </button>
                <ol>
                  {excerptBasket.map((item) => (
                    <li className="excerpt-basket-item" key={item.id}>
                      <blockquote>{item.excerptText}</blockquote>
                      <p>{item.sourcePath}</p>
                      <div className="excerpt-basket-actions">
                        {READER_CARD_TYPES.map((cardType) => (
                          <button
                            className="button"
                            key={cardType}
                            onClick={() => activateBasketCard(item, cardType)}
                            type="button"
                          >
                            转成{CARD_LABELS[cardType].label}
                          </button>
                        ))}
                        <button
                          className="button"
                          onClick={() => activateBasketDiagnosis(item)}
                          type="button"
                        >
                          转成卡点
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </ReaderToolsDrawer>
      ) : null}

      {activeTool === "import" ? (
        <ReaderToolsDrawer
          label="新材料"
          onClose={closeTools}
          returnFocusRef={importTriggerRef}
        >
          <ReadingForm
            autoOpenImportKey={autoOpenImportKey}
            existingReadings={readingList}
            onAutoImportHandled={clearAutoImportRequest}
            onCreated={handleCreated}
          />
        </ReaderToolsDrawer>
      ) : null}

      {selectionAnchor === null ? null : (
        <SelectionActions
          anchor={selectionAnchor}
          onCard={(cardType) => transferSelection("cards", cardType)}
          onClose={() => setSelectionAnchor(null)}
          onDifficulty={() => transferSelection("diagnosis")}
          onExcerpt={addSelectionToBasket}
          returnFocus={() => readerRef.current?.focus()}
        />
      )}
    </section>
  );
}
