import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invalidateAfterMutation } from "../../app/query-invalidation";
import { queryKeys } from "../../app/query-keys";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import {
  allowNextNavigationAfterCommit,
  confirmDiscardForNavigation,
  useUnsavedChanges
} from "../../lib/unsaved-guard";
import { CARD_LABELS } from "../../../shared/card-labels";
import {
  cardDraftToCreateRequest,
  cardDraftToUpdateRequest,
  createCardDraftFromReaderSelection,
  createEmptyCardDraft,
  type CardDraft,
  type CardType,
  type EditableCardMastery
} from "./card-draft";
import { CardEditor } from "./CardEditor";
import { cardSaveState } from "./card-save-state";
import {
  clearCardDraft,
  readCardDraft,
  writeCardDraft
} from "./card-draft-store";
import {
  readReaderSelectionPayload,
  type ReaderSelectionPayload
} from "../reader/reader-selection-transfer";

type CardSaveResponse = {
  card: {
    concept: string;
    id: string;
    mastery: EditableCardMastery;
    modifiedAt: string;
    nextReview: string;
    relativePath: string;
    title: string;
    type: string;
  };
  saveReceipt: {
    absolutePath: string;
    modifiedAt: string;
    relativePath: string;
  };
};

type RecentCard = {
  id: string;
  modifiedAt: string;
  preview: {
    concept: string;
    content: string;
    sourceReading: string;
  };
  relativePath: string;
  title: string;
  type: string;
  typeLabel: string;
};

type RecentCardsResponse = {
  cards: RecentCard[];
};

type CardDetailPreview = {
  id: string;
  concept: string;
  content: string;
  modifiedAt: string;
  relativePath: string;
  sourceReading: string;
  title: string;
  typeLabel: string;
};

type KnowledgeProjection = {
  cardId: string;
  trustState: "unverified" | "supported" | "independently-supported" | "under-review";
  activeEvidenceIds: string[];
  affectedEvidenceIds: string[];
  prerequisites: Array<{ cardId: string; evidenceId: string; relationType: string }>;
  usedBy: Array<{ cardId: string; evidenceId: string; relationType: string }>;
  revocationImpacts: Array<{ rootEvidenceId: string; reason: string; path: string[] }>;
};

const TRUST_LABELS: Record<KnowledgeProjection["trustState"], string> = {
  unverified: "尚无已接受证据",
  supported: "已有辅助证据支持",
  "independently-supported": "已有独立证据支持",
  "under-review": "受撤销影响，等待复核"
};

const DETAIL_CONTENT_KEYS = [
  "myUnderstanding",
  "formalDefinition",
  "formalExplanation",
  "plainExplanation",
  "exampleContent",
  "counterexampleContent",
  "proofOutline",
  "steps",
  "mistake",
  "excerpt"
] as const;

type DetailContentKey = (typeof DETAIL_CONTENT_KEYS)[number];
type DetailContentSource = Partial<
  Record<DetailContentKey | "title", unknown>
>;

function useRecentCards() {
  return useQuery({
    queryKey: queryKeys.cards.recent,
    queryFn: () => apiClient.get<RecentCardsResponse>("/api/cards/recent?limit=10")
  });
}

function readCardSelection(): (ReaderSelectionPayload & { cardType: CardType }) | null {
  const payload = readReaderSelectionPayload({ clearAfterRead: true });
  return payload?.target === "cards" && payload.cardType !== undefined
    ? (payload as ReaderSelectionPayload & { cardType: CardType })
    : null;
}

function createInitialStudioState(
  selection: (ReaderSelectionPayload & { cardType: CardType }) | null
) {
  const recoveredDraft = selection === null ? readCardDraft() : null;
  const draft = selection !== null
    ? createCardDraftFromReaderSelection(selection)
    : recoveredDraft ?? createEmptyCardDraft("concept");

  return {
    cleanSnapshot: JSON.stringify(draft),
    draft,
    recovered: recoveredDraft !== null
  };
}

export function CardStudioPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const requestedCardId = searchParams.get("cardId")?.trim() ?? "";
  const selection = useMemo(() => readCardSelection(), []);
  const recentCards = useRecentCards();
  const [studioState, setStudioState] = useState(() =>
    createInitialStudioState(selection)
  );
  const [selectedCard, setSelectedCard] = useState<CardDetailPreview | null>(null);
  const [savedCard, setSavedCard] = useState<CardDetailPreview | null>(null);
  const [savedMastery, setSavedMastery] = useState<EditableCardMastery | null>(null);
  const [savedNextReview, setSavedNextReview] = useState<string | null>(null);
  const [showReviewPreview, setShowReviewPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CardSaveResponse["saveReceipt"] | null>(
    null
  );
  const knowledge = useQuery({
    queryKey: queryKeys.verification.knowledge(selectedCard?.id ?? ""),
    queryFn: () => {
      if (selectedCard === null) throw new Error("尚未选择卡片");
      return apiClient.get<{ knowledge: KnowledgeProjection }>(
        `/api/verification/knowledge/${selectedCard.id}`
      );
    },
    enabled: selectedCard !== null
  });
  const draftSnapshot = JSON.stringify(studioState.draft);
  const dirty = draftSnapshot !== studioState.cleanSnapshot;
  const saveState = cardSaveState({ dirty, error, receipt, saving });
  useUnsavedChanges(dirty);

  useEffect(() => {
    if (dirty) {
      writeCardDraft(studioState.draft);
    }
  }, [dirty, draftSnapshot, studioState.draft]);

  useEffect(() => {
    if (
      requestedCardId === "" ||
      dirty ||
      selectedCard?.id === requestedCardId ||
      recentCards.data === undefined
    ) {
      return;
    }
    const requestedCard = recentCards.data.cards.find(
      (card) => card.id === requestedCardId
    );
    if (requestedCard !== undefined) {
      void viewRecentCard(requestedCard);
    }
  }, [dirty, recentCards.data, requestedCardId, selectedCard?.id]);

  const writeCardIdToUrl = (cardId: string | null) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (cardId === null) {
          next.delete("cardId");
        } else {
          next.set("cardId", cardId);
        }
        return next;
      },
      { replace: true }
    );
  };

  useEffect(() => {
    if (
      !dirty &&
      savedCard !== null &&
      requestedCardId !== savedCard.id
    ) {
      writeCardIdToUrl(savedCard.id);
    }
  }, [dirty, requestedCardId, savedCard]);

  const setDraft = (draft: CardDraft) => {
    setError(null);
    setShowReviewPreview(false);
    setStudioState((state) => ({ ...state, draft }));
  };

  async function saveCard() {
    setSaving(true);
    setError(null);
    const draftBeingSaved = studioState.draft;

    try {
      const result =
        savedCard === null
          ? await apiClient.post<CardSaveResponse>(
              "/api/cards",
              cardDraftToCreateRequest(draftBeingSaved)
            )
          : await apiClient.put<CardSaveResponse>(
              `/api/cards/${savedCard.id}`,
              cardDraftToUpdateRequest(
                draftBeingSaved,
                savedMastery ?? "learning"
              )
            );
      setReceipt(result.saveReceipt);
      setSavedMastery(result.card.mastery);
      setSavedNextReview(result.card.nextReview);
      setSavedCard(detailFromDraft(draftBeingSaved, result.saveReceipt, result.card.id));
      setStudioState((state) => ({
        ...state,
        cleanSnapshot: JSON.stringify(draftBeingSaved),
        recovered: false
      }));
      clearCardDraft();
      allowNextNavigationAfterCommit();
      await invalidateAfterMutation(queryClient, "card-saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存卡片失败");
    } finally {
      setSaving(false);
    }
  }

  const startNextCard = () => {
    const draft = createEmptyCardDraft("concept");
    clearCardDraft();
    writeCardIdToUrl(null);
    setReceipt(null);
    setSelectedCard(null);
    setSavedCard(null);
    setSavedMastery(null);
    setSavedNextReview(null);
    setShowReviewPreview(false);
    setStudioState({
      cleanSnapshot: JSON.stringify(draft),
      draft,
      recovered: false
    });
  };

  const viewSavedCard = () => {
    if (savedCard !== null) {
      setSelectedCard(savedCard);
      writeCardIdToUrl(savedCard.id);
    }
  };

  const viewRecentCard = async (card: RecentCard) => {
    if (dirty && !confirmDiscardForNavigation()) {
      return;
    }
    try {
      const detail = await apiClient.get<{ card: Record<string, unknown> }>(
        `/api/cards/${card.id}`
      );
      setSelectedCard(detailFromApiCard(detail.card, card));
      writeCardIdToUrl(card.id);
    } catch {
      setSelectedCard(detailFromRecentCard(card));
      writeCardIdToUrl(card.id);
    }
  };

  const hasEditableSource = studioState.draft.sourceReadingId.trim().length > 0;
  const relatedCardTitle = (cardId: string) =>
    recentCards.data?.cards.find((card) => card.id === cardId)?.title ??
    "相关卡片";
  const isSavedCardDue =
    savedNextReview !== null &&
    savedNextReview <= new Date().toISOString().slice(0, 10);

  return (
    <section className="route-stage card-studio-page" aria-labelledby="cards-title">
      <p className="eyebrow">Card Studio</p>
      <h1 id="cards-title">卡片工作台</h1>
      <p className="route-stage__summary">
        沿着原文、重述、卡型字段与下一步，把一次真实阅读沉淀为可复习的卡片。
      </p>
      {selection === null ? (
        <div className="surface-static route-stage__card">
          <StatusDot
            label={studioState.recovered ? "已恢复本地草稿" : "等待 Reader 选区"}
            tone={studioState.recovered ? "active" : "blocked"}
          />
          <p>
            {studioState.recovered
              ? "上次未保存的卡片草稿已从本机恢复，可以继续编辑。"
              : "从精读工作台选中一段原文，或从摘录篮选择要生成的卡片类型。"}
          </p>
        </div>
      ) : null}
      {error === null ? null : (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {hasEditableSource ? (
        <CardEditor
          draft={studioState.draft}
          onChange={setDraft}
          onSave={saveCard}
          receipt={receipt}
          saveState={saveState}
        />
      ) : null}
      {receipt === null ? null : (
        <section className="surface-static card-save-next-actions" aria-label="保存后的下一步">
          <StatusDot label={`已保存为「${receipt.relativePath}」`} tone="active" />
          <div className="form-actions">
            <button className="button" onClick={viewSavedCard} type="button">
              查看这张卡片
            </button>
            <button className="button button-ghost" onClick={startNextCard} type="button">
              新建下一张
            </button>
            {isSavedCardDue && savedCard !== null ? (
              <button
                className="button button-ghost"
                onClick={() => navigate(`/review?cardId=${encodeURIComponent(savedCard.id)}`)}
                type="button"
              >
                开始今日复习
              </button>
            ) : null}
          </div>
          {savedNextReview === null || isSavedCardDue ? null : (
            <div className="card-review-next">
              <p>
                下次复习：<time dateTime={savedNextReview}>{savedNextReview}</time>
              </p>
              <button
                className="button button-ghost"
                onClick={() => setShowReviewPreview(true)}
                type="button"
              >
                预览复习格式
              </button>
            </div>
          )}
        </section>
      )}
      {showReviewPreview && savedCard !== null ? (
        <section
          aria-label="卡片复习预览"
          className="surface-static card-review-preview"
          role="region"
        >
          <StatusDot label="复习预览，不会写入复习记录" tone="idle" />
          <h2>闭卷解释：{savedCard.concept}</h2>
          <p>先不看原文，用自己的话说明这张卡片的核心判断，再核对参考内容。</p>
          <details>
            <summary>揭示参考内容</summary>
            <p>{savedCard.content}</p>
          </details>
          <button
            className="button button-ghost"
            onClick={() => setShowReviewPreview(false)}
            type="button"
          >
            关闭预览
          </button>
        </section>
      ) : null}
      <section className="surface-static recent-cards" aria-label="最近卡片" role="region">
        <StatusDot label="最近卡片" tone="active" />
        {recentCards.isPending ? (
          <p>正在读取最近卡片。</p>
        ) : recentCards.isError ? (
          <p className="settings-error" role="alert">
            {recentCards.error instanceof Error ? recentCards.error.message : "读取最近卡片失败"}
          </p>
        ) : recentCards.data.cards.length === 0 ? (
          <p>还没有卡片。可以从 Reader 摘录，或保存当前草稿。</p>
        ) : (
          <ul className="recent-cards__list">
            {recentCards.data.cards.map((card) => (
              <li key={card.id}>
                <button
                  aria-label={`查看 ${card.title}`}
                  className="surface-interactive recent-card-row"
                  onClick={() => void viewRecentCard(card)}
                  type="button"
                >
                  <strong>{card.title}</strong>
                  <span>{card.typeLabel}</span>
                  <span>{card.relativePath}</span>
                  <time dateTime={card.modifiedAt}>{card.modifiedAt}</time>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {selectedCard === null ? null : (
        <section className="surface-static card-preview" aria-label="卡片预览" role="region">
          <StatusDot label="卡片预览" tone="active" />
          <h2>{selectedCard.title}</h2>
          <dl className="draft-meta">
            <div>
              <dt>类型</dt>
              <dd>{selectedCard.typeLabel}</dd>
            </div>
            <div>
              <dt>概念</dt>
              <dd>{selectedCard.concept}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{selectedCard.sourceReading}</dd>
            </div>
            <div>
              <dt>位置</dt>
              <dd>{selectedCard.relativePath}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{selectedCard.modifiedAt}</dd>
            </div>
          </dl>
          <p>{selectedCard.content}</p>
          {knowledge.isPending ? <p>正在读取证据信任状态…</p> : null}
          {knowledge.data === undefined ? null : (
            <details className="card-knowledge-panel" aria-label="证据信任与关系">
              <summary>
                <StatusDot
                  label={TRUST_LABELS[knowledge.data.knowledge.trustState]}
                  tone={knowledge.data.knowledge.trustState === "under-review" ? "blocked" : "active"}
                />
                <span>查看证据关系</span>
              </summary>
              <p>有效证据 {knowledge.data.knowledge.activeEvidenceIds.length} 条 · 受影响证据 {knowledge.data.knowledge.affectedEvidenceIds.length} 条。信任状态不会改变掌握度或复习日期。</p>
              {knowledge.data.knowledge.prerequisites.length > 0 ? (
                <p><strong>前置：</strong>{knowledge.data.knowledge.prerequisites.map((edge) => `${edge.relationType} · ${relatedCardTitle(edge.cardId)}`).join("；")}</p>
              ) : null}
              {knowledge.data.knowledge.usedBy.length > 0 ? (
                <p><strong>被使用：</strong>{knowledge.data.knowledge.usedBy.map((edge) => `${edge.relationType} · ${relatedCardTitle(edge.cardId)}`).join("；")}</p>
              ) : null}
              {knowledge.data.knowledge.revocationImpacts.map((impact) => (
                <p key={impact.rootEvidenceId}><strong>待复核原因：</strong>{impact.reason}</p>
              ))}
            </details>
          )}
          <div className="form-actions">
            <button className="button" onClick={() => navigate(`/verification?cardId=${encodeURIComponent(selectedCard.id)}`)} type="button">
              为这张卡片提交或查看证据
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

function detailContent(card: DetailContentSource): string {
  for (const key of DETAIL_CONTENT_KEYS) {
    const value = card[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return typeof card.title === "string" ? card.title : "";
}

function detailFromApiCard(
  card: Record<string, unknown>,
  fallback: RecentCard
): CardDetailPreview {
  const type = typeof card.type === "string" && card.type in CARD_LABELS
    ? (card.type as CardType)
    : (fallback.type as CardType);

  return {
    id: typeof card.id === "string" ? card.id : fallback.id,
    concept:
      typeof card.concept === "string" ? card.concept : fallback.preview.concept,
    content: detailContent(card) || fallback.preview.content,
    modifiedAt:
      typeof card.modifiedAt === "string" ? card.modifiedAt : fallback.modifiedAt,
    relativePath:
      typeof card.relativePath === "string" ? card.relativePath : fallback.relativePath,
    sourceReading:
      typeof card.sourceReading === "string"
        ? card.sourceReading
        : fallback.preview.sourceReading,
    title: typeof card.title === "string" ? card.title : fallback.title,
    typeLabel: CARD_LABELS[type].label
  };
}

function detailFromRecentCard(card: RecentCard): CardDetailPreview {
  return {
    id: card.id,
    concept: card.preview.concept,
    content: card.preview.content,
    modifiedAt: card.modifiedAt,
    relativePath: card.relativePath,
    sourceReading: card.preview.sourceReading,
    title: card.title,
    typeLabel: card.typeLabel
  };
}

function detailFromDraft(
  draft: CardDraft,
  receipt: CardSaveResponse["saveReceipt"],
  id: string
): CardDetailPreview {
  return {
    id,
    concept: draft.concept,
    content: detailContent(draft),
    modifiedAt: receipt.modifiedAt,
    relativePath: receipt.relativePath,
    sourceReading: draft.sourcePath,
    title: draft.title,
    typeLabel: CARD_LABELS[draft.type].label
  };
}
