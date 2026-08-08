import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAfterMutation } from "../../app/query-invalidation";
import {
  createRouteReturnContext,
  stateWithReturnContext
} from "../../app/navigation-return";
import { queryKeys } from "../../app/query-keys";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  ContextualReturnControl,
  useNavigationReturnContext
} from "../../components/ContextualReturnControl";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import {
  libraryQueryScope,
  useLibraryIdentity
} from "../../lib/library-identity";
import { useUnsavedChanges } from "../../lib/unsaved-guard";
import type { BlockType } from "../cards/card-draft";
import {
  isPrimaryCardType,
  type PrimaryCardType
} from "../../../shared/card-types";
import {
  clearReviewDraft,
  readReviewDraft,
  writeReviewDraft
} from "./review-draft-store";
import {
  ASSISTANCE_OPTIONS,
  REVIEW_DIAGNOSIS_DRAFT_STORAGE_KEY,
  answerEntries,
  boundedDuration,
  reviewCardTypeLabel,
  uuidV4,
  type ReviewAssistanceLevel,
  type ReviewAttemptRequest,
  type ReviewAttemptResponse,
  type ReviewCardContent,
  type ReviewConfidence,
  type ReviewFeedback,
  type ReviewQueueDocument,
  type ReviewQueueItem,
  type ReviewResultRequest,
  type ReviewSubmitResponse,
  type ReviewUiState
} from "./review-contract";
import { ReviewAttemptStep, ReviewResultStep } from "./ReviewSessionSteps";

export function ReviewPage() {
  const identity = useLibraryIdentity();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const inheritedReturnContext = useNavigationReturnContext();
  const queryClient = useQueryClient();
  const requestedCardId = searchParams.get("cardId")?.trim() ?? "";
  const requestedConcept = searchParams.get("concept")?.trim() ?? "";
  const reviewQueue = useQuery({
    queryKey: [...queryKeys.review.today, ...libraryQueryScope(identity)],
    queryFn: ({ signal }) =>
      apiClient.get<ReviewQueueDocument>("/api/review/today", { signal })
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
  const [completedItem, setCompletedItem] = useState<ReviewQueueItem | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recoveredLocalDraft, setRecoveredLocalDraft] = useState(false);
  const [recoverableBaseline, setRecoverableBaseline] = useState<string | null>(
    null
  );
  const attemptRequestRef = useRef<ReviewAttemptRequest | null>(null);
  const resultRequestRef = useRef<ReviewResultRequest | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const items = reviewQueue.data?.items.filter((item) => item.due) ?? [];
  const queuedItem = items[index] ?? null;
  const activeItem =
    completedItem !== null && (uiState === "saving-result" || uiState === "saved")
      ? completedItem
      : queuedItem;
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
    const recoveredIndex =
      stored === null
        ? -1
        : items.findIndex((item) => item.cardId === stored.cardId);
    const requestedIndex = items.findIndex(
      (item) =>
        (requestedCardId !== "" && item.cardId === requestedCardId) ||
        (requestedCardId === "" &&
          requestedConcept !== "" &&
          item.concept === requestedConcept)
    );
    const targetIndex = recoveredIndex >= 0 ? recoveredIndex : Math.max(0, requestedIndex);
    const targetItem = items[targetIndex] ?? null;
    if (targetItem !== null) {
      setIndex(targetIndex);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("cardId", targetItem.cardId);
          next.set("concept", targetItem.concept);
          return next;
        },
        { replace: true, state: location.state }
      );
    }

    if (stored !== null) {
      if (recoveredIndex >= 0) {
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
        setRecoverableBaseline(
          JSON.stringify({
            cardId: stored.cardId,
            stage: stored.stage,
            answer: stored.answer,
            declaredDontKnow: stored.declaredDontKnow,
            confidence: stored.confidence,
            assistanceLevel: stored.assistanceLevel,
            attemptStartedAt: stored.attemptStartedAt,
            attemptIdempotencyKey: stored.attemptIdempotencyKey,
            attemptId: stored.attemptId,
            revealedCard: stored.revealedCard,
            feedback: stored.feedback,
            blockType: stored.blockType,
            selfCorrection: stored.selfCorrection,
            assumedProblem: stored.assumedProblem,
            causeHypothesis: stored.causeHypothesis,
            nextMinimumAction: stored.nextMinimumAction,
            targetCardType: stored.targetCardType
          })
        );
      } else {
        clearReviewDraft();
        setRecoverableBaseline("empty");
      }
    } else {
      setRecoverableBaseline("empty");
    }
    setRecoveryChecked(true);
  }, [
    recoveryChecked,
    requestedCardId,
    requestedConcept,
    reviewQueue.data,
    setSearchParams
  ]);

  const reviewDraftPayload = {
    cardId: activeItem?.cardId ?? "",
    stage: (revealedCard !== null && attemptId !== null
      ? "revealed"
      : "answering") as "revealed" | "answering",
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
  };
  const reviewDraftSnapshot = JSON.stringify(reviewDraftPayload);

  useEffect(() => {
    if (
      !recoveryChecked ||
      activeItem === null ||
      !hasDraftContent ||
      uiState === "saved"
    ) {
      return;
    }

    writeReviewDraft({ ...reviewDraftPayload, cardId: activeItem.cardId });
  }, [
    activeItem,
    hasDraftContent,
    recoveryChecked,
    reviewDraftSnapshot,
    uiState
  ]);
  const reviewDraftDirty =
    recoveryChecked &&
    recoverableBaseline !== null &&
    hasDraftContent &&
    uiState !== "saved" &&
    reviewDraftSnapshot !== recoverableBaseline;
  const markReviewDraftClean = useUnsavedChanges(reviewDraftDirty, {
    navigationRecoverable: true
  });

  useEffect(() => {
    if (
      !recoveryChecked ||
      activeItem === null ||
      hasDraftContent ||
      (requestedCardId === activeItem.cardId &&
        requestedConcept === activeItem.concept)
    ) {
      return;
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("cardId", activeItem.cardId);
        next.set("concept", activeItem.concept);
        return next;
      },
      { replace: true, state: location.state }
    );
  }, [
    activeItem,
    hasDraftContent,
    recoveryChecked,
    requestedCardId,
    requestedConcept,
    setSearchParams
  ]);

  useEffect(() => {
    if (
      recoveryChecked &&
      !recoveredLocalDraft &&
      activeItem !== null &&
      uiState === "answering"
    ) {
      setAttemptStartedAt(Date.now());
    }
  }, [
    activeItem?.cardId,
    recoveredLocalDraft,
    recoveryChecked,
    uiState
  ]);

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
      setCompletedItem(activeItem);
      markReviewDraftClean();
      clearReviewDraft();
      setLastResult(
        `本次证据已保存。当前状态 ${response.result.nextMastery}，下次复习 ${response.result.nextReview}。`
      );
      setUiState("saved");
      await invalidateAfterMutation(queryClient, "review-completed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交复习失败");
      setUiState("revealed");
    }
  }

  function advanceToNextCard() {
    clearReviewDraft();
    const completedStillOccupiesIndex =
      completedItem !== null && items[index]?.cardId === completedItem.cardId;
    setCompletedItem(null);
    setIndex((value) => completedStillOccupiesIndex ? value + 1 : value);
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

  const downstreamReturnContext =
    inheritedReturnContext ??
    createRouteReturnContext(
      "review",
      `${location.pathname}${location.search}${location.hash}`
    );

  return (
    <section className="route-stage review-page" aria-labelledby="review-title">
      <ContextualReturnControl
        onPrepareReturn={() =>
          !reviewDraftDirty ||
          activeItem === null ||
          writeReviewDraft({ ...reviewDraftPayload, cardId: activeItem.cardId }).ok
        }
      />
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
          {inheritedReturnContext === null ? (
            <Link className="button" to="/graph">
              查看主题飞轮
            </Link>
          ) : null}
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
            <ReviewAttemptStep
              answer={answer}
              assistanceLevel={assistanceLevel}
              attemptLocked={attemptLocked}
              canSaveAttempt={canSaveAttempt}
              confidence={confidence}
              declaredDontKnow={declaredDontKnow}
              onSave={() => void saveAttemptAndReveal()}
              setAnswer={setAnswer}
              setAssistanceLevel={setAssistanceLevel}
              setConfidence={setConfidence}
              setDeclaredDontKnow={setDeclaredDontKnow}
              uiState={uiState}
            />
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
            <ReviewResultStep
              assumedProblem={assumedProblem}
              blockType={blockType}
              causeHypothesis={causeHypothesis}
              feedback={feedback}
              nextMinimumAction={nextMinimumAction}
              onSubmit={() => void submitReviewResult()}
              resultLocked={resultLocked}
              resultRef={resultRef}
              selfCorrection={selfCorrection}
              setAssumedProblem={setAssumedProblem}
              setBlockType={setBlockType}
              setCauseHypothesis={setCauseHypothesis}
              setFeedback={setFeedback}
              setNextMinimumAction={setNextMinimumAction}
              setSelfCorrection={setSelfCorrection}
              setTargetCardType={setTargetCardType}
              targetCardType={targetCardType}
              uiState={uiState}
              weakFeedback={weakFeedback}
            />
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
                    state={stateWithReturnContext(downstreamReturnContext)}
                    to="/diagnosis"
                  >
                    继续到卡点诊断
                  </Link>
                ) : null}
                {activeItem === null ? null : (
                  <Link
                    className="button button-ghost"
                    state={stateWithReturnContext(downstreamReturnContext)}
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
