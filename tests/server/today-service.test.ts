import { describe, expect, it } from "vitest";
import type {
  GraphConceptState,
  GraphStateDocument
} from "../../server/services/graph-service";
import { selectTodayNextResponse } from "../../server/services/today-service";

type TodayInputs = Parameters<typeof selectTodayNextResponse>[0];
type ReviewItem = TodayInputs["reviewQueue"]["items"][number];

const GENERATED_AT = "2026-07-12T02:00:00.000Z";
const SOURCE_FINGERPRINT = "a".repeat(64);

function reviewItem(options: {
  cardId: string;
  concept: string;
  nextReview: string;
  due?: boolean;
}): ReviewItem {
  return {
    cardId: options.cardId,
    cardPath: `02-概念卡/${options.cardId}.md`,
    cardType: "concept",
    concept: options.concept,
    mastery: "learning",
    nextReview: options.nextReview,
    lastReviewSequence: null,
    lastReviewed: null,
    due: options.due ?? true,
    prompt: `Recall ${options.concept}`
  } as unknown as ReviewItem;
}

function rings(
  overrides: Partial<GraphConceptState["rings"]> = {}
): GraphConceptState["rings"] {
  return {
    concept: establishedRing(),
    example: establishedRing(),
    boundary: establishedRing(),
    process: establishedRing(),
    mistake: establishedRing(),
    ...overrides
  };
}

function establishedRing(): GraphConceptState["rings"]["concept"] {
  return {
    count: 1,
    coverage: "established",
    learningStatus: "learning",
    evidenceConfidence: "unverified"
  };
}

function missingRing(): GraphConceptState["rings"]["concept"] {
  return {
    count: 0,
    coverage: "missing",
    learningStatus: "not-started",
    evidenceConfidence: "unverified"
  };
}

function repairRing(): GraphConceptState["rings"]["concept"] {
  return {
    count: 1,
    coverage: "needs-repair",
    learningStatus: "needs-repair",
    evidenceConfidence: "unverified"
  };
}

function conceptState(options: {
  concept: string;
  currentBlock?: GraphConceptState["currentBlock"];
  remediationTargetCardType?: GraphConceptState["remediationTargetCardType"];
  nextAction?: string;
  rings?: GraphConceptState["rings"];
}): GraphConceptState {
  return {
    concept: options.concept,
    rings: options.rings ?? rings(),
    currentBlock: options.currentBlock ?? null,
    remediationTargetCardType: options.remediationTargetCardType ?? null,
    nextAction: options.nextAction ?? "",
    hasDueReview: false,
    relatedConcepts: [],
    suggestedNextActions: []
  };
}

function graph(
  concepts: Record<string, GraphConceptState> = {}
): GraphStateDocument {
  return {
    generatedAt: GENERATED_AT,
    sourceIndexFingerprint: SOURCE_FINGERPRINT,
    concepts
  };
}

function inputs(overrides: Partial<TodayInputs> = {}): TodayInputs {
  return {
    reviewQueue: {
      generatedAt: GENERATED_AT,
      sourceIndexFingerprint: SOURCE_FINGERPRINT,
      items: []
    },
    graph: graph(),
    readings: [],
    ...overrides
  };
}

describe("Today next-action selection", () => {
  it("always selects a due review before graph and reading candidates", () => {
    const state = conceptState({
      concept: "Alpha",
      currentBlock: "definition",
      nextAction: "Do the saved remediation",
      rings: rings({ example: missingRing() })
    });
    const result = selectTodayNextResponse(
      inputs({
        reviewQueue: {
          generatedAt: GENERATED_AT,
          sourceIndexFingerprint: SOURCE_FINGERPRINT,
          items: [
            reviewItem({
              cardId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              concept: "Later by id",
              nextReview: "2026-07-11"
            }),
            reviewItem({
              cardId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              concept: "First due",
              nextReview: "2026-07-11"
            })
          ]
        },
        graph: graph({ Alpha: state }),
        readings: [
          {
            id: "reading-b",
            type: "reading",
            title: "Latest reading",
            concept: "Reading",
            relativePath: "01-阅读材料/latest.md",
            updatedAt: GENERATED_AT
          }
        ]
      })
    );

    expect(result.nextAction).toMatchObject({
      kind: "due-review",
      concept: "First due",
      href: "/review",
      count: 2
    });
    expect(result.later.map((action) => action.kind)).toEqual([
      "remediation",
      "graph-gap",
      "continue-reading",
      "new-reading"
    ]);
  });

  it("selects graph remediation deterministically by concept, independent of object order", () => {
    const alpha = conceptState({
      concept: "Alpha",
      currentBlock: "proof-search",
      nextAction: "Alpha action"
    });
    const beta = conceptState({
      concept: "Beta",
      currentBlock: "technical",
      nextAction: "Beta action"
    });

    const left = selectTodayNextResponse(
      inputs({ graph: graph({ Beta: beta, Alpha: alpha }) })
    );
    const right = selectTodayNextResponse(
      inputs({ graph: graph({ Alpha: alpha, Beta: beta }) })
    );

    expect(left.nextAction).toMatchObject({
      kind: "remediation",
      concept: "Alpha",
      count: 2,
      href: "/graph?concept=Alpha&stage=concept"
    });
    expect(right.nextAction).toEqual(left.nextAction);
  });

  it("uses the structured diagnosis target before ring gaps and action wording", () => {
    const state = conceptState({
      concept: "Alpha",
      currentBlock: "proof-search",
      remediationTargetCardType: "process",
      nextAction: "补一张例子卡，但这是会误导旧文本解析的自然语言。",
      rings: rings({ example: missingRing() })
    });

    const result = selectTodayNextResponse(
      inputs({ graph: graph({ Alpha: state }) })
    );

    expect(result.nextAction).toMatchObject({
      kind: "remediation",
      href: "/graph?concept=Alpha&stage=process"
    });
  });

  it("falls back to the first structural gap when a legacy diagnosis has no target", () => {
    const state = conceptState({
      concept: "Alpha",
      currentBlock: "proof-search",
      remediationTargetCardType: null,
      nextAction: "请先整理流程卡措辞，但不要用文本猜目标。",
      rings: rings({ example: missingRing(), process: missingRing() })
    });

    const result = selectTodayNextResponse(
      inputs({ graph: graph({ Alpha: state }) })
    );

    expect(result.nextAction).toMatchObject({
      kind: "remediation",
      href: "/graph?concept=Alpha&stage=example"
    });
  });

  it("uses structured ring state for a deterministic graph gap, then the latest reading", () => {
    const alpha = conceptState({
      concept: "Alpha",
      rings: rings({ concept: missingRing() })
    });
    const beta = conceptState({
      concept: "Beta",
      rings: rings({ mistake: repairRing() })
    });
    const readings: TodayInputs["readings"] = [
      {
        id: "reading-b",
        type: "reading",
        title: "Same time, later id",
        concept: "Beta",
        relativePath: "01-阅读材料/b.md",
        updatedAt: GENERATED_AT
      },
      {
        id: "reading-a",
        type: "reading",
        title: "Same time, first id",
        concept: "Alpha",
        relativePath: "01-阅读材料/a.md",
        updatedAt: GENERATED_AT
      }
    ];

    const withGap = selectTodayNextResponse(
      inputs({ graph: graph({ Beta: beta, Alpha: alpha }), readings })
    );
    expect(withGap.nextAction).toMatchObject({
      kind: "graph-gap",
      concept: "Alpha",
      count: 2,
      href: "/graph?concept=Alpha&stage=concept"
    });

    const withoutGap = selectTodayNextResponse(
      inputs({ readings: [...readings].reverse() })
    );
    expect(withoutGap.nextAction).toMatchObject({
      kind: "continue-reading",
      concept: "Alpha",
      href: "/reader?reading=reading-a",
      count: 2
    });
  });

  it("falls back to a new reading when the loop has no review, graph, or reading work", () => {
    const result = selectTodayNextResponse(inputs());

    expect(result).toEqual({
      nextAction: {
        kind: "new-reading",
        title: "开始一篇新精读",
        reason: "当前闭环已经清空，可以从一段真正想读懂的材料开始。",
        href: "/reader?import=today",
        estimatedMinutes: 15,
        concept: null,
        count: 1
      },
      later: []
    });
  });
});
