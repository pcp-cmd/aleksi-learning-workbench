import { FormEvent, useEffect, useState } from "react";
import { SaveReceipt } from "../../components/SaveReceipt";
import { StatusDot } from "../../components/StatusDot";
import { useUnsavedChanges } from "../../lib/unsaved-guard";
import { CARD_LABELS } from "../../../shared/card-labels";
import { CARD_TYPES } from "../../../shared/card-types";
import type { BlockType, CardDraft, CardType } from "./card-draft";
import { CardSectionNav } from "./CardSectionNav";
import {
  CARD_SAVE_BUTTON_LABELS,
  CARD_SAVE_STATE_LABELS,
  type CardSaveState
} from "./card-save-state";

type SavedCardReceipt = {
  absolutePath: string;
  modifiedAt: string;
  relativePath: string;
};

export interface CardEditorProps {
  draft: CardDraft;
  onChange: (draft: CardDraft) => void;
  onSave: () => Promise<void>;
  receipt: SavedCardReceipt | null;
  saveState: CardSaveState;
}

const CARD_TYPE_LABELS: Record<CardType, string> = Object.fromEntries(
  CARD_TYPES.map((type) => [type, CARD_LABELS[type].label])
) as Record<CardType, string>;

const ALL_CARD_TYPES: CardType[] = [...CARD_TYPES];

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

const CANDIDATE_ACTIONS = [
  {
    label: "复制到“重述理解”",
    field: "understanding",
    allowed: ALL_CARD_TYPES,
    targetLabel: "重述理解"
  },
  {
    label: "复制到“我自己的理解”",
    field: "myUnderstanding",
    allowed: ["concept"] as CardType[],
    targetLabel: "我自己的理解"
  },
  {
    label: "复制到“例子内容”",
    field: "exampleContent",
    allowed: ["example"] as CardType[],
    targetLabel: "例子内容"
  },
  {
    label: "复制到“反例内容”",
    field: "counterexampleContent",
    allowed: ["counterexample"] as CardType[],
    targetLabel: "反例内容"
  },
  {
    label: "复制到“下一步行动”",
    field: "nextAction",
    allowed: ALL_CARD_TYPES,
    targetLabel: "下一步行动"
  },
  {
    label: "复制到“证明骨架”",
    field: "proofOutline",
    allowed: ["proof"] as CardType[],
    targetLabel: "证明骨架"
  }
] as const;

function splitRelatedConcepts(value: string): string[] {
  return value
    .split(/[,，]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function LearningStepHeading({
  note,
  title
}: {
  note: string;
  title: string;
}) {
  return (
    <div className="card-editor__step-heading">
      <h2>{title}</h2>
      <p>{note}</p>
    </div>
  );
}

export function CardEditor({
  draft,
  onChange,
  onSave,
  receipt,
  saveState
}: CardEditorProps) {
  const [candidate, setCandidate] = useState("");
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);
  const relatedConceptsText = draft.relatedConcepts.join("，");
  useUnsavedChanges(candidate.length > 0);
  const canSave =
    draft.title.trim().length > 0 &&
    draft.concept.trim().length > 0 &&
    draft.sourceReadingId.trim().length > 0 &&
    draft.excerpt.trim().length > 0;

  useEffect(() => {
    const handleShortcutSave = () => {
      if (
        canSave &&
        saveState !== "saving" &&
        saveState !== "saved"
      ) {
        void onSave();
      }
    };
    window.addEventListener("aleksi:save-current", handleShortcutSave);
    return () => {
      window.removeEventListener("aleksi:save-current", handleShortcutSave);
    };
  }, [canSave, onSave, saveState]);

  useEffect(() => {
    if (saveState === "saved") {
      setCandidate("");
      setClipboardStatus(null);
    }
  }, [saveState]);

  const update = (field: string, value: unknown) => {
    onChange({ ...draft, [field]: value } as CardDraft);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave();
  };

  const copyCandidate = (field: string) => {
    if (candidate.length === 0) {
      return;
    }
    update(field, candidate);
  };

  const copyCandidateToClipboard = async () => {
    if (candidate.length === 0) {
      return;
    }

    try {
      await navigator.clipboard.writeText(candidate);
      setClipboardStatus("候选内容已复制到剪贴板。");
    } catch {
      setClipboardStatus("剪贴板不可用，请手动复制候选内容。");
    }
  };

  return (
    <form className="card-editor card-editor--learning-flow" onSubmit={submit}>
      <CardSectionNav />
      <section
        aria-label="卡片保存状态"
        aria-live="polite"
        className={`card-save-state card-save-state--${saveState}`}
        role="status"
      >
        <StatusDot
          label={CARD_SAVE_STATE_LABELS[saveState]}
          tone={
            saveState === "save-failed"
              ? "blocked"
              : saveState === "saved"
                ? "active"
                : "idle"
          }
        />
        {receipt === null ? null : (
          <SaveReceipt
            at={receipt.modifiedAt}
            label="最近保存"
            path={receipt.relativePath}
          />
        )}
      </section>
      <section
        className="surface-static card-editor__section card-editor__step card-editor__step--source"
        id="card-source"
      >
        <LearningStepHeading
          note="先确认来源、概念和原文摘录，卡片从真实阅读对象开始。"
          title="① 原文"
        />
        <StatusDot label={`${CARD_TYPE_LABELS[draft.type]}草稿`} tone="active" />
        <div className="form-grid">
          <label>
            标题
            <input
              onChange={(event) => update("title", event.target.value)}
              value={draft.title}
            />
          </label>
          <label>
            概念
            <input
              onChange={(event) => update("concept", event.target.value)}
              value={draft.concept}
            />
          </label>
          <label className="form-grid__wide">
            原文摘录
            <textarea
              onChange={(event) => update("excerpt", event.target.value)}
              rows={3}
              value={draft.excerpt}
            />
          </label>
        </div>
        <details className="card-editor__advanced">
          <summary>来源与分类设置</summary>
          <div className="form-grid">
            <label>
              相关概念
              <input
                onChange={(event) => update("relatedConcepts", splitRelatedConcepts(event.target.value))}
                placeholder="用逗号分隔"
                value={relatedConceptsText}
              />
            </label>
            <label>
              当前卡点
              <select
                onChange={(event) => update("blockType", event.target.value === "" ? null : (event.target.value as BlockType))}
                value={draft.blockType ?? ""}
              >
                <option value="">暂不记录</option>
                {BLOCK_TYPES.map((blockType) => <option key={blockType.value} value={blockType.value}>{blockType.label}</option>)}
              </select>
            </label>
          </div>
          <dl className="draft-meta">
            <div><dt>来源材料</dt><dd>{draft.sourcePath || "尚未选择来源材料"}</dd></div>
            <div><dt>草稿创建时间</dt><dd>{draft.createdAt}</dd></div>
            <div><dt>初始复习日期</dt><dd>{draft.nextReview}</dd></div>
          </dl>
        </details>
      </section>

      <section
        className="surface-static card-editor__section card-editor__step card-editor__step--restatement"
        id="card-restatement"
      >
        <LearningStepHeading
          note="把摘录改写成自己的话；候选内容只是临时脚手架，不替你完成理解。"
          title="② 我的重述"
        />
        <label>
          我的理解
          <textarea
            onChange={(event) => update("understanding", event.target.value)}
            rows={3}
            value={draft.understanding}
          />
        </label>
      </section>

      <div
        className="card-editor__step card-editor__step--structured"
        id="card-structured"
      >
        <LearningStepHeading
          note="再把理解沉淀进对应卡型字段，保留原来的八类卡片契约。"
          title="③ 结构化卡片"
        />
        <TypeSpecificFields draft={draft} update={update} />
      </div>

      <details className="surface-static card-editor__advanced card-editor__candidate">
        <summary>候选内容脚手架</summary>
        <div className="card-editor__advanced-body">
        <StatusDot label="临时内容，不会替你完成理解" />
        <label>
          候选内容
          <textarea
            onChange={(event) => setCandidate(event.target.value)}
            rows={5}
            value={candidate}
          />
        </label>
        <div className="candidate-actions">
          {CANDIDATE_ACTIONS.filter((action) => action.allowed.includes(draft.type)).map(
            (action) => (
              <button
                className="button"
                key={action.label}
                onClick={() => copyCandidate(action.field)}
                type="button"
              >
                {action.label}
              </button>
            )
          )}
          <button
            className="button button-ghost"
            disabled={candidate.length === 0}
            onClick={copyCandidateToClipboard}
            type="button"
          >
            复制候选内容
          </button>
          <button
            className="button button-ghost"
            onClick={() => setCandidate("")}
            type="button"
          >
            丢弃
          </button>
        </div>
        {clipboardStatus === null ? null : (
          <p className="save-feedback">{clipboardStatus}</p>
        )}
        </div>
      </details>

      <section
        className="surface-static card-editor__section card-editor__step card-editor__step--next-action"
        id="card-next-action"
      >
        <LearningStepHeading
          note="最后写下最小下一步，让卡片进入复习或补洞闭环。"
          title="④ 下一步行动"
        />
        <label>
          下一步行动
          <textarea
            onChange={(event) => update("nextAction", event.target.value)}
            rows={2}
            value={draft.nextAction}
          />
        </label>
        <div className="form-actions">
          <button
            className="button card-editor__save-button"
            disabled={saveState === "saving" || saveState === "saved" || !canSave}
            type="submit"
          >
            {CARD_SAVE_BUTTON_LABELS[saveState]}
          </button>
        </div>
      </section>
    </form>
  );
}

function TypeSpecificFields({
  draft,
  update
}: {
  draft: CardDraft;
  update: (field: string, value: unknown) => void;
}) {
  if (draft.type === "concept") {
    return (
      <section className="surface-static card-editor__section">
        <StatusDot label="概念卡字段" />
        <div className="form-grid">
          <label className="form-grid__wide">
            正式解释
            <textarea
              onChange={(event) => update("formalExplanation", event.target.value)}
              rows={3}
              value={draft.formalExplanation}
            />
          </label>
          <label className="form-grid__wide">
            我自己的理解
            <textarea
              onChange={(event) => update("myUnderstanding", event.target.value)}
              rows={3}
              value={draft.myUnderstanding}
            />
          </label>
          <label>
            常见误解
            <textarea
              onChange={(event) =>
                update("commonMisunderstanding", event.target.value)
              }
              rows={2}
              value={draft.commonMisunderstanding}
            />
          </label>
          <label>
            使用场景
            <textarea
              onChange={(event) => update("usageContext", event.target.value)}
              rows={2}
              value={draft.usageContext}
            />
          </label>
        </div>
      </section>
    );
  }

  if (draft.type === "definition") {
    return (
      <section className="surface-static card-editor__section">
        <StatusDot label="定义卡字段" />
        <div className="form-grid">
          <label className="form-grid__wide">
            正式定义
            <textarea
              onChange={(event) => update("formalDefinition", event.target.value)}
              rows={3}
              value={draft.formalDefinition}
            />
          </label>
          <label className="form-grid__wide">
            大白话解释
            <textarea
              onChange={(event) => update("plainExplanation", event.target.value)}
              rows={3}
              value={draft.plainExplanation}
            />
          </label>
          <label>
            量词结构
            <textarea
              onChange={(event) => update("quantifierStructure", event.target.value)}
              rows={2}
              value={draft.quantifierStructure}
            />
          </label>
          <label>
            常见误解
            <textarea
              onChange={(event) =>
                update("commonMisunderstandings", event.target.value)
              }
              rows={2}
              value={draft.commonMisunderstandings}
            />
          </label>
        </div>
      </section>
    );
  }

  if (draft.type === "example") {
    return (
      <section className="surface-static card-editor__section">
        <StatusDot label="例子卡字段" />
        <div className="form-grid">
          <label className="form-grid__wide">
            例子内容
            <textarea
              onChange={(event) => update("exampleContent", event.target.value)}
              rows={3}
              value={draft.exampleContent}
            />
          </label>
          <label>
            为什么它符合
            <textarea
              onChange={(event) => update("whyItFits", event.target.value)}
              rows={2}
              value={draft.whyItFits}
            />
          </label>
          <label>
            它训练我什么
            <textarea
              onChange={(event) => update("trainingPurpose", event.target.value)}
              rows={2}
              value={draft.trainingPurpose}
            />
          </label>
        </div>
      </section>
    );
  }

  if (draft.type === "boundary") {
    return (
      <section className="surface-static card-editor__section">
        <StatusDot label="边界卡字段" />
        <div className="form-grid">
          <label className="form-grid__wide">
            易混对象
            <textarea
              onChange={(event) => update("confusingObjects", event.target.value)}
              rows={3}
              value={draft.confusingObjects}
            />
          </label>
          <label>
            相似之处
            <textarea
              onChange={(event) => update("similarity", event.target.value)}
              rows={2}
              value={draft.similarity}
            />
          </label>
          <label>
            关键区别
            <textarea
              onChange={(event) => update("keyDifference", event.target.value)}
              rows={2}
              value={draft.keyDifference}
            />
          </label>
          <label className="form-grid__wide">
            判断标准
            <textarea
              onChange={(event) => update("judgementRule", event.target.value)}
              rows={3}
              value={draft.judgementRule}
            />
          </label>
        </div>
      </section>
    );
  }

  if (draft.type === "counterexample") {
    return (
      <section className="surface-static card-editor__section">
        <StatusDot label="反例卡字段" />
        <div className="form-grid">
          <label className="form-grid__wide">
            反例内容
            <textarea
              onChange={(event) =>
                update("counterexampleContent", event.target.value)
              }
              rows={3}
              value={draft.counterexampleContent}
            />
          </label>
          <label>
            它破坏了哪个条件
            <textarea
              onChange={(event) => update("brokenCondition", event.target.value)}
              rows={2}
              value={draft.brokenCondition}
            />
          </label>
          <label>
            为什么它不是
            <textarea
              onChange={(event) => update("whyItIsNot", event.target.value)}
              rows={2}
              value={draft.whyItIsNot}
            />
          </label>
        </div>
      </section>
    );
  }

  if (draft.type === "process") {
    return (
      <section className="surface-static card-editor__section">
        <StatusDot label="流程卡字段" />
        <div className="form-grid">
          <label className="form-grid__wide">
            任务
            <textarea
              onChange={(event) => update("task", event.target.value)}
              rows={2}
              value={draft.task}
            />
          </label>
          <label className="form-grid__wide">
            步骤
            <textarea
              onChange={(event) => update("steps", event.target.value)}
              rows={3}
              value={draft.steps}
            />
          </label>
          <label>
            关键转折
            <textarea
              onChange={(event) => update("keyTurn", event.target.value)}
              rows={2}
              value={draft.keyTurn}
            />
          </label>
          <label>
            易错点
            <textarea
              onChange={(event) => update("pitfall", event.target.value)}
              rows={2}
              value={draft.pitfall}
            />
          </label>
          <label className="form-grid__wide">
            使用场景
            <textarea
              onChange={(event) => update("usageContext", event.target.value)}
              rows={2}
              value={draft.usageContext}
            />
          </label>
        </div>
      </section>
    );
  }

  if (draft.type === "mistake") {
    return (
      <section className="surface-static card-editor__section">
        <StatusDot label="错误卡字段" />
        <div className="form-grid">
          <label className="form-grid__wide">
            错误表现
            <textarea
              onChange={(event) => update("mistake", event.target.value)}
              rows={3}
              value={draft.mistake}
            />
          </label>
          <label>
            原来怎么想
            <textarea
              onChange={(event) => update("originalThinking", event.target.value)}
              rows={2}
              value={draft.originalThinking}
            />
          </label>
          <label>
            真正原因
            <textarea
              onChange={(event) => update("realCause", event.target.value)}
              rows={2}
              value={draft.realCause}
            />
          </label>
          <label className="form-grid__wide">
            正确方法
            <textarea
              onChange={(event) => update("correctMethod", event.target.value)}
              rows={3}
              value={draft.correctMethod}
            />
          </label>
          <label className="form-grid__wide">
            识别信号
            <textarea
              onChange={(event) => update("recognitionSignal", event.target.value)}
              rows={2}
              value={draft.recognitionSignal}
            />
          </label>
        </div>
      </section>
    );
  }

  return (
    <section className="surface-static card-editor__section">
      <StatusDot label="证明卡字段" />
      <div className="form-grid">
        <label className="form-grid__wide">
          命题内容
          <textarea
            onChange={(event) => update("proposition", event.target.value)}
            rows={2}
            value={draft.proposition}
          />
        </label>
        <label>
          我的第一次尝试
          <textarea
            onChange={(event) => update("firstAttempt", event.target.value)}
            rows={2}
            value={draft.firstAttempt}
          />
        </label>
        <label>
          关键动作
          <textarea
            onChange={(event) => update("keyMove", event.target.value)}
            rows={2}
            value={draft.keyMove}
          />
        </label>
        <label className="form-grid__wide">
          证明骨架
          <textarea
            onChange={(event) => update("proofOutline", event.target.value)}
            rows={3}
            value={draft.proofOutline}
          />
        </label>
        <label className="form-grid__wide">
          失败原因
          <textarea
            onChange={(event) => update("failureReason", event.target.value)}
            rows={2}
            value={draft.failureReason}
          />
        </label>
      </div>
    </section>
  );
}
