import type { PrimaryCardType } from "../../../shared/card-types";

export type StructuralCoverage = "missing" | "established" | "needs-repair";
export type LearningStatus =
  | "not-started"
  | "established"
  | "learning"
  | "due-for-review"
  | "verified"
  | "needs-repair";
export type EvidenceConfidence =
  | "unverified"
  | "supported"
  | "independently-supported"
  | "under-review";

export type GraphRing = {
  count: number;
  coverage: StructuralCoverage;
  learningStatus: LearningStatus;
  evidenceConfidence: EvidenceConfidence;
};

export type GraphConceptState = {
  concept: string;
  rings: {
    concept: GraphRing;
    example: GraphRing;
    boundary: GraphRing;
    process: GraphRing;
    mistake: GraphRing;
  };
  currentBlock: string | null;
  remediationTargetCardType: PrimaryCardType | null;
  nextAction: string;
  hasDueReview: boolean;
  relatedConcepts: string[];
  suggestedNextActions: string[];
};

export const FLYWHEEL_STAGE_ORDER = [
  { key: "concept", label: "概念", description: "说清定义、意义与自己的理解" },
  { key: "example", label: "例子", description: "用典型情境检验理解与应用" },
  { key: "boundary", label: "边界", description: "辨认适用范围、反例与限制" },
  { key: "process", label: "流程", description: "整理解决问题的步骤与关键转折" },
  { key: "mistake", label: "错误", description: "识别误区、原因与下一次识别信号" }
] as const;

export type FlywheelStageKey = (typeof FLYWHEEL_STAGE_ORDER)[number]["key"];

export type FlywheelStageView = {
  key: FlywheelStageKey;
  index: number;
  label: string;
  description: string;
  count: number;
  coverage: StructuralCoverage;
  coverageLabel: string;
  learningStatus: LearningStatus;
  learningStatusLabel: string;
  evidenceConfidence: EvidenceConfidence;
  evidenceConfidenceLabel: string;
  recommended: boolean;
};

export const COVERAGE_LABELS: Record<StructuralCoverage, string> = {
  missing: "未建立",
  established: "已建立",
  "needs-repair": "需修复"
};

export const LEARNING_STATUS_LABELS: Record<LearningStatus, string> = {
  "not-started": "未开始",
  established: "已建立",
  learning: "学习中",
  "due-for-review": "今日待复习",
  verified: "已验证",
  "needs-repair": "需修复"
};

export const EVIDENCE_CONFIDENCE_LABELS: Record<EvidenceConfidence, string> = {
  unverified: "证据待验证",
  supported: "有支持证据",
  "independently-supported": "有独立证据",
  "under-review": "证据受影响"
};

const ACTION_HINTS: Record<FlywheelStageKey, string[]> = {
  concept: ["概念", "定义"],
  example: ["例子", "案例"],
  boundary: ["边界", "反例", "限制"],
  process: ["流程", "步骤"],
  mistake: ["错误", "误区", "错题"]
};

function actionStage(action: string): FlywheelStageKey | null {
  for (const stage of FLYWHEEL_STAGE_ORDER) {
    if (ACTION_HINTS[stage.key].some((hint) => action.includes(hint))) {
      return stage.key;
    }
  }
  return null;
}

export function deriveFlywheelStages(
  concept: GraphConceptState
): FlywheelStageView[] {
  const recommendedStage = actionStage(concept.nextAction);

  return FLYWHEEL_STAGE_ORDER.map((stage, index) => {
    const ring = concept.rings[stage.key];
    return {
      key: stage.key,
      index: index + 1,
      label: stage.label,
      description: stage.description,
      count: ring.count,
      coverage: ring.coverage,
      coverageLabel: COVERAGE_LABELS[ring.coverage],
      learningStatus: ring.learningStatus,
      learningStatusLabel: LEARNING_STATUS_LABELS[ring.learningStatus],
      evidenceConfidence: ring.evidenceConfidence,
      evidenceConfidenceLabel:
        EVIDENCE_CONFIDENCE_LABELS[ring.evidenceConfidence],
      recommended: recommendedStage === stage.key
    };
  });
}

export function primaryFlywheelStage(
  stages: FlywheelStageView[]
): FlywheelStageKey {
  return (
    stages.find((stage) => stage.recommended) ??
    stages.find((stage) => stage.learningStatus === "due-for-review") ??
    stages.find((stage) => stage.coverage === "needs-repair") ??
    stages.find((stage) => stage.coverage === "missing") ??
    stages[0]
  )?.key ?? "concept";
}

export function flywheelCoverage(stages: FlywheelStageView[]): {
  established: number;
  needsRepair: number;
  total: number;
} {
  return {
    established: stages.filter((stage) => stage.coverage === "established").length,
    needsRepair: stages.filter((stage) => stage.coverage === "needs-repair").length,
    total: stages.length
  };
}
