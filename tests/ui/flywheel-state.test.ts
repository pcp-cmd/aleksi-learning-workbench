import { describe, expect, it } from "vitest";
import {
  deriveFlywheelStages,
  flywheelCoverage,
  primaryFlywheelStage,
  type GraphConceptState
} from "../../src/features/graph/flywheel-state";

function ring(
  count: number,
  coverage: GraphConceptState["rings"]["concept"]["coverage"],
  learningStatus: GraphConceptState["rings"]["concept"]["learningStatus"],
  evidenceConfidence: GraphConceptState["rings"]["concept"]["evidenceConfidence"] = "unverified"
) {
  return { count, coverage, learningStatus, evidenceConfidence };
}

function conceptState(): GraphConceptState {
  return {
    concept: "积分",
    rings: {
      concept: ring(2, "established", "learning"),
      example: ring(0, "missing", "not-started"),
      boundary: ring(1, "needs-repair", "needs-repair"),
      process: ring(1, "established", "established", "supported"),
      mistake: ring(1, "established", "due-for-review", "under-review")
    },
    currentBlock: "transfer",
    remediationTargetCardType: null,
    nextAction: "补 1 张例子卡",
    hasDueReview: true,
    relatedConcepts: [],
    suggestedNextActions: ["补 1 张例子卡"]
  };
}

describe("flywheel state projection", () => {
  it("keeps structural coverage, learning status, and evidence confidence separate", () => {
    const stages = deriveFlywheelStages(conceptState());

    expect(
      stages.map(({ coverage, learningStatus, evidenceConfidence }) => ({
        coverage,
        learningStatus,
        evidenceConfidence
      }))
    ).toEqual([
      { coverage: "established", learningStatus: "learning", evidenceConfidence: "unverified" },
      { coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
      { coverage: "needs-repair", learningStatus: "needs-repair", evidenceConfidence: "unverified" },
      { coverage: "established", learningStatus: "established", evidenceConfidence: "supported" },
      { coverage: "established", learningStatus: "due-for-review", evidenceConfidence: "under-review" }
    ]);
    expect(primaryFlywheelStage(stages)).toBe("example");
    expect(flywheelCoverage(stages)).toEqual({
      established: 3,
      needsRepair: 1,
      total: 5
    });
  });

  it("does not fabricate learning progress for an actionable but missing stage", () => {
    const stages = deriveFlywheelStages({
      ...conceptState(),
      rings: {
        concept: ring(1, "established", "learning"),
        example: ring(0, "missing", "not-started"),
        boundary: ring(0, "missing", "not-started"),
        process: ring(0, "missing", "not-started"),
        mistake: ring(0, "missing", "not-started")
      }
    });

    expect(stages[1].recommended).toBe(true);
    expect(stages.slice(1).every((stage) => stage.learningStatus === "not-started")).toBe(true);
  });
});
