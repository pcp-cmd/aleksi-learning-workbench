import { CARD_LABELS } from "../../shared/card-labels";
import {
  PRIMARY_CARD_TYPES,
  type PrimaryCardType
} from "../../shared/card-types";
import {
  readGraphProjection,
  type GraphConceptState,
  type GraphStateDocument
} from "./graph-service";
import {
  listReadings,
  type ReadingListEntry
} from "./reading-service";
import {
  readReviewProjection,
  type ReviewQueueDocument
} from "./review-service";
import { activeLearningLibrary } from "../persistence/library-context";

export type TodayActionKind =
  | "due-review"
  | "remediation"
  | "graph-gap"
  | "continue-reading"
  | "new-reading";

export type TodayNextAction = {
  kind: TodayActionKind;
  title: string;
  reason: string;
  href: string;
  estimatedMinutes: number;
  concept: string | null;
  count: number;
};

export type TodayNextResponse = {
  nextAction: TodayNextAction;
  later: Array<{
    kind: TodayActionKind;
    title: string;
    href: string;
  }>;
};

type TodayInputs = {
  reviewQueue: ReviewQueueDocument;
  graph: GraphStateDocument;
  readings: ReadingListEntry[];
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedConceptStates(
  graph: GraphStateDocument
): GraphConceptState[] {
  return Object.values(graph.concepts).sort((left, right) =>
    compareText(left.concept, right.concept)
  );
}

function dueReviewAction(
  reviewQueue: ReviewQueueDocument
): TodayNextAction | null {
  const dueItems = reviewQueue.items
    .filter((item) => item.due)
    .sort(
      (left, right) =>
        compareText(left.nextReview, right.nextReview) ||
        compareText(left.cardId, right.cardId)
    );

  if (dueItems.length === 0) {
    return null;
  }

  const first = dueItems[0];
  return {
    kind: "due-review",
    title:
      dueItems.length === 1
        ? `复习 ${first.concept}`
        : `完成 ${dueItems.length} 张到期复习`,
    reason: "到期复习优先于继续输入新材料，先留下这次独立回忆证据。",
    href: "/review",
    estimatedMinutes: Math.min(25, Math.max(5, dueItems.length * 5)),
    concept: first.concept,
    count: dueItems.length
  };
}

function remediationAction(graph: GraphStateDocument): TodayNextAction | null {
  const blocked = sortedConceptStates(graph).filter(
    (state) => state.currentBlock !== null && state.nextAction.trim().length > 0
  );
  const first = blocked[0];

  if (first === undefined) {
    return null;
  }

  return {
    kind: "remediation",
    title: first.nextAction.trim(),
    reason: `${first.concept} 已有卡点和最小行动，先完成这一步再增加新内容。`,
    href: "/graph",
    estimatedMinutes: 10,
    concept: first.concept,
    count: blocked.length
  };
}

function isCoverageGap(
  state: GraphConceptState,
  type: PrimaryCardType
): boolean {
  return state.rings[type].coverage !== "established";
}

function coverageGapAction(graph: GraphStateDocument): TodayNextAction | null {
  const concepts = sortedConceptStates(graph);
  const gapCount = concepts.reduce(
    (count, state) =>
      count +
      PRIMARY_CARD_TYPES.filter((type) => isCoverageGap(state, type)).length,
    0
  );

  for (const state of concepts) {
    for (const type of PRIMARY_CARD_TYPES) {
      const ring = state.rings[type];
      if (ring.coverage === "established") {
        continue;
      }

      const verb = ring.coverage === "needs-repair" ? "重构" : "补齐";
      return {
        kind: "graph-gap",
        title: `${verb} ${state.concept} 的${CARD_LABELS[type].label}`,
        reason: `图谱显示这个${CARD_LABELS[type].shortLabel}证据仍不完整。`,
        href: "/graph",
        estimatedMinutes: 12,
        concept: state.concept,
        count: gapCount
      };
    }
  }

  return null;
}

function latestReadingAction(
  readings: ReadingListEntry[]
): TodayNextAction | null {
  const sorted = [...readings].sort(
    (left, right) =>
      compareText(right.updatedAt, left.updatedAt) ||
      compareText(left.id, right.id)
  );
  const latest = sorted[0];

  if (latest === undefined) {
    return null;
  }

  return {
    kind: "continue-reading",
    title: latest.title,
    reason: "当前没有更优先的复习或补洞，继续最近一次精读。",
    href: `/reader?reading=${encodeURIComponent(latest.id)}`,
    estimatedMinutes: 15,
    concept: latest.concept,
    count: readings.length
  };
}

function newReadingAction(): TodayNextAction {
  return {
    kind: "new-reading",
    title: "开始一篇新精读",
    reason: "当前闭环已经清空，可以从一段真正想读懂的材料开始。",
    href: "/reader",
    estimatedMinutes: 15,
    concept: null,
    count: 1
  };
}

export function selectTodayNextResponse(
  inputs: TodayInputs
): TodayNextResponse {
  const actions = [
    dueReviewAction(inputs.reviewQueue),
    remediationAction(inputs.graph),
    coverageGapAction(inputs.graph),
    latestReadingAction(inputs.readings),
    newReadingAction()
  ].filter((action): action is TodayNextAction => action !== null);
  const [nextAction, ...laterActions] = actions;

  return {
    nextAction,
    later: laterActions.map(({ kind, title, href }) => ({ kind, title, href }))
  };
}

export async function getTodayNext(): Promise<TodayNextResponse> {
  const vaultPath = await activeLearningLibrary();
  const reviewQueue = await readReviewProjection(vaultPath);
  const graph = await readGraphProjection(vaultPath);
  const readings = await listReadings();

  return selectTodayNextResponse({ reviewQueue, graph, readings });
}
