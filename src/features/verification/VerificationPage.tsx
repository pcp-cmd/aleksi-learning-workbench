import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAfterMutation } from "../../app/query-invalidation";
import { queryKeys } from "../../app/query-keys";
import { useLocation, useSearchParams } from "react-router-dom";
import { ContextualReturnControl } from "../../components/ContextualReturnControl";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import {
  libraryQueryScope,
  useLibraryIdentity
} from "../../lib/library-identity";
import {
  confirmDiscardUnsavedChanges,
} from "../../lib/unsaved-guard";
import {
  ASSISTANCE_LABELS,
  FindingsEditor,
  RELATION_LABELS,
  STATUS_LABELS,
  emptyFinding,
  normalizeFindings,
  parseImportedVerdict,
  type AssistanceLevel,
  type EvidenceDetail,
  type EvidenceSummary,
  type RecentCard,
  type RelationType,
  type VerifierKind
} from "./verification-contract";
import { writeVerificationDraft } from "./verification-draft-store";
import { useVerificationDraftState } from "./verification-draft-state";

export function VerificationPage() {
  const identity = useLibraryIdentity();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const requestedEvidenceId = searchParams.get("evidenceId")?.trim() ?? "";
  const requestedCardId = searchParams.get("cardId")?.trim() ?? "";
  const {
    activeId, assistanceLevel, candidateDraftDirty, cardId, criticalErrors,
    gaps, gptConfirmed, gptJson, markVerificationDraftClean, predecessorIds,
    proofAttempt, relationTypes, repairHints, revocationConfirmed,
    revocationReason, setActiveId, setAssistanceLevel, setCardId,
    setCriticalErrors, setGaps, setGptConfirmed, setGptJson, setPredecessorIds,
    setProofAttempt, setRelationTypes, setRepairHints, setRevocationConfirmed,
    setRevocationReason, setStatement, setSummary, setVerdict, setVerifierKind,
    skipFirstActiveReset, statement, summary, verdict, verdictDraftDirty,
    verificationDraft, verifierKind
  } = useVerificationDraftState(requestedCardId);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updateVerificationContext = useCallback((nextCardId: string, nextEvidenceId: string | null) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (nextCardId === "") {
          next.delete("cardId");
        } else {
          next.set("cardId", nextCardId);
        }
        if (nextEvidenceId === null || nextEvidenceId === "") {
          next.delete("evidenceId");
        } else {
          next.set("evidenceId", nextEvidenceId);
        }
        return next;
      },
      { replace: true, state: location.state }
    );
  }, [location.state, setSearchParams]);

  useEffect(() => {
    if (skipFirstActiveReset.current) {
      skipFirstActiveReset.current = false;
      return;
    }
    setSummary("");
    setCriticalErrors([emptyFinding()]);
    setGaps([emptyFinding()]);
    setRepairHints("");
    setVerdict("wrong");
    setVerifierKind("ai-review");
    setCopied(false);
    setGptJson("");
    setGptConfirmed(false);
    setRevocationReason("");
    setRevocationConfirmed(false);
  }, [activeId]);

  const cards = useQuery({
    queryKey: [
      ...queryKeys.cards.recent,
      10,
      ...libraryQueryScope(identity)
    ],
    queryFn: ({ signal }) =>
      apiClient.get<{ cards: RecentCard[] }>("/api/cards/recent?limit=10", {
        signal
      })
  });
  const ledger = useQuery({
    queryKey: [
      ...queryKeys.verification.candidates,
      ...libraryQueryScope(identity)
    ],
    queryFn: ({ signal }) =>
      apiClient.get<{
        candidates: EvidenceSummary[];
        diagnostics: Array<{
          errorId: string;
          file: string;
          message: string;
        }>;
      }>(
        "/api/verification/candidates",
        { signal }
      )
  });
  const detail = useQuery({
    queryKey: [
      ...queryKeys.verification.candidate(activeId ?? ""),
      ...libraryQueryScope(identity)
    ],
    queryFn: ({ signal }) =>
      apiClient.get<{ candidate: EvidenceDetail }>(
        `/api/verification/candidates/${activeId}`,
        { signal }
      ),
    enabled: activeId !== null
  });

  const acceptedPredecessors = useMemo(
    () => ledger.data?.candidates.filter((item) => item.status === "accepted") ?? [],
    [ledger.data]
  );
  const evidenceLabelById = useMemo(
    () =>
      new Map(
        (ledger.data?.candidates ?? []).map((item) => [item.id, item.statement])
      ),
    [ledger.data]
  );

  useEffect(() => {
    if (cardId === "" && cards.data?.cards[0] !== undefined) {
      const firstCardId = cards.data.cards[0].id;
      setCardId(firstCardId);
      if (!candidateDraftDirty && !verdictDraftDirty) {
        updateVerificationContext(firstCardId, requestedEvidenceId || null);
      }
    }
  }, [
    candidateDraftDirty,
    cardId,
    cards.data,
    requestedEvidenceId,
    updateVerificationContext,
    verdictDraftDirty
  ]);

  useEffect(() => {
    if (ledger.data === undefined || requestedEvidenceId === "") {
      return;
    }

    const requestedEvidence = ledger.data.candidates.find(
      (candidate) => candidate.id === requestedEvidenceId
    );
    if (requestedEvidence === undefined) {
      setMessage("指定的证据记录已不存在，已保留关联卡片上下文。");
      updateVerificationContext(cardId, null);
      return;
    }

    if (activeId !== requestedEvidence.id) {
      setActiveId(requestedEvidence.id);
    }
    if (cardId !== requestedEvidence.cardId) {
      setCardId(requestedEvidence.cardId);
      updateVerificationContext(requestedEvidence.cardId, requestedEvidence.id);
    }
  }, [activeId, cardId, ledger.data, requestedEvidenceId, updateVerificationContext]);

  const createCandidate = useMutation({
    mutationFn: () =>
      apiClient.post<{ candidate: EvidenceDetail; replayed: boolean }>(
        "/api/verification/candidates",
        {
          cardId, statement, proofAttempt, predecessorIds,
          relations: predecessorIds.map((targetEvidenceId) => ({
            targetEvidenceId,
            type: relationTypes[targetEvidenceId] ?? "requires"
          })),
          assistanceLevel
        }
    ),
    onSuccess: async (response) => {
      markVerificationDraftClean();
      setActiveId(response.candidate.id);
      setStatement("");
      setProofAttempt("");
      setPredecessorIds([]);
      setRelationTypes({});
      setAssistanceLevel("none");
      window.setTimeout(() => {
        updateVerificationContext(
          response.candidate.cardId,
          response.candidate.id
        );
      }, 0);
      setMessage(
        response.replayed
          ? "相同内容的候选证据已经存在，已打开原记录。"
          : "候选证据已冻结保存。下一步请交给独立审查者。"
      );
      await invalidateAfterMutation(queryClient, "verification-changed");
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "保存失败")
  });

  const normalizedCriticalErrors = normalizeFindings(criticalErrors);
  const normalizedGaps = normalizeFindings(gaps);
  const findingsComplete = [...normalizedCriticalErrors, ...normalizedGaps].every(
    (finding) => finding.location !== "" && finding.issue !== ""
  );
  const verdictConsistent =
    verdict === "correct"
      ? normalizedCriticalErrors.length === 0 &&
        normalizedGaps.length === 0 &&
        repairHints === ""
      : normalizedCriticalErrors.length + normalizedGaps.length > 0 &&
        repairHints.trim().length > 0;

  const recordVerdict = useMutation({
    mutationFn: () =>
      apiClient.post<{ candidate: EvidenceDetail }>(
        `/api/verification/candidates/${activeId}/verdict`,
        {
          verifierKind,
          verificationReport: {
            summary,
            criticalErrors: normalizedCriticalErrors,
            gaps: normalizedGaps
          },
          verdict,
          repairHints,
          confirmed: verifierKind === "gpt-plus-import" ? gptConfirmed : false
        }
    ),
    onSuccess: async (response) => {
      markVerificationDraftClean();
      setSummary("");
      setCriticalErrors([emptyFinding()]);
      setGaps([emptyFinding()]);
      setRepairHints("");
      setVerdict("wrong");
      setVerifierKind("ai-review");
      setGptJson("");
      setGptConfirmed(false);
      setMessage(
        response.candidate.status === "accepted"
          ? "审查结论已单独保存；这仍不是形式化证明证书。"
          : "问题与修复提示已保存。请新建修订候选，不要覆盖旧稿。"
      );
      await invalidateAfterMutation(queryClient, "verification-changed");
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "保存判定失败")
  });

  const revokeCandidate = useMutation({
    mutationFn: () => apiClient.post<{ candidate: EvidenceDetail }>(
      `/api/verification/candidates/${activeId}/revoke`,
      { reason: revocationReason, confirmed: revocationConfirmed }
    ),
    onSuccess: async () => {
      markVerificationDraftClean();
      setRevocationReason("");
      setRevocationConfirmed(false);
      setMessage("撤销记录已追加；原候选与原判定仍保留，所有依赖节点已进入待复核。");
      await invalidateAfterMutation(queryClient, "verification-changed");
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "撤销失败")
  });

  const parseGptJson = () => {
    try {
      const parsed = parseImportedVerdict(gptJson);
      setVerifierKind("gpt-plus-import");
      setSummary(parsed.summary);
      setCriticalErrors(
        parsed.criticalErrors.length > 0
          ? parsed.criticalErrors
          : [emptyFinding()]
      );
      setGaps(parsed.gaps.length > 0 ? parsed.gaps : [emptyFinding()]);
      setVerdict(parsed.verdict);
      setRepairHints(parsed.repairHints);
      setGptConfirmed(false);
      setMessage("GPT JSON 已解析为可编辑预览。请逐项检查后显式确认。");
    } catch (error) {
      setMessage(error instanceof Error ? `JSON 解析失败：${error.message}` : "JSON 解析失败");
    }
  };

  const active = detail.data?.candidate ?? null;

  return (
    <section aria-labelledby="verification-title" className="route-stage verification-page">
      <ContextualReturnControl
        fallback={{ source: "cards", to: "/cards" }}
        onPrepareReturn={() =>
          (!candidateDraftDirty && !verdictDraftDirty) ||
          writeVerificationDraft(verificationDraft).ok
        }
      />
      <p className="eyebrow">Danus trusted knowledge gate · 高级账本</p>
      <h1 id="verification-title">证据验证</h1>
      <p className="route-stage__summary">
        先冻结你自己的结论与论证，再交给另一轮结构化审查。辅助程度来自你的自报；AI 审查不是形式化证明。
      </p>
      {cards.isError || ledger.isError ? (
        <p className="settings-error" role="alert">
          {cards.error instanceof Error
            ? cards.error.message
            : ledger.error instanceof Error
              ? ledger.error.message
              : "无法读取验证工作台数据。"}
        </p>
      ) : null}
      {(ledger.data?.diagnostics?.length ?? 0) > 0 ? (
        <p className="settings-error" role="status">
          已隔离 {ledger.data!.diagnostics.length} 条损坏的验证记录；其余证据仍可正常使用。
        </p>
      ) : null}

      <div className="verification-layout">
        <section aria-labelledby="candidate-form-title" className="surface-static verification-panel">
          <StatusDot label="01 · 提交候选" tone="active" />
          <h2 id="candidate-form-title">冻结一次真实作答</h2>
          <label>
            关联卡片
            <select
              aria-label="关联卡片"
              onChange={(event) => {
                const nextCardId = event.target.value;
                if (nextCardId === cardId) {
                  return;
                }
                if (!confirmDiscardUnsavedChanges()) {
                  return;
                }
                setCardId(nextCardId);
                setActiveId(null);
                updateVerificationContext(nextCardId, null);
              }}
              value={cardId}
            >
              <option value="">选择一张卡片</option>
              {cardId !== "" && !(cards.data?.cards ?? []).some((card) => card.id === cardId) ? (
                <option value={cardId}>当前入口关联的卡片</option>
              ) : null}
              {(cards.data?.cards ?? []).map((card) => (
                <option key={card.id} value={card.id}>{card.title} · {card.concept}</option>
              ))}
            </select>
          </label>
          <label>
            我主张的结论
            <textarea aria-label="我主张的结论" onChange={(event) => setStatement(event.target.value)} rows={3} value={statement} />
          </label>
          <label>
            我的证明或论证
            <textarea aria-label="我的证明或论证" onChange={(event) => setProofAttempt(event.target.value)} rows={8} value={proofAttempt} />
          </label>
          <label>
            本次辅助程度
            <select aria-label="本次辅助程度" onChange={(event) => setAssistanceLevel(event.target.value as AssistanceLevel)} value={assistanceLevel}>
              {Object.entries(ASSISTANCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {acceptedPredecessors.length > 0 ? (
            <fieldset className="verification-predecessors">
              <legend>引用已经通过审查的前置证据</legend>
              {acceptedPredecessors.map((item) => (
                <label key={item.id}>
                  <input
                    checked={predecessorIds.includes(item.id)}
                    onChange={(event) => setPredecessorIds(event.target.checked ? [...predecessorIds, item.id] : predecessorIds.filter((id) => id !== item.id))}
                    type="checkbox"
                  />
                  <span>{item.statement}</span>
                  <select
                    aria-label={`关系类型 ${item.statement}`}
                    disabled={!predecessorIds.includes(item.id)}
                    onChange={(event) => setRelationTypes({
                      ...relationTypes,
                      [item.id]: event.target.value as RelationType
                    })}
                    value={relationTypes[item.id] ?? "requires"}
                  >
                    {Object.entries(RELATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              ))}
            </fieldset>
          ) : null}
          <button
            className="button verification-primary"
            disabled={cardId === "" || statement.trim() === "" || proofAttempt.trim() === "" || createCandidate.isPending}
            onClick={() => createCandidate.mutate()}
            type="button"
          >
            {createCandidate.isPending ? "正在冻结候选" : "保存不可覆盖的候选证据"}
          </button>
        </section>

        <section aria-labelledby="ledger-title" className="surface-static verification-panel verification-ledger">
          <StatusDot label="证据账本" tone="due" />
          <h2 id="ledger-title">候选与判定</h2>
          {ledger.isLoading ? <p>正在读取证据账本…</p> : null}
          {ledger.data?.candidates.length === 0 ? <p>还没有候选证据。先从左侧冻结一次真实作答。</p> : null}
          {(ledger.data?.candidates ?? []).map((item) => (
            <button
              className={`verification-ledger-item${activeId === item.id ? " is-active" : ""}`}
              key={item.id}
              onClick={() => {
                if (
                  activeId !== item.id &&
                  !confirmDiscardUnsavedChanges()
                ) {
                  return;
                }
                setActiveId(item.id);
                setCardId(item.cardId);
                updateVerificationContext(item.cardId, item.id);
              }}
              type="button"
            >
              <span>{STATUS_LABELS[item.status]}</span>
              <strong>{item.statement}</strong>
              <small>{ASSISTANCE_LABELS[item.assistanceLevel]} · {item.createdAt.slice(0, 10)}</small>
            </button>
          ))}
        </section>
      </div>

      {message === null ? null : <p aria-live="polite" className="verification-message" role="status">{message}</p>}

      {active === null ? null : (
        <section aria-labelledby="review-gate-title" className="surface-static verification-review-gate">
          <div className="verification-review-heading">
            <div>
              <StatusDot label={`02 · ${STATUS_LABELS[active.status]}`} tone={["repair-needed", "revoked", "affected"].includes(active.status) ? "blocked" : "active"} />
              <h2 id="review-gate-title">结构化审查门</h2>
            </div>
            <span>{active.title}</span>
          </div>
          <div className="verification-trust-strip">
            <span>{ASSISTANCE_LABELS[active.assistanceLevel]}</span>
            <span>前置证据 {active.predecessorIds.length} 条</span>
            <span>信任与掌握分离 · 不会自动推进掌握</span>
          </div>
          <details>
            <summary>查看冻结的原始论证</summary>
            <h3>{active.statement}</h3>
            <p className="verification-proof">{active.proofAttempt}</p>
            {active.contextSnapshot === null ? <p>历史 v1 记录未包含快照哈希。</p> : (
              <dl className="verification-context-grid">
                <div><dt>卡片修订</dt><dd>{active.contextSnapshot.cardRevision}</dd></div>
                <div><dt>卡片快照</dt><dd><code>{active.contextSnapshot.cardSnapshotSha256}</code></dd></div>
                {active.contextSnapshot.sourceSnapshots.map((source) => (
                  <div key={source.readingId}><dt>来源快照</dt><dd>{source.relativePath}<br /><code>{source.snapshotSha256}</code></dd></div>
                ))}
              </dl>
            )}
            {active.relations.length > 0 ? (
              <p>
                关系：
                {active.relations
                  .map(
                    (relation) =>
                      `${RELATION_LABELS[relation.type]} → ${
                        evidenceLabelById.get(relation.targetEvidenceId) ?? "已关联证据"
                      }`
                  )
                  .join("；")}
              </p>
            ) : null}
          </details>

          {active.status === "awaiting-verification" ? (
            <>
              <div className="verification-prompt-box">
                <h3>给独立审查者的提示词</h3>
                <textarea aria-label="给独立审查者的提示词" readOnly rows={10} value={active.verificationPrompt} />
                <button
                  className="button button-ghost"
                  onClick={async () => {
                    try {
                      if (navigator.clipboard === undefined) {
                        throw new Error("当前环境不支持剪贴板写入。");
                      }
                      await navigator.clipboard.writeText(active.verificationPrompt);
                      setCopied(true);
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? `复制失败：${error.message}`
                          : "复制失败，请手动选择提示词。"
                      );
                    }
                  }}
                  type="button"
                >
                  {copied ? "已复制审查提示词" : "复制审查提示词"}
                </button>
              </div>
              <details className="verification-import-box">
                <summary>从 ChatGPT Plus 粘贴结构化审查 JSON</summary>
                <p>先解析为下方可编辑预览；未逐项检查并确认前，系统不会写入判定。</p>
                <textarea
                  aria-label="粘贴 GPT Plus 审查 JSON"
                  onChange={(event) => setGptJson(event.target.value)}
                  placeholder="粘贴提示词返回的 JSON"
                  rows={10}
                  value={gptJson}
                />
                <button className="button button-ghost" disabled={gptJson.trim() === ""} onClick={parseGptJson} type="button">
                  解析并预览 GPT JSON
                </button>
              </details>
              <div className="verification-verdict-form">
                <label>
                  审查来源
                  <select aria-label="审查来源" onChange={(event) => setVerifierKind(event.target.value as VerifierKind)} value={verifierKind}>
                    <option value="ai-review">AI 审查记录</option>
                    <option value="human-review">人工审查记录</option>
                    <option value="gpt-plus-import">GPT Plus JSON 导入（需确认）</option>
                  </select>
                </label>
                <label>
                  审查摘要
                  <textarea aria-label="审查摘要" onChange={(event) => setSummary(event.target.value)} rows={3} value={summary} />
                </label>
                <FindingsEditor label="关键错误" onChange={setCriticalErrors} value={criticalErrors} />
                <FindingsEditor label="论证缺口" onChange={setGaps} value={gaps} />
                <label>
                  严格判定
                  <select aria-label="严格判定" onChange={(event) => setVerdict(event.target.value as "correct" | "wrong")} value={verdict}>
                    <option value="wrong">wrong · 需要修复</option>
                    <option value="correct">correct · 零错误且零缺口</option>
                  </select>
                </label>
                <label>
                  修复提示
                  <textarea aria-label="修复提示" disabled={verdict === "correct"} onChange={(event) => setRepairHints(event.target.value)} rows={3} value={repairHints} />
                </label>
                {verifierKind === "gpt-plus-import" ? (
                  <label className="verification-confirmation">
                    <input checked={gptConfirmed} onChange={(event) => setGptConfirmed(event.target.checked)} type="checkbox" />
                    <span>我已检查可编辑预览，并确认把它作为 GPT Plus 审查记录保存（不是形式化证明）。</span>
                  </label>
                ) : null}
                <button
                  className="button verification-primary"
                  disabled={summary.trim() === "" || !findingsComplete || !verdictConsistent || (verifierKind === "gpt-plus-import" && !gptConfirmed) || recordVerdict.isPending}
                  onClick={() => recordVerdict.mutate()}
                  type="button"
                >
                  {recordVerdict.isPending ? "正在保存判定" : "保存不可覆盖的审查结论"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`verification-result verification-result--${active.status}`}>
                <h3>{active.verdict?.verificationReport.summary ?? "该证据的信任状态已改变"}</h3>
                {active.verdict?.verificationReport.criticalErrors.map((finding) => <p key={`critical-${finding.location}`}><strong>{finding.location}：</strong>{finding.issue}</p>)}
                {active.verdict?.verificationReport.gaps.map((finding) => <p key={`gap-${finding.location}`}><strong>{finding.location}：</strong>{finding.issue}</p>)}
                {active.verdict?.repairHints ? <p><strong>下一轮修复：</strong>{active.verdict.repairHints}</p> : null}
                {active.revocationImpacts.map((impact) => (
                  <p key={`${impact.rootEvidenceId}-${impact.evidenceId}`}><strong>撤销传播：</strong>{impact.reason} · {impact.path.map((id) => id.slice(0, 14)).join(" → ")}</p>
                ))}
                <p>{active.status === "repair-needed"
                  ? "请保留这份旧稿，修复后新建一个候选证据。"
                  : active.status === "revoked" || active.status === "affected"
                    ? "原候选与原判定仍被保留；该知识节点已进入待复核。"
                    : "这份论证增强了信任，但不会自动改变掌握度；重要结论仍应由专家或形式化工具复核。"}</p>
              </div>
              {active.status === "accepted" ? (
                <details className="verification-revoke-box">
                  <summary>撤销这条已接受证据</summary>
                  <p>撤销会追加不可覆盖记录，并把所有传递依赖节点置为待复核；不会删除原文件。</p>
                  <textarea aria-label="撤销原因" onChange={(event) => setRevocationReason(event.target.value)} rows={3} value={revocationReason} />
                  <label className="verification-confirmation">
                    <input checked={revocationConfirmed} onChange={(event) => setRevocationConfirmed(event.target.checked)} type="checkbox" />
                    <span>我确认追加撤销记录并传播到所有依赖证据。</span>
                  </label>
                  <button className="button button-ghost" disabled={revocationReason.trim() === "" || !revocationConfirmed || revokeCandidate.isPending} onClick={() => revokeCandidate.mutate()} type="button">
                    {revokeCandidate.isPending ? "正在追加撤销" : "确认撤销并传播"}
                  </button>
                </details>
              ) : null}
            </>
          )}
        </section>
      )}
    </section>
  );
}
