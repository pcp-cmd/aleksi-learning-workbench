import { boundedMap } from "../lib/bounded-map";
import { readBoundedRegularFile } from "../lib/bounded-regular-file";
import { IoBudget } from "../lib/io-budget";
import matter from "gray-matter";
import { z } from "zod";
import { blockTypeSchema, isoUtcMillisecondsSchema } from "../domain/schemas";
import type { BlockType, CardRecord, CardType } from "../domain/types";
import { atomicWriteText } from "../lib/atomic-write";
import { parseCardMarkdown } from "../lib/markdown-codec";
import { resolveInsideRoot } from "../lib/path-safety";
import { extractMarkdownValueUnit } from "../persistence/markdown-value";
import type { LibraryOperationContext } from "../persistence/library-context";
import { readProjectionFile } from "../projections/projection-file";
import {
  readIndexProjection,
  type IndexDocument,
  type IndexEntry
} from "./index-service";
import { CARD_TYPES, PRIMARY_CARD_TYPES } from "../../shared/card-types";
import { buildKnowledgeNodeProjection } from "./verification-projection";
import { readVerificationState } from "./verification-store";
import type {
  KnowledgeTrustState,
  VerificationState
} from "./verification-domain";

const GRAPH_STATE_PATH = ".aleksi/graph-state.json";
const GRAPH_SOURCE_LIMITS = {
  maxDepth: 1,
  maxFiles: 10_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxConcurrency: 8
} as const;

function graphIoBudget(): IoBudget {
  return new IoBudget({
    ...GRAPH_SOURCE_LIMITS,
    deadlineAt: Date.now() + 15_000
  });
}

async function readGraphSource(
  vaultPath: string,
  relativePath: string,
  budget: IoBudget
): Promise<string> {
  budget.checkpoint();
  const file = await readBoundedRegularFile(
    vaultPath,
    resolveInsideRoot(vaultPath, relativePath),
    {
      maxBytes: GRAPH_SOURCE_LIMITS.maxFileBytes,
      label: "Graph source"
    }
  );
  budget.claimFile(file.data.length, 0);
  return file.data.toString("utf8");
}

type GraphRingKey = (typeof PRIMARY_CARD_TYPES)[number];
export type StructuralCoverage = "missing" | "established" | "needs-repair";
export type GraphLearningStatus =
  | "not-started"
  | "established"
  | "learning"
  | "due-for-review"
  | "verified"
  | "needs-repair";

export type GraphRing = {
  count: number;
  coverage: StructuralCoverage;
  learningStatus: GraphLearningStatus;
  evidenceConfidence: KnowledgeTrustState;
};

export type GraphConceptState = {
  concept: string;
  rings: Record<GraphRingKey, GraphRing>;
  currentBlock: BlockType | null;
  nextAction: string;
  hasDueReview: boolean;
  relatedConcepts: string[];
  suggestedNextActions: string[];
};

export type GraphStateDocument = {
  generatedAt: string;
  sourceIndexFingerprint: string;
  concepts: Record<string, GraphConceptState>;
};

type ActiveCard = {
  entry: IndexEntry & {
    assetType: CardType;
    concept: string;
    nextReview: string;
  };
  card: CardRecord;
  concept: string;
};

type DiagnosisProjection = {
  id: string;
  concept: string;
  blockType: BlockType;
  createdAt: string;
  nextMinimumAction: string;
};

const diagnosisFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("diagnosis"),
    concept: z.string().min(1),
    blockType: blockTypeSchema,
    createdAt: isoUtcMillisecondsSchema
  })
  .passthrough();

const graphRingSchema = z
  .object({
    count: z.number().int().nonnegative(),
    coverage: z.enum(["missing", "established", "needs-repair"]),
    learningStatus: z.enum([
      "not-started",
      "established",
      "learning",
      "due-for-review",
      "verified",
      "needs-repair"
    ]),
    evidenceConfidence: z.enum([
      "unverified",
      "supported",
      "independently-supported",
      "under-review"
    ])
  })
  .strict();

const graphConceptStateSchema = z
  .object({
    concept: z.string().min(1),
    rings: z
      .object({
        concept: graphRingSchema,
        example: graphRingSchema,
        boundary: graphRingSchema,
        process: graphRingSchema,
        mistake: graphRingSchema
      })
      .strict(),
    currentBlock: blockTypeSchema.nullable(),
    nextAction: z.string(),
    hasDueReview: z.boolean(),
    relatedConcepts: z.array(z.string().min(1)),
    suggestedNextActions: z.array(z.string().min(1))
  })
  .strict();

const graphStateDocumentSchema = z
  .object({
    generatedAt: isoUtcMillisecondsSchema,
    sourceIndexFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    concepts: z.record(graphConceptStateSchema)
  })
  .strict();

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isCardAssetType(value: IndexEntry["assetType"]): value is CardType {
  return (CARD_TYPES as readonly string[]).includes(value);
}

function normalizeConcept(value: string): string {
  return value.trim().normalize("NFC");
}

function normalizeAction(value: string): string {
  return value.trim();
}

async function readCardForEntry(
  vaultPath: string,
  entry: ActiveCard["entry"],
  budget: IoBudget
): Promise<ActiveCard> {
  const raw = await readGraphSource(vaultPath, entry.relativePath, budget);
  const card = parseCardMarkdown(raw);

  return {
    entry,
    card,
    concept: normalizeConcept(card.concept)
  };
}

async function readDiagnosisForEntry(
  vaultPath: string,
  entry: IndexEntry,
  budget: IoBudget
): Promise<DiagnosisProjection | null> {
  const raw = await readGraphSource(vaultPath, entry.relativePath, budget);
  const parsed = matter(raw);
  const frontmatter = diagnosisFrontmatterSchema.safeParse(parsed.data);

  if (!frontmatter.success) {
    return null;
  }

  const nextMinimumAction = extractMarkdownValueUnit(
    raw,
    "下一步最小行动"
  );
  if (nextMinimumAction === null) {
    return null;
  }

  return {
    id: frontmatter.data.id,
    concept: normalizeConcept(frontmatter.data.concept),
    blockType: frontmatter.data.blockType,
    createdAt: frontmatter.data.createdAt,
    nextMinimumAction: normalizeAction(nextMinimumAction.value)
  };
}

function coverageKeyForCardType(type: CardType): GraphRingKey | null {
  switch (type) {
    case "concept":
    case "definition":
      return "concept";
    case "example":
      return "example";
    case "boundary":
    case "counterexample":
      return "boundary";
    case "process":
    case "proof":
      return "process";
    case "mistake":
      return "mistake";
  }
}

function aggregateEvidenceConfidence(
  cards: ActiveCard[],
  verificationState: VerificationState
): KnowledgeTrustState {
  const confidence = cards.map((item) =>
    buildKnowledgeNodeProjection(item.card.id, verificationState).trustState
  );

  if (confidence.includes("under-review")) return "under-review";
  if (confidence.includes("independently-supported")) {
    return "independently-supported";
  }
  if (confidence.includes("supported")) return "supported";
  return "unverified";
}

function ringFor(
  cards: ActiveCard[],
  today: string,
  verificationState: VerificationState
): GraphRing {
  if (cards.length === 0) {
    return {
      count: 0,
      coverage: "missing",
      learningStatus: "not-started",
      evidenceConfidence: "unverified"
    };
  }

  const needsRepair = cards.some((item) => item.card.mastery === "rebuild");
  const isDue = cards.some((item) => item.card.nextReview <= today);
  const evidenceConfidence = aggregateEvidenceConfidence(
    cards,
    verificationState
  );
  const learningStatus: GraphLearningStatus = needsRepair
    ? "needs-repair"
    : isDue
      ? "due-for-review"
      : cards.every((item) => item.card.mastery === "mastered")
        ? "verified"
        : evidenceConfidence === "supported" ||
            evidenceConfidence === "independently-supported"
          ? "established"
          : "learning";

  return {
    count: cards.length,
    coverage: needsRepair ? "needs-repair" : "established",
    learningStatus,
    evidenceConfidence
  };
}

function ringsFor(
  cards: ActiveCard[],
  today: string,
  verificationState: VerificationState
): Record<GraphRingKey, GraphRing> {
  const cardsByCoverage = new Map<GraphRingKey, ActiveCard[]>(
    PRIMARY_CARD_TYPES.map((type) => [type, [] as ActiveCard[]])
  );

  for (const card of cards) {
    const coverageKey = coverageKeyForCardType(card.card.type);
    if (coverageKey === null) {
      continue;
    }

    cardsByCoverage.get(coverageKey)?.push(card);
  }

  return {
    concept: ringFor(cardsByCoverage.get("concept") ?? [], today, verificationState),
    example: ringFor(cardsByCoverage.get("example") ?? [], today, verificationState),
    boundary: ringFor(cardsByCoverage.get("boundary") ?? [], today, verificationState),
    process: ringFor(cardsByCoverage.get("process") ?? [], today, verificationState),
    mistake: ringFor(cardsByCoverage.get("mistake") ?? [], today, verificationState)
  };
}

function suggestionsFor(
  rings: Record<GraphRingKey, GraphRing>,
  hasDueReview: boolean
): string[] {
  const suggestions: string[] = [];

  const add = (condition: boolean, value: string) => {
    if (condition && !suggestions.includes(value)) {
      suggestions.push(value);
    }
  };

  add(rings.concept.coverage === "missing", "补 1 张概念卡");
  add(rings.concept.coverage === "needs-repair", "重构概念卡");
  add(rings.example.coverage === "missing", "补 1 张例子卡");
  add(rings.example.coverage === "needs-repair", "重构例子卡");
  add(rings.boundary.coverage === "missing", "补 1 张边界卡");
  add(rings.boundary.coverage === "needs-repair", "重构边界卡");
  add(rings.process.coverage === "missing", "补 1 张流程卡");
  add(rings.process.coverage === "needs-repair", "重构流程卡");
  add(rings.mistake.coverage === "missing", "补 1 张错误卡");
  add(rings.mistake.coverage === "needs-repair", "重构错误卡");
  add(hasDueReview, "完成今日到期复习");

  return suggestions;
}

function sortedActiveCards(cards: ActiveCard[]): ActiveCard[] {
  return [...cards].sort((left, right) => {
    const typeOrder = cardTypeOrder(left.card.type) - cardTypeOrder(right.card.type);

    if (typeOrder !== 0) {
      return typeOrder;
    }

    return compareText(left.card.id, right.card.id);
  });
}

function cardTypeOrder(type: CardType): number {
  const index = (CARD_TYPES as readonly string[]).indexOf(type);
  return index === -1 ? CARD_TYPES.length : index;
}

function currentDiagnosis(
  diagnoses: DiagnosisProjection[]
): DiagnosisProjection | null {
  return (
    [...diagnoses].sort(
      (left, right) =>
        compareText(right.createdAt, left.createdAt) ||
        compareText(left.id, right.id)
    )[0] ?? null
  );
}

function relatedConceptsFor(
  cards: ActiveCard[],
  nodeConcepts: ReadonlySet<string>
): string[] {
  const related = new Set<string>();

  for (const card of cards) {
    for (const item of card.card.relatedConcepts) {
      const normalized = normalizeConcept(item);
      if (nodeConcepts.has(normalized)) {
        related.add(normalized);
      }
    }
  }

  return [...related].sort(compareText);
}

function firstCardAction(cards: ActiveCard[]): string {
  for (const item of sortedActiveCards(cards)) {
    const action = normalizeAction(item.card.nextAction);
    if (action.length > 0) {
      return action;
    }
  }

  return "";
}

function buildConceptState(options: {
  concept: string;
  cards: ActiveCard[];
  diagnoses: DiagnosisProjection[];
  nodeConcepts: ReadonlySet<string>;
  today: string;
  verificationState: VerificationState;
}): GraphConceptState {
  const rings = ringsFor(
    options.cards,
    options.today,
    options.verificationState
  );
  const diagnosis = currentDiagnosis(options.diagnoses);
  const hasDueReview = options.cards.some(
    (item) => item.card.nextReview <= options.today
  );
  const suggestedNextActions = suggestionsFor(rings, hasDueReview);
  const diagnosisAction =
    diagnosis === null ? "" : normalizeAction(diagnosis.nextMinimumAction);
  const cardAction = firstCardAction(options.cards);
  const nextAction =
    diagnosisAction || cardAction || suggestedNextActions[0] || "";

  return {
    concept: options.concept,
    rings,
    currentBlock: diagnosis?.blockType ?? null,
    nextAction,
    hasDueReview,
    relatedConcepts: relatedConceptsFor(options.cards, options.nodeConcepts),
    suggestedNextActions
  };
}

function canonicalGraphJson(document: GraphStateDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function buildGraphState(
  vaultPath: string,
  index: IndexDocument
): Promise<GraphStateDocument> {
  const budget = graphIoBudget();
  const activeCardEntries = index.assets.filter(
    (entry): entry is ActiveCard["entry"] =>
      !entry.archived &&
      isCardAssetType(entry.assetType) &&
      entry.concept !== null &&
      entry.nextReview !== null
  );
  const activeCards = await boundedMap(
    activeCardEntries,
    8,
    (entry) => readCardForEntry(vaultPath, entry, budget)
  );
  const cardsByConcept = new Map<string, ActiveCard[]>();

  for (const card of activeCards) {
    const cards = cardsByConcept.get(card.concept) ?? [];
    cards.push(card);
    cardsByConcept.set(card.concept, cards);
  }

  const nodeConcepts = new Set(
    [...cardsByConcept.keys()].sort(compareText)
  );
  const diagnosisEntries = index.assets.filter(
    (entry) =>
      !entry.archived &&
      entry.assetType === "diagnosis" &&
      entry.concept !== null &&
      nodeConcepts.has(normalizeConcept(entry.concept))
  );
  const diagnosisResults = await boundedMap(
    diagnosisEntries,
    8,
    (entry) => readDiagnosisForEntry(vaultPath, entry, budget)
  );
  const diagnosesByConcept = new Map<string, DiagnosisProjection[]>();

  for (const diagnosis of diagnosisResults) {
    if (diagnosis === null || !nodeConcepts.has(diagnosis.concept)) {
      continue;
    }

    const diagnoses = diagnosesByConcept.get(diagnosis.concept) ?? [];
    diagnoses.push(diagnosis);
    diagnosesByConcept.set(diagnosis.concept, diagnoses);
  }

  const concepts: Record<string, GraphConceptState> = {};
  const today = new Date().toISOString().slice(0, 10);
  const verificationState = await readVerificationState(vaultPath);

  for (const concept of [...nodeConcepts].sort(compareText)) {
    concepts[concept] = buildConceptState({
      concept,
      cards: cardsByConcept.get(concept) ?? [],
      diagnoses: diagnosesByConcept.get(concept) ?? [],
      nodeConcepts,
      today,
      verificationState
    });
  }

  const document: GraphStateDocument = {
    generatedAt: new Date().toISOString(),
    sourceIndexFingerprint: index.sourceFingerprint,
    concepts
  };

  await atomicWriteText(
    resolveInsideRoot(vaultPath, GRAPH_STATE_PATH),
    canonicalGraphJson(document),
    { root: vaultPath }
  );

  return document;
}

export async function rebuildGraphState(
  context: LibraryOperationContext
): Promise<GraphStateDocument> {
  return buildGraphState(
    context.path,
    await readIndexProjection(context.path, { signal: context.signal })
  );
}

export async function readGraphProjection(
  context: LibraryOperationContext
): Promise<GraphStateDocument> {
  const vaultPath = context.path;
  context.assertCurrent();
  const index = await readIndexProjection(vaultPath, {
    signal: context.signal
  });
  const cached = await readProjectionFile(
    vaultPath,
    GRAPH_STATE_PATH,
    graphStateDocumentSchema
  );

  if (
    cached !== null &&
    cached.sourceIndexFingerprint === index.sourceFingerprint
  ) {
    return cached;
  }

  return buildGraphState(vaultPath, index);
}
