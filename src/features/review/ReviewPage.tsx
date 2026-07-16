import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAfterMutation } from "../../app/query-invalidation";
import { queryKeys } from "../../app/query-keys";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import { useUnsavedChanges } from "../../lib/unsaved-guard";
import type { BlockType } from "../cards/card-draft";
import { CARD_LABELS } from "../../../shared/card-labels";
import {
  isCardType,
  isPrimaryCardType,
  PRIMARY_CARD_TYPES,
  type PrimaryCardType
} from "../../../shared/card-types";
import {
  clearReviewDraft,
  readReviewDraft,
  writeReviewDraft,
  type ReviewDraftCardContent
} from "./review-draft-store";

type ReviewFeedback = "forgot" | "fuzzy" | "known" | "fluent";
type ReviewAssistanceLevel = "none" | "hint" | "source" | "ai";
type ReviewConfidence = 1 | 2 | 3 | 4;
type ReviewUiState =
  | "answering"
  | "saving-attempt"
  | "revealed"
  | "saving-result"
  | "saved";

type ReviewCardContent = ReviewDraftCardContent;

type ReviewQueueItem = {
  cardId: string;
  cardPath: string;
  cardType: string;
  concept: string;
  mastery: string;
  nextReview: string;
  lastReviewSequence: number | null;
  lastReviewed: string | null;
  due: boolean;
  prompt: string;
};

type ReviewQueueDocument = {
  generatedAt: string;
  items: ReviewQueueItem[];
};

type ReviewAttemptResponse = {
  attemptId: string;
  attemptedAt: string;
  promptVersion: "recall-v1";
  replayed: boolean;
  revealedCard: ReviewCardContent;
};

type ReviewAttemptRequest = {
  idempotencyKey: string;
  answer: string;
  declaredDontKnow: boolean;
  confidenceBeforeReveal: ReviewConfidence;
  durationMs: number;
  assistanceLevel: ReviewAssistanceLevel;
};

type ReviewResultRequest = {
  attemptId: string;
  feedback: ReviewFeedback;
  blockType: BlockType | null;
  selfCorrection: string;
  diagnosisDraft: {
    assumedProblem: string;
    causeHypothesis: string;
    nextMinimumAction: string;
    targetCardType: PrimaryCardType;
  } | null;
};

type ReviewSubmitResponse = {
  result: {
    nextReview: string;
    nextMastery: string;
  };
};

const REVIEW_DIAGNOSIS_DRAFT_STORAGE_KEY = "aleksi.reviewDiagnosisDraft";

const CONFIDENCE_OPTIONS: Array<{
  label: string;
  value: ReviewConfidence;
}> = [
  { value: 1, label: "1 · 只是猜测" },
  { value: 2, label: "2 · 不太确定" },
  { value: 3, label: "3 · 比较有把握" },
  { value: 4, label: "4 · 很有把握" }
];

const ASSISTANCE_OPTIONS: Array<{
  label: string;
  value: ReviewAssistanceLevel;
}> = [
  { value: "none", label: "无辅助" },
  { value: "hint", label: "看过提示" },
  { value: "source", label: "查看过原文" },
  { value: "ai", label: "使用过 AI" }
];

const FEEDBACKS: Array<{ label: string; value: ReviewFeedback }> = [
  { value: "forgot", label: "忘了" },
  { value: "fuzzy", label: "模糊" },
  { value: "known", label: "会了" },
  { value: "fluent", label: "很熟" }
];

const BLOCK_TYPES: Array<{ label: string; value: BlockType }> = [
  { value: "definition", label: "定义" },
  { value: "example", label: "例子" },
  { value: "counterexample", label: "反例" },
  { value: "proof-search", label: "证明搜索" },
  { value: "technical", label: "技术" },
  { value: "expression", label: "表达" },
  { value: "transfer", label: "迁移" },
  { value: "emotion", label: "情绪" }
];

const COMMON_ANSWER_FIELDS: Array<{ key: string; label: string }> = [
  { key: "title", label: "卡片标题" },
  { key: "excerpt", label: "原文片段" },
  { key: "understanding", label: "我的理解" },
  { key: "relatedConcepts", label: "相关概念" },
  { key: "nextAction", label: "下一步行动" }
];

const TYPE_ANSWER_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  concept: [
    { key: "formalExplanation", label: "正式解释" },
    { key: "myUnderstanding", label: "我自己的理解" },
    { key: "commonMisunderstanding", label: "常见误解" },
    { key: "usageContext", label: "使用场景" }
  ],
  definition: [
    { key: "formalDefinition", label: "形式定义" },
    { key: "plainExplanation", label: "白话解释" },
    { key: "quantifierStructure", label: "量词结构" },
    { key: "commonMisunderstandings", label: "常见误解" }
  ],
  example: [
    { key: "exampleContent", label: "例子内容" },
    { key: "whyItFits", label: "为什么成立" },
    { key: "trainingPurpose", label: "训练目的" }
  ],
  boundary: [
    { key: "confusingObjects", label: "容易混淆对象" },
    { key: "similarity", label: "相似点" },
    { key: "keyDifference", label: "关键差别" },
    { key: "judgementRule", label: "判断规则" }
  ],
  counterexample: [
    { key: "counterexampleContent", label: "反例内容" },
    { key: "brokenCondition", label: "打破条件" },
    { key: "whyItIsNot", label: "为什么不是" }
  ],
  process: [
    { key: "task", label: "任务" },
    { key: "steps", label: "步骤" },
    { key: "keyTurn", label: "关键转折" },
    { key: "pitfall", label: "易错点" },
    { key: "usageContext", label: "使用场景" }
  ],
  mistake: [
    { key: "mistake", label: "错误表现" },
    { key: "originalThinking", label: "原来的想法" },
    { key: "realCause", label: "真正原因" },
    { key: "correctMethod", label: "正确做法" },
    { key: "recognitionSignal", label: "识别信号" }
  ],
  proof: [
    { key: "proposition", label: "命题" },
    { key: "firstAttempt", label: "第一次尝试" },
    { key: "keyMove", label: "关键动作" },
    { key: "proofOutline", label: "证明骨架" },
    { key: "failureReason", label: "失败原因" }
  ]
};

function reviewCardTypeLabel(type: string): string {
  return isCardType(type) ? CARD_LABELS[type].label : type;
}

function answerValue(card: ReviewCardContent, key: string): string | null {
  const value = card[key];
  if (Array.isArray(value)) {
    const text = value
      .filter((item): item is string => typeof item === "string")
      .join("、");
    return text.length > 0 ? text : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function answerEntries(card: ReviewCardContent) {
  return [...COMMON_ANSWER_FIELDS, ...(TYPE_ANSWER_FIELDS[card.type] ?? [])]
    .map((field) => ({
      ...field,
      value: answerValue(card, field.key)
    }))
    .filter(
      (field): field is { key: string; label: string; value: string } =>
        field.value !== null
    );
}

function uuidV4(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/gu, (char) =>
    (
      Number(char) ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(char) / 4)))
    ).toString(16)
  );
}

function boundedDuration(startedAt: number): number {
  return Math.min(86_400_000, Math.max(0, Date.now() - startedAt));
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const reviewQueue = useQuery({
    queryKey: queryKeys.review.today,
    queryFn: () => apiClient.get<ReviewQueueDocument>("/api/review/today")
  });
  const [index, setIndex] = useState(0);
  const [uiState, setUiState] = useState<ReviewUiState>("answering");
  const [answer, setAnswer] = useState("");
  const [declaredDontKnow, setDeclaredDontKnow] = useState(false);
  const [confidence, setConfidence] = useState<ReviewConfidence | null>(null);
  const [assistanceLevel, setAssistanceLevel] =
    useState<ReviewAssistanceLevel>("none");
  const [attemptStartedAt, setAttemptStartedAt] = useState(() => Date.now());
  const [attemptIdempotencyKey, setAttemptIdempotencyKey] = useState(uuidV4);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [revealedCard, setRevealedCard] =
    useState<ReviewCardContent | null>(null);
  const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
  const [blockType, setBlockType] = useState<BlockType | "">("");
  const [selfCorrection, setSelfCorrection] = useState("");
  const [assumedProblem, setAssumedProblem] = useState("");
  const [causeHypothesis, setCauseHypothesis] = useState("");
  const [nextMinimumAction, setNextMinimumAction] = useState("");
  const [targetCardType, setTargetCardType] =
    useState<PrimaryCardType>("concept");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recoveredLocalDraft, setRecoveredLocalDraft] = useState(false);
  const attemptRequestRef = useRef<ReviewAttemptRequest | null>(null);
  const resultRequestRef = useRef<ReviewResultRequest | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const items = reviewQueue.data?.items.filter((item) => item.due) ?? [];
  const activeItem = items[index] ?? null;
  const activeAnswerEntries =
    revealedCard === null ? [] : answerEntries(revealedCard);
  const weakFeedback = feedback === "forgot" || feedback === "fuzzy";
  const hasAnswer = answer.trim().length > 0;
  const canSaveAttempt =
    confidence !== null && (hasAnswer || declaredDontKnow) && !(hasAnswer && declaredDontKnow);
  const attemptLocked =
    uiState === "saving-attempt" || attemptRequestRef.current !== null;
  const resultLocked =
    uiState === "saving-result" || resultRequestRef.current !== null;
  const hasDraftContent =
    answer.trim().length > 0 ||
    declaredDontKnow ||
    confidence !== null ||
    assistanceLevel !== "none" ||
    attemptId !== null ||
    revealedCard !== null ||
    feedback !== null ||
    blockType !== "" ||
    selfCorrection.trim().length > 0 ||
    assumedProblem.trim().length > 0 ||
    causeHypothesis.trim().length > 0 ||
    nextMinimumAction.trim().length > 0;

  useEffect(() => {
    if (reviewQueue.data === undefined || recoveryChecked) {
      return;
    }

    const stored = readReviewDraft();
    if (stored !== null) {
      const recoveredIndex = items.findIndex((item) => item.cardId === stored.cardId);
      if (recoveredIndex >= 0) {
        setIndex(recoveredIndex);
        setUiState(stored.stage);
        setAnswer(stored.answer);
        setDeclaredDontKnow(stored.declaredDontKnow);
        setConfidence(stored.confidence);
        setAssistanceLevel(stored.assistanceLevel);
        setAttemptStartedAt(stored.attemptStartedAt);
        setAttemptIdempotencyKey(stored.attemptIdempotencyKey);
        setAttemptId(stored.attemptId);
        setRevealedCard(stored.revealedCard);
        setFeedback(stored.feedback);
        setBlockType(stored.blockType);
        setSelfCorrection(stored.selfCorrection);
        setAssumedProblem(stored.assumedProblem);
        setCauseHypothesis(stored.causeHypothesis);
        setNextMinimumAction(stored.nextMinimumAction);
        setTargetCardType(stored.targetCardType);
        setRecoveredLocalDraft(true);
      } else {
        clearReviewDraft();
      }
    }
    setRecoveryChecked(true);
  }, [recoveryChecked, reviewQueue.data]);

  const reviewDraftSnapshot = JSON.stringify({
    cardId: activeItem?.cardId ?? "",
    stage: revealedCard !== null && attemptId !== null ? "revealed" : "answering",
    answer,
    declaredDontKnow,
    confidence,
    assistanceLevel,
    attemptStartedAt,
    attemptIdempotencyKey,
    attemptId,
    revealedCard,
    feedback,
    blockType,
    selfCorrection,
    assumedProblem,
    causeHypothesis,
    nextMinimumAction,
    targetCardType
  });

  useEffect(() => {
    if (
      !recoveryChecked ||
      activeItem === null ||
      !hasDraftContent ||
      uiState === "saved"
    ) {
      return;
    }

    writeReviewDraft({
      cardId: activeItem.cardId,
      stage: revealedCard !== null && attemptId !== null ? "revealed" : "answering",
      answer,
      declaredDontKnow,
      confidence,
      assistanceLevel,
      attemptStartedAt,
      attemptIdempotencyKey,
      attemptId,
      revealedCard,
      feedback,
      blockType,
      selfCorrection,
      assumedProblem,
      causeHypothesis,
      nextMinimumAction,
      targetCardType
    });
  }, [
    activeItem,
    hasDraftContent,
    recoveryChecked,
    reviewDraftSnapshot,
    uiState
  ]);
  useUnsavedChanges(hasDraftContent && uiState !== "saved");

  useEffect(() => {
    if (activeItem !== null && uiState === "answering") {
      setAttemptStartedAt(Date.now());
    }
  }, [activeItem?.cardId]);

  useEffect(() => {
    if (uiState === "revealed") {
      resultRef.current?.focus();
    }
    if (uiState === "saved") {
      receiptRef.current?.focus();
    }
  }, [uiState]);

  async function saveAttemptAndReveal() {
    if (activeItem === null || !canSaveAttempt) {
      return;
    }

    setUiState("saving-attempt");
    setError(null);

    try {
      const request =
        attemptRequestRef.current ??
        {
          idempotencyKey: attemptIdempotencyKey,
          answer,
          declaredDontKnow,
          confidenceBeforeReveal: confidence,
          durationMs: boundedDuration(attemptStartedAt),
          assistanceLevel
        };
      attemptRequestRef.current = request;
      const response = await apiClient.post<ReviewAttemptResponse>(
        `/api/review/${activeItem.cardId}/attempt`,
        request
      );
      setAttemptId(response.attemptId);
      setRevealedCard(response.revealedCard);
      setBlockType(response.revealedCard.blockType ?? "");
      setTargetCardType(
        isPrimaryCardType(activeItem.cardType) ? activeItem.cardType : "concept"
      );
      setUiState("revealed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存闭卷回答失败");
      setUiState("answering");
    }
  }

  async function submitReviewResult() {
    if (activeItem === null || attemptId === null || feedback === null) {
      return;
    }

    if (weakFeedback && blockType === "") {
      setError("请选择本次卡点类型");
      return;
    }

    if (
      weakFeedback &&
      (selfCorrection.trim().length === 0 ||
        assumedProblem.trim().length === 0 ||
        causeHypothesis.trim().length === 0 ||
        nextMinimumAction.trim().length === 0)
    ) {
      setError("忘了或模糊时，请补全自我修正、原先判断、原因假设和下一步行动");
      return;
    }

    setUiState("saving-result");
    setError(null);

    try {
      const request =
        resultRequestRef.current ??
        {
          attemptId,
          feedback,
          blockType: blockType === "" ? null : blockType,
          selfCorrection,
          diagnosisDraft: weakFeedback
            ? {
                assumedProblem,
                causeHypothesis,
                nextMinimumAction,
                targetCardType
              }
            : null
        };
      resultRequestRef.current = request;
      const response = await apiClient.post<ReviewSubmitResponse>(
        `/api/review/${activeItem.cardId}/result`,
        request
      );
      await invalidateAfterMutation(queryClient, "review-completed");
      clearReviewDraft();
      setLastResult(
        `本次证据已保存。当前状态 ${response.result.nextMastery}，下次复习 ${response.result.nextReview}。`
      );
      setUiState("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交复习失败");
      setUiState("revealed");
    }
  }

  function advanceToNextCard() {
    clearReviewDraft();
    setIndex((value) => value + 1);
    setUiState("answering");
    setAnswer("");
    setDeclaredDontKnow(false);
    setConfidence(null);
    setAssistanceLevel("none");
    setAttemptStartedAt(Date.now());
    setAttemptIdempotencyKey(uuidV4());
    attemptRequestRef.current = null;
    resultRequestRef.current = null;
    setAttemptId(null);
    setRevealedCard(null);
    setFeedback(null);
    setBlockType("");
    setSelfCorrection("");
    setAssumedProblem("");
    setCauseHypothesis("");
    setNextMinimumAction("");
    setTargetCardType("concept");
    setError(null);
    setRecoveredLocalDraft(false);
  }

  function restartAttemptDraft() {
    attemptRequestRef.current = null;
    setAttemptIdempotencyKey(uuidV4());
    setAttemptStartedAt(Date.now());
    setError(null);
  }

  function storeDiagnosisDraft() {
    if (activeItem === null || blockType === "") {
      return;
    }

    sessionStorage.setItem(
      REVIEW_DIAGNOSIS_DRAFT_STORAGE_KEY,
      JSON.stringify({
        source: "review-attempt",
        concept: activeItem.concept,
        relatedCardId: activeItem.cardId,
        sourcePath: activeItem.cardPath,
        blockType,
        manifestation: declaredDontKnow ? "我现在确实不知道" : answer,
        excerpt: declaredDontKnow ? "我现在确实不知道" : answer,
        assumedProblem,
        actualCause: causeHypothesis,
        nextMinimumAction,
        targetCardType
      })
    );
  }

  return (
    <section className="route-stage review-page" aria-labelledby="review-title">
      <p className="eyebrow">Review</p>
      <h1 id="review-title">今日复习</h1>
      <p className="route-stage__summary">
        先留下自己的闭卷回答，再揭示卡片。系统记录的是尝试证据，不是一次自我感觉。
      </p>
      {recoveredLocalDraft ? (
        <div className="surface-static route-stage__card">
          <StatusDot label="已恢复本地复习草稿" tone="active" />
          <p>上次未完成的闭卷回答或自我修正已从本机恢复。</p>
        </div>
      ) : null}
      {reviewQueue.isPending ? (
        <div className="surface-static route-stage__card">
          <StatusDot label="读取复习队列" />
          <p>正在读取今天到期的卡片。</p>
        </div>
      ) : reviewQueue.isError ? (
        <div className="surface-static route-stage__card">
          <StatusDot label="复习队列暂时不可用" tone="blocked" />
          <p role="alert">
            {reviewQueue.error instanceof Error
              ? reviewQueue.error.message
              : "读取复习队列失败"}
          </p>
        </div>
      ) : activeItem === null ? (
        <div className="surface-static route-stage__card">
          <StatusDot label="今日清空" tone="active" />
          <p>{lastResult ?? "今天没有到期卡片。"}</p>
        </div>
      ) : (
        <article className="surface-static review-card">
          <StatusDot label={`${index + 1} / ${items.length}`} tone="due" />
          <div className="review-card__heading">
            <h2>{activeItem.concept}</h2>
            <p>
              {reviewCardTypeLabel(activeItem.cardType)} · 当前状态 {activeItem.mastery}
            </p>
          </div>
          <section className="review-prompt" aria-labelledby="review-prompt-title">
            <StatusDot label="闭卷问题" tone="active" />
            <h3 id="review-prompt-title">{activeItem.prompt}</h3>
            <p className="review-shortcuts">先写，再判断自己有多确定；答案会在尝试保存后出现。</p>
          </section>

          {uiState === "answering" || uiState === "saving-attempt" ? (
            <section className="review-attempt" aria-labelledby="review-attempt-title">
              <div className="review-section-heading">
                <span>01</span>
                <div>
                  <h3 id="review-attempt-title">留下独立作答</h3>
                  <p>不要润色成标准答案，保留此刻真实会写出的内容。</p>
                </div>
              </div>
              <label className="review-text-field">
                我的闭卷回答
                <textarea
                  disabled={declaredDontKnow || attemptLocked}
                  onChange={(event) => setAnswer(event.target.value)}
                  rows={6}
                  value={answer}
                />
              </label>
              <label className="review-dont-know">
                <input
                  checked={declaredDontKnow}
                  disabled={attemptLocked}
                  onChange={(event) => {
                    setDeclaredDontKnow(event.target.checked);
                    if (event.target.checked) {
                      setAnswer("");
                    }
                  }}
                  type="checkbox"
                />
                <span>我现在确实不知道</span>
              </label>
              <fieldset className="review-choice-fieldset">
                <legend>揭示前的信心</legend>
                <div className="review-choice-grid review-choice-grid--confidence">
                  {CONFIDENCE_OPTIONS.map((option) => (
                    <label className="review-choice" key={option.value}>
                      <input
                        checked={confidence === option.value}
                        disabled={attemptLocked}
                        name="review-confidence"
                        onChange={() => setConfidence(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="review-choice-fieldset">
                <legend>本次是否使用辅助</legend>
                <div className="review-choice-grid">
                  {ASSISTANCE_OPTIONS.map((option) => (
                    <label className="review-choice" key={option.value}>
                      <input
                        checked={assistanceLevel === option.value}
                        disabled={attemptLocked}
                        name="review-assistance"
                        onChange={() => setAssistanceLevel(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                className="button review-primary-button"
                disabled={!canSaveAttempt || uiState === "saving-attempt"}
                onClick={saveAttemptAndReveal}
                type="button"
              >
                {uiState === "saving-attempt" ? "正在保存尝试" : "保存尝试并揭示答案"}
              </button>
            </section>
          ) : (
            <section
              aria-label="作答与答案比较"
              aria-live="polite"
              className="review-comparison"
            >
              <div className="review-attempt-copy">
                <StatusDot label="已保存的尝试" tone="active" />
                <label className="review-text-field">
                  本次闭卷回答
                  <textarea
                    readOnly
                    rows={6}
                    value={declaredDontKnow ? "我现在确实不知道" : answer}
                  />
                </label>
                <p className="review-evidence-meta">
                  揭示前信心 {confidence} / 4 · {ASSISTANCE_OPTIONS.find((item) => item.value === assistanceLevel)?.label}
                </p>
              </div>
              <section className="review-answer" aria-label="答案面">
                <StatusDot label="答案面" tone="active" />
                {revealedCard === null ? (
                  <p className="review-answer-empty">答案暂时不可用，请重试本次尝试。</p>
                ) : (
                  <dl className="review-answer__list">
                    {activeAnswerEntries.map((entry) => (
                      <div key={`${entry.key}-${entry.label}`}>
                        <dt>{entry.label}</dt>
                        <dd>{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            </section>
          )}

          {error === null ? null : (
            <div className="review-error-actions">
              <p className="settings-error" role="alert">
                {error}
              </p>
              {uiState === "answering" && attemptRequestRef.current !== null ? (
                <button
                  className="button button-ghost"
                  onClick={restartAttemptDraft}
                  type="button"
                >
                  放弃本次重试并重新填写
                </button>
              ) : null}
            </div>
          )}

          {uiState === "revealed" || uiState === "saving-result" ? (
            <section
              aria-labelledby="review-result-title"
              className="review-result"
              ref={resultRef}
              tabIndex={-1}
            >
              <div className="review-section-heading">
                <span>02</span>
                <div>
                  <h3 id="review-result-title">比较后记录结果</h3>
                  <p>弱结果会保留卡点草稿；一次自评不会直接产生“已掌握”。</p>
                </div>
              </div>
              <fieldset className="review-choice-fieldset review-feedbacks">
                <legend>这次独立回忆的结果</legend>
                <div className="review-choice-grid review-choice-grid--feedback">
                  {FEEDBACKS.map((option) => (
                    <label className="review-choice" key={option.value}>
                      <input
                        checked={feedback === option.value}
                        disabled={resultLocked}
                        name="review-feedback"
                        onChange={() => setFeedback(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {feedback === null ? null : (
                <div className="review-submit-panel">
                  <label className="review-select-field">
                    本次卡点
                    <select
                      disabled={resultLocked}
                      onChange={(event) =>
                        setBlockType(event.target.value as BlockType | "")
                      }
                      value={blockType}
                    >
                      <option value="">请选择</option>
                      {BLOCK_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="review-text-field">
                    揭示后的自我修正{weakFeedback ? "（必填）" : "（可选）"}
                    <textarea
                      disabled={resultLocked}
                      onChange={(event) => setSelfCorrection(event.target.value)}
                      rows={3}
                      value={selfCorrection}
                    />
                  </label>

                  {weakFeedback ? (
                    <fieldset className="review-diagnosis">
                      <legend>卡点诊断草稿 · 尚未保存</legend>
                      <p>
                        这些内容随复习证据保存，但不会自动创建或关闭卡点诊断。提交后由你显式进入诊断页确认。
                      </p>
                      <label className="review-text-field">
                        我原先以为的问题
                        <textarea
                          disabled={resultLocked}
                          onChange={(event) => setAssumedProblem(event.target.value)}
                          rows={2}
                          value={assumedProblem}
                        />
                      </label>
                      <label className="review-text-field">
                        当前原因假设（待复测）
                        <textarea
                          disabled={resultLocked}
                          onChange={(event) => setCauseHypothesis(event.target.value)}
                          rows={3}
                          value={causeHypothesis}
                        />
                      </label>
                      <label className="review-text-field">
                        下一步最小行动
                        <textarea
                          disabled={resultLocked}
                          onChange={(event) => setNextMinimumAction(event.target.value)}
                          rows={3}
                          value={nextMinimumAction}
                        />
                      </label>
                      <label className="review-select-field">
                        补救后沉淀为
                        <select
                          disabled={resultLocked}
                          onChange={(event) =>
                            setTargetCardType(event.target.value as PrimaryCardType)
                          }
                          value={targetCardType}
                        >
                          {PRIMARY_CARD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {CARD_LABELS[type].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </fieldset>
                  ) : null}

                  <button
                    className="button review-primary-button"
                    disabled={uiState === "saving-result"}
                    onClick={submitReviewResult}
                    type="button"
                  >
                    {uiState === "saving-result" ? "正在保存结果" : "保存复习结果"}
                  </button>
                </div>
              )}
            </section>
          ) : null}

          {uiState === "saved" ? (
            <div
              aria-live="polite"
              className="review-save-receipt"
              ref={receiptRef}
              role="status"
              tabIndex={-1}
            >
              <StatusDot label="本次证据已保存" tone="active" />
              <p>{lastResult}</p>
              <div className="review-save-actions">
                {weakFeedback ? (
                  <Link
                    className="button review-primary-button"
                    onClick={storeDiagnosisDraft}
                    to="/diagnosis"
                  >
                    继续到卡点诊断
                  </Link>
                ) : null}
                {activeItem === null ? null : (
                  <Link
                    className="button button-ghost"
                    to={`/verification?cardId=${encodeURIComponent(activeItem.cardId)}`}
                  >
                    为本卡提交或查看证据
                  </Link>
                )}
                <button
                  className={`button${weakFeedback ? " button-ghost" : " review-primary-button"}`}
                  onClick={advanceToNextCard}
                  type="button"
                >
                  下一张
                </button>
              </div>
            </div>
          ) : null}
        </article>
      )}
    </section>
  );
}
