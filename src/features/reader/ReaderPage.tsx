import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CARD_LABELS } from "../../../shared/card-labels";
import { SaveReceipt } from "../../components/SaveReceipt";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import { confirmDiscardUnsavedChanges } from "../../lib/unsaved-guard";
import {
  createExcerptBasketItem,
  readExcerptBasketItems,
  writeExcerptBasketItems,
  type ExcerptBasketItem
} from "./excerpt-basket";
import { ReadingForm } from "./ReadingForm";
import {
  readReaderSelection,
  type ReaderCardType,
  type ReaderSelectionAnchor,
  type ReaderSelectionPayload
} from "./selection";
import { ReaderToolsDrawer } from "./ReaderToolsDrawer";
import { SelectionActions } from "./SelectionActions";
import {
  readGraphWorkTransfer,
  writeReaderSelectionPayload
} from "./reader-selection-transfer";

const MarkdownRenderer = lazy(() =>
  import("../../markdown/MarkdownRenderer").then((module) => ({
    default: module.MarkdownRenderer
  }))
);

type ReadingListEntry = {
  id: string;
  type: "reading";
  title: string;
  concept: string;
  relativePath: string;
  updatedAt: string;
};

type ReadingRawEntry = ReadingListEntry & {
  rawMarkdown: string;
};

type ReadingListResponse = {
  readings: ReadingListEntry[];
};

type ReadingDetailResponse = {
  reading: ReadingRawEntry;
};

function readingImageUrl(readingId: string, source: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/iu.test(source)) {
    return source;
  }

  return `/api/readings/${encodeURIComponent(readingId)}/media?path=${encodeURIComponent(source)}`;
}

function useReadings() {
  return useQuery({
    queryKey: ["readings"],
    queryFn: () => apiClient.get<ReadingListResponse>("/api/readings")
  });
}

function useReadingDetail(id: string | null) {
  return useQuery({
    queryKey: ["reading", id],
    queryFn: () => apiClient.get<ReadingDetailResponse>(`/api/readings/${id}`),
    enabled: id !== null
  });
}

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

type ReaderTool = "materials" | "basket" | "import" | null;

export function ReaderPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const readerRef = useRef<HTMLElement | null>(null);
  const materialsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const basketTriggerRef = useRef<HTMLButtonElement | null>(null);
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const readings = useReadings();
  const graphWork = useMemo(
    () => readGraphWorkTransfer({ clearAfterRead: true }),
    []
  );
  const [selectedReadingId, setSelectedReadingId] = useState<string | null>(null);
  const [selectionAnchor, setSelectionAnchor] =
    useState<ReaderSelectionAnchor | null>(null);
  const [activeTool, setActiveTool] = useState<ReaderTool>(null);
  const [excerptBasket, setExcerptBasket] = useState<ExcerptBasketItem[]>(() =>
    readExcerptBasketItems()
  );
  const [lastReceipt, setLastReceipt] = useState<{
    at: string;
    path: string;
  } | null>(null);
  const selectedReading = useReadingDetail(selectedReadingId);
  const requestedReadingId = searchParams.get("reading");
  const autoOpenImportKey = searchParams.get("import");

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
    const conceptReading =
      graphWork === null
        ? null
        : readingList.find((reading) => reading.concept === graphWork.concept) ?? null;
    const firstReading = requestedReading ?? conceptReading ?? readingList[0] ?? null;

    if (selectedReadingId === null && firstReading !== null) {
      setSelectedReadingId(firstReading.id);
    }
  }, [graphWork, readings.data, requestedReadingId, selectedReadingId]);

  const captureSelection = useCallback(() => {
    if (readerRef.current === null || selectedReading.data === undefined) {
      setSelectionAnchor(null);
      return;
    }

    setSelectionAnchor(readReaderSelection(readerRef.current));
  }, [selectedReading.data]);

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
      setSelectedReadingId(response.reading.id);
      await queryClient.invalidateQueries({ queryKey: ["readings"] });
    },
    [queryClient]
  );

  function storeSelectionPayload(payload: ReaderSelectionPayload) {
    writeReaderSelectionPayload(payload);
    navigate(payload.target === "cards" ? "/cards" : "/diagnosis", {
      state: {
        readerSelection: payload
      }
    });
  }

  function updateExcerptBasket(
    updater: (items: ExcerptBasketItem[]) => ExcerptBasketItem[]
  ) {
    setExcerptBasket((items) => {
      const next = updater(items);
      writeExcerptBasketItems(next);
      return next;
    });
  }

  function payloadFromBasketItem(
    item: ExcerptBasketItem,
    target: "cards",
    cardType: ReaderCardType
  ): ReaderSelectionPayload;
  function payloadFromBasketItem(
    item: ExcerptBasketItem,
    target: "diagnosis"
  ): ReaderSelectionPayload;
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

  const addSelectionToBasket = () => {
    const reading = selectedReading.data?.reading;

    if (reading === undefined || selectionAnchor === null) {
      return;
    }

    updateExcerptBasket((items) => [
      createExcerptBasketItem({
        sourceReadingId: reading.id,
        sourcePath: reading.relativePath,
        concept: reading.concept,
        excerptText: selectionAnchor.excerpt
      }),
      ...items
    ]);
    setSelectionAnchor(null);
    setActiveTool("basket");
    window.getSelection()?.removeAllRanges();
  };

  const transferSelection = (
    target: "cards" | "diagnosis",
    cardType?: ReaderCardType
  ) => {
    const reading = selectedReading.data?.reading;
    if (reading === undefined || selectionAnchor === null) {
      return;
    }

    if (!confirmDiscardUnsavedChanges()) {
      return;
    }

    const payload: ReaderSelectionPayload = {
      source: "reader-selection",
      target,
      sourceReadingId: reading.id,
      sourcePath: reading.relativePath,
      concept: reading.concept,
      excerpt: selectionAnchor.excerpt,
      ...(target === "cards" && cardType !== undefined ? { cardType } : {})
    };

    storeSelectionPayload(payload);
    setSelectionAnchor(null);
  };

  const activateBasketCard = (
    item: ExcerptBasketItem,
    cardType: ReaderCardType
  ) => {
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }

    updateExcerptBasket((items) => items.filter((entry) => entry.id !== item.id));
    storeSelectionPayload(payloadFromBasketItem(item, "cards", cardType));
  };

  const activateBasketDiagnosis = (item: ExcerptBasketItem) => {
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }

    updateExcerptBasket((items) => items.filter((entry) => entry.id !== item.id));
    storeSelectionPayload(payloadFromBasketItem(item, "diagnosis"));
  };

  const readingList = readings.data?.readings ?? [];
  const activeReading = selectedReading.data?.reading ?? null;
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
  const selectedReadingError = selectedReading.isError
    ? errorMessage(selectedReading.error, "打开阅读材料失败")
    : null;
  const closeTools = useCallback(() => setActiveTool(null), []);
  const clearAutoImportRequest = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("import");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <section className="route-stage reader-page" aria-labelledby="reader-title">
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
          ) : selectedReading.isPending && selectedReadingId !== null ? (
            <p>正在打开阅读材料。</p>
          ) : selectedReadingError !== null ? (
            <p className="settings-error" role="alert">
              {selectedReadingError}
            </p>
          ) : activeReading === null ? (
            <div className="today-empty">
              <StatusDot label="等待第一篇阅读材料" />
              <p>先创建第一篇阅读材料，再从摘录生成第一张定义卡。</p>
            </div>
          ) : (
            <>
              <StatusDot label="阅读材料 · 当前打开" tone="active" />
              <Suspense fallback={<p>正在排版阅读材料…</p>}>
                <MarkdownRenderer
                  resolveImageUrl={resolveActiveReadingImage}
                  source={activeReading.rawMarkdown}
                />
              </Suspense>
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
                        setSelectedReadingId(reading.id);
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
              这里的摘录会暂存在当前浏览器会话中。需要长期保存时，请将它做成卡片。
            </p>
            {excerptBasket.length === 0 ? (
              <p>在正文中拖选一句话后，可以摘录、创建卡片或记录困难。</p>
            ) : (
              <>
                <button
                  className="button button-ghost"
                  onClick={() => updateExcerptBasket(() => [])}
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
