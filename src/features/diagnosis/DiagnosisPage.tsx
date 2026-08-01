import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../app/query-keys";
import { SaveReceipt } from "../../components/SaveReceipt";
import { StatusDot } from "../../components/StatusDot";
import { ContextualReturnControl } from "../../components/ContextualReturnControl";
import { apiClient } from "../../lib/api-client";
import {
  libraryQueryScope,
  useLibraryIdentity
} from "../../lib/library-identity";
import { useUnsavedChanges } from "../../lib/unsaved-guard";
import {
  READER_SELECTION_STORAGE_KEY,
  type ReaderSelectionPayload
} from "../reader/selection";
import type { BlockType } from "../cards/card-draft";
import { CARD_LABELS } from "../../../shared/card-labels";
import {
  isPrimaryCardType,
  PRIMARY_CARD_TYPES,
  type PrimaryCardType
} from "../../../shared/card-types";
import {
  clearDiagnosisDraft,
  readDiagnosisDraft,
  writeDiagnosisDraft
} from "./diagnosis-draft-store";

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

const REVIEW_DIAGNOSIS_DRAFT_STORAGE_KEY = "aleksi.reviewDiagnosisDraft";

const PRIMARY_CARD_OPTIONS: Array<{ label: string; value: PrimaryCardType }> =
  PRIMARY_CARD_TYPES.map((type) => ({
    value: type,
    label: CARD_LABELS[type].label
  }));

type SaveReceiptShape = {
  absolutePath: string;
  modifiedAt: string;
  relativePath: string;
};

type DiagnosisResponse = {
  diagnosis: {
    id: string;
  };
  saveReceipt: SaveReceiptShape;
};

type CodexTaskResponse = {
  saveReceipt: SaveReceiptShape;
};

type ReviewDiagnosisDraftSelection = {
  source: "review-attempt";
  concept: string;
  relatedCardId: string;
  sourcePath: string;
  blockType: BlockType;
  manifestation: string;
  excerpt: string;
  assumedProblem: string;
  actualCause: string;
  nextMinimumAction: string;
  targetCardType: PrimaryCardType;
};

type DiagnosisSelection = ReaderSelectionPayload | ReviewDiagnosisDraftSelection;
type RecentCardOption = {
  id: string;
  title: string;
  preview: { concept: string };
};

function isBlockType(value: unknown): value is BlockType {
  return (
    typeof value === "string" &&
    BLOCK_TYPES.some((option) => option.value === value)
  );
}

function readReviewDiagnosisDraft(): ReviewDiagnosisDraftSelection | null {
  const raw = sessionStorage.getItem(REVIEW_DIAGNOSIS_DRAFT_STORAGE_KEY);
  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReviewDiagnosisDraftSelection>;
    if (
      parsed.source === "review-attempt" &&
      typeof parsed.concept === "string" &&
      typeof parsed.relatedCardId === "string" &&
      typeof parsed.sourcePath === "string" &&
      isBlockType(parsed.blockType) &&
      typeof parsed.manifestation === "string" &&
      typeof parsed.excerpt === "string" &&
      typeof parsed.assumedProblem === "string" &&
      typeof parsed.actualCause === "string" &&
      typeof parsed.nextMinimumAction === "string" &&
      typeof parsed.targetCardType === "string" &&
      isPrimaryCardType(parsed.targetCardType)
    ) {
      return parsed as ReviewDiagnosisDraftSelection;
    }
  } catch {
    return null;
  }

  return null;
}

function readDiagnosisSelection(): DiagnosisSelection | null {
  const reviewDraft = readReviewDiagnosisDraft();
  if (reviewDraft !== null) {
    sessionStorage.removeItem(REVIEW_DIAGNOSIS_DRAFT_STORAGE_KEY);
    return reviewDraft;
  }

  const raw = sessionStorage.getItem(READER_SELECTION_STORAGE_KEY);

  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReaderSelectionPayload>;

    if (
      parsed.source === "reader-selection" &&
      parsed.target === "diagnosis" &&
      typeof parsed.sourceReadingId === "string" &&
      typeof parsed.sourcePath === "string" &&
      typeof parsed.concept === "string" &&
      typeof parsed.excerpt === "string"
    ) {
      sessionStorage.removeItem(READER_SELECTION_STORAGE_KEY);
      return parsed as ReaderSelectionPayload;
    }
  } catch {
    return null;
  }

  return null;
}

function targetCardTypeFromSelection(
  selection: DiagnosisSelection | null
): PrimaryCardType {
  if (
    selection?.source === "review-attempt" &&
    isPrimaryCardType(selection.targetCardType)
  ) {
    return selection.targetCardType;
  }

  if (
    selection?.source === "reader-selection" &&
    selection.cardType !== undefined &&
    isPrimaryCardType(selection.cardType)
  ) {
    return selection.cardType;
  }

  return "concept";
}

export function DiagnosisPage() {
  const identity = useLibraryIdentity();
  const selection = useMemo(() => readDiagnosisSelection(), []);
  const recoveredDraft = useMemo(
    () => (selection === null ? readDiagnosisDraft() : null),
    [selection]
  );
  const recentCards = useQuery({
    queryKey: [
      ...queryKeys.cards.recent,
      "diagnosis",
      ...libraryQueryScope(identity)
    ],
    queryFn: ({ signal }) =>
      apiClient.get<{ cards: RecentCardOption[] }>(
        "/api/cards/recent?limit=10",
        { signal }
      )
  });
  const [concept, setConcept] = useState(
    selection?.concept ?? recoveredDraft?.concept ?? ""
  );
  const [relatedCardId, setRelatedCardId] = useState(
    selection?.source === "review-attempt"
      ? selection.relatedCardId
      : recoveredDraft?.relatedCardId ?? ""
  );
  const [blockType, setBlockType] = useState<BlockType>(
    selection?.source === "review-attempt"
      ? selection.blockType
      : recoveredDraft?.blockType ?? "definition"
  );
  const [manifestation, setManifestation] = useState(
    selection?.source === "review-attempt"
      ? selection.manifestation
      : (selection?.excerpt ?? recoveredDraft?.manifestation ?? "")
  );
  const [assumedProblem, setAssumedProblem] = useState(
    selection?.source === "review-attempt"
      ? selection.assumedProblem
      : recoveredDraft?.assumedProblem ?? ""
  );
  const [causeHypothesis, setCauseHypothesis] = useState(
    selection?.source === "review-attempt"
      ? selection.actualCause
      : recoveredDraft?.actualCause ?? ""
  );
  const [nextMinimumAction, setNextMinimumAction] = useState(
    selection?.source === "review-attempt"
      ? selection.nextMinimumAction
      : recoveredDraft?.nextMinimumAction ?? ""
  );
  const [targetCardType, setTargetCardType] = useState<PrimaryCardType>(
    selection === null && recoveredDraft !== null
      ? recoveredDraft.targetCardType
      : targetCardTypeFromSelection(selection)
  );
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosisReceipt, setDiagnosisReceipt] =
    useState<SaveReceiptShape | null>(null);
  const [codexReceipt, setCodexReceipt] = useState<SaveReceiptShape | null>(null);
  const diagnosisPayload = {
    concept,
    relatedCardId: relatedCardId.trim(),
    blockType,
    manifestation,
    assumedProblem,
    actualCause: causeHypothesis,
    nextMinimumAction,
    targetCardType
  };
  const [cleanSnapshot, setCleanSnapshot] = useState(() =>
    JSON.stringify(diagnosisPayload)
  );
  const diagnosisSnapshot = JSON.stringify(diagnosisPayload);
  const dirty = diagnosisSnapshot !== cleanSnapshot;
  const markDiagnosisDraftClean = useUnsavedChanges(dirty, {
    navigationRecoverable: true
  });
  const diagnosisSourceIds = [
    selection?.source === "reader-selection" ? selection.sourceReadingId : "",
    diagnosisPayload.relatedCardId
  ].filter((sourceId) => sourceId.length > 0);

  useEffect(() => {
    if (!dirty) {
      return;
    }

    writeDiagnosisDraft(diagnosisPayload, diagnosisSourceIds);
  }, [diagnosisSnapshot, dirty, selection]);

  async function saveDiagnosis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const result = await apiClient.post<DiagnosisResponse>("/api/diagnoses", {
        concept: diagnosisPayload.concept,
        ...(diagnosisPayload.relatedCardId.length === 0
          ? {}
          : { relatedCardId: diagnosisPayload.relatedCardId }),
        blockType: diagnosisPayload.blockType,
        manifestation: diagnosisPayload.manifestation,
        assumedProblem: diagnosisPayload.assumedProblem,
        actualCause: diagnosisPayload.actualCause,
        nextMinimumAction: diagnosisPayload.nextMinimumAction,
        targetCardType: diagnosisPayload.targetCardType
      });
      setDiagnosisReceipt(result.saveReceipt);
      markDiagnosisDraftClean();
      setCleanSnapshot(diagnosisSnapshot);
      clearDiagnosisDraft();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存诊断失败");
    } finally {
      setSaving(false);
    }
  }

  async function createCodexTask() {
    setGenerating(true);
    setError(null);

    try {
      const result = await apiClient.post<CodexTaskResponse>("/api/codex/tasks", {
        concept,
        ...(selection?.source !== "reader-selection"
          ? {}
          : { sourceReadingId: selection.sourceReadingId }),
        ...(relatedCardId.trim().length === 0
          ? {}
          : { relatedCardId: relatedCardId.trim() }),
        currentMaterial: selection?.excerpt ?? manifestation,
        understanding: causeHypothesis,
        blockType
      });
      setCodexReceipt(result.saveReceipt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成 Codex 任务失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section
      className="route-stage diagnosis-page"
      aria-labelledby="diagnosis-title"
    >
      <ContextualReturnControl
        fallback={{ source: "reader", to: "/reader" }}
        onPrepareReturn={() =>
          !dirty || writeDiagnosisDraft(diagnosisPayload, diagnosisSourceIds).ok
        }
      />
      <p className="eyebrow">Diagnosis</p>
      <h1 id="diagnosis-title">卡点诊断</h1>
      <p className="route-stage__summary">
        把一次模糊卡住，沉淀成可追踪的八类卡点和下一步最小行动。
      </p>
      {selection === null ? (
        <div className="surface-static route-stage__card">
          <StatusDot
            label={recoveredDraft === null ? "等待 Reader 选区" : "已恢复本地诊断草稿"}
            tone={recoveredDraft === null ? "blocked" : "active"}
          />
          <p>
            {recoveredDraft === null
              ? "从精读工作台选中一段原文，或从摘录篮转成卡点。"
              : "上次未保存的卡点诊断已从本机恢复，可以继续编辑。"}
          </p>
        </div>
      ) : (
        <div className="surface-static route-stage__card">
          <StatusDot
            label={selection.source === "review-attempt" ? "来源复习尝试" : "来源摘录"}
            tone="active"
          />
          <p>{selection.sourcePath}</p>
          <p>{selection.excerpt}</p>
        </div>
      )}
      {error === null ? null : (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <form className="diagnosis-form surface-static" onSubmit={saveDiagnosis}>
        <div className="form-grid">
          <label>
            概念
            <input
              onChange={(event) => setConcept(event.target.value)}
              value={concept}
            />
          </label>
          <label>
            关联卡片（可选）
            <select
              aria-label="关联卡片"
              onChange={(event) => setRelatedCardId(event.target.value)}
              value={relatedCardId}
            >
              <option value="">不关联卡片</option>
              {relatedCardId !== "" &&
              !(recentCards.data?.cards ?? []).some(
                (card) => card.id === relatedCardId
              ) ? (
                <option value={relatedCardId}>当前复习卡片</option>
              ) : null}
              {(recentCards.data?.cards ?? []).map((card) => (
                <option key={card.id} value={card.id}>
                  {card.title} · {card.preview.concept}
                </option>
              ))}
            </select>
          </label>
          <label>
            卡点类型
            <select
              onChange={(event) => setBlockType(event.target.value as BlockType)}
              value={blockType}
            >
              {BLOCK_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            要沉淀成哪类卡片
            <select
              onChange={(event) =>
                setTargetCardType(event.target.value as PrimaryCardType)
              }
              value={targetCardType}
            >
              {PRIMARY_CARD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-grid__wide">
            具体表现
            <textarea
              onChange={(event) => setManifestation(event.target.value)}
              rows={3}
              value={manifestation}
            />
          </label>
          <label className="form-grid__wide">
            我一开始以为的问题
            <textarea
              onChange={(event) => setAssumedProblem(event.target.value)}
              rows={3}
              value={assumedProblem}
            />
          </label>
          <label
            className="form-grid__wide"
            aria-describedby="cause-hypothesis-help"
          >
            当前原因假设（待复测）
            <textarea
              aria-label="当前原因假设（待复测）"
              onChange={(event) => setCauseHypothesis(event.target.value)}
              rows={3}
              value={causeHypothesis}
            />
            <span className="form-field-help" id="cause-hypothesis-help">
              这里只记录可被后续练习检验的假设，不把一次判断当成最终结论。
            </span>
          </label>
          <label className="form-grid__wide">
            下一步最小行动
            <textarea
              onChange={(event) => setNextMinimumAction(event.target.value)}
              rows={3}
              value={nextMinimumAction}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="button" disabled={saving} type="submit">
            {saving ? "正在保存" : "保存诊断"}
          </button>
          {diagnosisReceipt === null ? null : (
            <button
              className="button"
              disabled={generating}
              onClick={createCodexTask}
              type="button"
            >
              {generating ? "正在生成" : "生成 Codex 任务 Markdown"}
            </button>
          )}
        </div>
      </form>
      {diagnosisReceipt === null ? null : (
        <SaveReceipt
          at={diagnosisReceipt.modifiedAt}
          label="诊断已保存"
          path={diagnosisReceipt.relativePath}
        />
      )}
      {codexReceipt === null ? null : (
        <SaveReceipt
          at={codexReceipt.modifiedAt}
          label="Codex 任务已生成"
          path={codexReceipt.relativePath}
        />
      )}
    </section>
  );
}
