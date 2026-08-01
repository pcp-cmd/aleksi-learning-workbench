import { CARD_LABELS } from "../../../shared/card-labels";
import {
  isCardType,
  type PrimaryCardType
} from "../../../shared/card-types";
import type { BlockType } from "../cards/card-draft";
import type { ReviewDraftCardContent } from "./review-draft-store";

export type ReviewFeedback = "forgot" | "fuzzy" | "known" | "fluent";
export type ReviewAssistanceLevel = "none" | "hint" | "source" | "ai";
export type ReviewConfidence = 1 | 2 | 3 | 4;
export type ReviewUiState =
  | "answering"
  | "saving-attempt"
  | "revealed"
  | "saving-result"
  | "saved";

export type ReviewCardContent = ReviewDraftCardContent;

export type ReviewQueueItem = {
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

export type ReviewQueueDocument = {
  generatedAt: string;
  items: ReviewQueueItem[];
};

export type ReviewAttemptResponse = {
  attemptId: string;
  attemptedAt: string;
  promptVersion: "recall-v1";
  replayed: boolean;
  revealedCard: ReviewCardContent;
};

export type ReviewAttemptRequest = {
  idempotencyKey: string;
  answer: string;
  declaredDontKnow: boolean;
  confidenceBeforeReveal: ReviewConfidence;
  durationMs: number;
  assistanceLevel: ReviewAssistanceLevel;
};

export type ReviewResultRequest = {
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

export type ReviewSubmitResponse = {
  result: {
    nextReview: string;
    nextMastery: string;
  };
};

export const REVIEW_DIAGNOSIS_DRAFT_STORAGE_KEY =
  "aleksi.reviewDiagnosisDraft";

export const CONFIDENCE_OPTIONS: Array<{
  label: string;
  value: ReviewConfidence;
}> = [
  { value: 1, label: "1 · 只是猜测" },
  { value: 2, label: "2 · 不太确定" },
  { value: 3, label: "3 · 比较有把握" },
  { value: 4, label: "4 · 很有把握" }
];

export const ASSISTANCE_OPTIONS: Array<{
  label: string;
  value: ReviewAssistanceLevel;
}> = [
  { value: "none", label: "无辅助" },
  { value: "hint", label: "看过提示" },
  { value: "source", label: "查看过原文" },
  { value: "ai", label: "使用过 AI" }
];

export const FEEDBACKS: Array<{
  label: string;
  value: ReviewFeedback;
}> = [
  { value: "forgot", label: "忘了" },
  { value: "fuzzy", label: "模糊" },
  { value: "known", label: "会了" },
  { value: "fluent", label: "很熟" }
];

export const BLOCK_TYPES: Array<{ label: string; value: BlockType }> = [
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

const TYPE_ANSWER_FIELDS: Record<
  string,
  Array<{ key: string; label: string }>
> = {
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

export function reviewCardTypeLabel(type: string): string {
  return isCardType(type) ? CARD_LABELS[type].label : type;
}

function answerValue(
  card: ReviewCardContent,
  key: string
): string | null {
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

export function answerEntries(card: ReviewCardContent) {
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

export function uuidV4(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "10000000-1000-4000-8000-100000000000".replace(
    /[018]/gu,
    (char) =>
      (
        Number(char) ^
        (crypto.getRandomValues(new Uint8Array(1))[0] &
          (15 >> (Number(char) / 4)))
      ).toString(16)
  );
}

export function boundedDuration(startedAt: number): number {
  return Math.min(86_400_000, Math.max(0, Date.now() - startedAt));
}
