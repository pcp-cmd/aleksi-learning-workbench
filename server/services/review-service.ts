import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod";
import {
  cardRecordSchema,
  reviewAttemptInputSchema,
  reviewResultInputSchema
} from "../domain/schemas";
import type {
  BlockType,
  CardRecord,
  CardType,
  PersistedMastery,
  ReviewAttemptInput,
  ReviewDiagnosisDraft,
  ReviewFeedback,
  ReviewResultInput
} from "../domain/types";
import { atomicCreateText, atomicWriteText } from "../lib/atomic-write";
import { readVersionedText } from "../lib/asset-version";
import { boundedMap } from "../lib/bounded-map";
import { readBoundedRegularFile } from "../lib/bounded-regular-file";
import { withCardLock } from "../lib/card-lock";
import { hasErrorCode } from "../lib/error-code";
import { IoBudget, IoBudgetError } from "../lib/io-budget";
import { parseCardMarkdown, serializeCardMarkdown } from "../lib/markdown-codec";
import { normalizeVaultRelativePath, resolveInsideRoot } from "../lib/path-safety";
import type { LibraryOperationContext } from "../persistence/library-context";
import { runFileTransaction } from "../transactions/transaction-runner";
import {
  extractMarkdownValueUnit,
  markdownFrontmatterValue,
  serializeMarkdownValueUnit
} from "../persistence/markdown-value";
import { readProjectionFile } from "../projections/projection-file";
import {
  addDays,
  REVIEW_INTERVAL_DAYS,
  type ReviewFeedback as DateReviewFeedback,
  utcDateOnly
} from "../../shared/date";
import { CARD_LABELS } from "../../shared/card-labels";
import { CARD_TYPES } from "../../shared/card-types";
import {
  REVIEW_DIRECTORY,
  REVIEW_READ_DIRECTORIES
} from "../../shared/vault-map";
import { getCardByIdInVault } from "./card-service";
import {
  readIndexProjection,
  type IndexDocument,
  type IndexEntry
} from "./index-service";

const REVIEW_QUEUE_PATH = ".aleksi/review-queue.json";
const REVIEW_SCAN_LIMITS = {
  maxDepth: 16,
  maxFiles: 10_000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxConcurrency: 8,
  timeoutMs: 15_000
} as const;

type EvidenceQuality = "insufficient" | "assisted" | "independent";

const legacyCommittedSchema = z.object({
  id: z.string().regex(/^review-[0-9a-f]{64}$/u),
  type: z.literal("review"), title: z.string().min(1), cardId: z.string().min(1),
  idempotencyKey: z.string().min(1), requestHash: z.string().regex(/^[0-9a-f]{64}$/u),
  commitState: z.literal("committed"), reviewSequence: z.number().int().positive(),
  cardPath: z.string().min(1), cardTitle: z.string().min(1), cardType: z.enum(CARD_TYPES),
  concept: z.string().min(1), feedback: z.enum(["forgot", "fuzzy", "known", "fluent"]),
  blockType: z.enum(["definition", "example", "counterexample", "proof-search", "technical", "expression", "transfer", "emotion"]),
  reviewedAt: z.string().min(1), previousNextReview: z.string().min(1),
  previousBlockType: z.enum(["definition", "example", "counterexample", "proof-search", "technical", "expression", "transfer", "emotion"]).nullable(),
  intervalDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]),
  nextReview: z.string().min(1),
  previousMastery: z.enum(["learning", "mastered", "rebuild", "archived"]),
  nextMastery: z.enum(["learning", "mastered", "rebuild", "archived"]),
  previousLastAppliedReviewId: z.string().nullable(),
  previousLastAppliedReviewSequence: z.number().int().positive().nullable(),
  previousReviewAppliedAt: z.string().nullable(), previousReviewOverrideAt: z.string().nullable(),
  baseCardSha256: z.string().regex(/^[0-9a-f]{64}$/u), stagedCardSha256: z.string().regex(/^[0-9a-f]{64}$/u)
}).strict();

const v2BaseShape = {
  schemaVersion: z.literal(2), id: z.string().regex(/^review-[0-9a-f]{64}$/u),
  type: z.literal("review"), title: z.string().min(1), cardId: z.string().uuid(),
  idempotencyKey: z.string().min(1), attemptRequestHash: z.string().regex(/^[0-9a-f]{64}$/u),
  cardPath: z.string().min(1), cardTitle: z.string().min(1), cardType: z.enum(CARD_TYPES),
  concept: z.string().min(1), attemptedAt: z.string().min(1), promptVersion: z.literal("recall-v1"),
  declaredDontKnow: z.boolean(), confidenceBeforeReveal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  durationMs: z.number().int().nonnegative(), assistanceLevel: z.enum(["none", "hint", "source", "ai"]),
  baseCardSha256: z.string().regex(/^[0-9a-f]{64}$/u)
};

const v2AttemptedSchema = z.object({ ...v2BaseShape, commitState: z.literal("attempted") }).strict();
const v2ResultSchema = z.object({
  ...v2BaseShape,
  commitState: z.enum(["pending", "committed"]), resultRequestHash: z.string().regex(/^[0-9a-f]{64}$/u),
  reviewSequence: z.number().int().positive(), feedback: z.enum(["forgot", "fuzzy", "known", "fluent"]),
  blockType: z.enum(["definition", "example", "counterexample", "proof-search", "technical", "expression", "transfer", "emotion"]).nullable(),
  reviewedAt: z.string().min(1), evidenceQuality: z.enum(["insufficient", "assisted", "independent"]),
  diagnosisTargetCardType: z.enum(CARD_TYPES).nullable(), previousNextReview: z.string().min(1),
  previousBlockType: z.enum(["definition", "example", "counterexample", "proof-search", "technical", "expression", "transfer", "emotion"]).nullable(),
  intervalDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]), nextReview: z.string().min(1),
  previousMastery: z.enum(["learning", "mastered", "rebuild", "archived"]),
  nextMastery: z.enum(["learning", "mastered", "rebuild", "archived"]),
  previousLastAppliedReviewId: z.string().nullable(), previousLastAppliedReviewSequence: z.number().int().positive().nullable(),
  previousReviewAppliedAt: z.string().nullable(), previousReviewOverrideAt: z.string().nullable(),
  stagedCardSha256: z.string().regex(/^[0-9a-f]{64}$/u)
}).strict();

type LegacyCommitted = z.infer<typeof legacyCommittedSchema>;
type AttemptedRecord = z.infer<typeof v2AttemptedSchema> & { answer: string };
type ResultRecord = z.infer<typeof v2ResultSchema> & {
  answer: string; selfCorrection: string; diagnosisDraft: ReviewDiagnosisDraft | null;
};
type ParsedRecord = LegacyCommitted | AttemptedRecord | ResultRecord;

function isV2Record(
  record: ParsedRecord
): record is AttemptedRecord | ResultRecord {
  return "schemaVersion" in record && record.schemaVersion === 2;
}

function isAttemptedRecord(record: ParsedRecord): record is AttemptedRecord {
  return isV2Record(record) && record.commitState === "attempted";
}

function isResultRecord(record: ParsedRecord): record is ResultRecord {
  return isV2Record(record) && record.commitState !== "attempted";
}

export type ReviewQueueItem = {
  cardId: string; cardPath: string; cardType: CardType; concept: string;
  mastery: Exclude<IndexEntry["mastery"], null>; nextReview: string;
  lastReviewSequence: number | null; lastReviewed: string | null; due: true; prompt: string;
};
export type ReviewQueueDocument = {
  generatedAt: string;
  sourceIndexFingerprint: string;
  items: ReviewQueueItem[];
};

const reviewQueueItemSchema = z.object({
  cardId: z.string().uuid(),
  cardPath: z.string().min(1),
  cardType: z.enum(CARD_TYPES),
  concept: z.string().min(1),
  mastery: z.enum(["learning", "due", "mastered", "rebuild", "archived"]),
  nextReview: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  lastReviewSequence: z.number().int().positive().nullable(),
  lastReviewed: z.string().min(1).nullable(),
  due: z.literal(true),
  prompt: z.string().min(1)
}).strict();

const reviewQueueDocumentSchema = z.object({
  generatedAt: z.string().min(1),
  sourceIndexFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  items: z.array(reviewQueueItemSchema)
}).strict();
export type ReviewResult = {
  reviewId: string; cardId: string; feedback: ReviewFeedback; blockType: BlockType | null;
  reviewSequence: number; reviewedAt: string; intervalDays: 1 | 3 | 7 | 14;
  nextReview: string; nextMastery: PersistedMastery; evidenceQuality: EvidenceQuality;
};
export type ReviewSubmitResponse = {
  result: ReviewResult;
  replayed: boolean;
  projectionStatus: "fresh" | "stale";
};

export class ReviewServiceError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "ReviewServiceError"; this.code = code; this.status = status; }
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function reviewIdFor(cardId: string, key: string): string { return `review-${sha256(`${cardId}\u0000${key}`)}`; }
function recordPath(vaultPath: string, id: string): string { return resolveInsideRoot(vaultPath, `${REVIEW_DIRECTORY}/${id}.md`); }

function requireValueUnit(raw: string, heading: string): string {
  const unit = extractMarkdownValueUnit(raw, heading);
  if (unit === null) {
    throw new ReviewServiceError(
      "INVALID_REVIEW_RECORD",
      `Review evidence section ${heading} is invalid`,
      409
    );
  }
  return unit.value;
}

async function pathExists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (e) { if (hasErrorCode(e, "ENOENT")) return false; throw e; } }

function attemptHash(cardId: string, input: ReviewAttemptInput): string {
  return sha256(JSON.stringify({ cardId, idempotencyKey: input.idempotencyKey, answer: input.answer,
    declaredDontKnow: input.declaredDontKnow, confidenceBeforeReveal: input.confidenceBeforeReveal,
    durationMs: input.durationMs, assistanceLevel: input.assistanceLevel }));
}
function resultHash(input: ReviewResultInput): string {
  const draft = input.diagnosisDraft === null ? null : { assumedProblem: input.diagnosisDraft.assumedProblem,
    causeHypothesis: input.diagnosisDraft.causeHypothesis, nextMinimumAction: input.diagnosisDraft.nextMinimumAction,
    targetCardType: input.diagnosisDraft.targetCardType };
  return sha256(JSON.stringify({ attemptId: input.attemptId, feedback: input.feedback, blockType: input.blockType,
    selfCorrection: input.selfCorrection, diagnosisDraft: draft }));
}

function serializeAttempt(record: AttemptedRecord): string {
  const keys = Object.keys(v2BaseShape) as Array<keyof typeof record>;
  const frontmatter = ["---", ...keys.map((key) => `${String(key)}: ${markdownFrontmatterValue(record[key])}`),
    `commitState: ${markdownFrontmatterValue(record.commitState)}`, "---"].join("\n");
  return `${frontmatter}\n\n# ${record.title}\n\n${serializeMarkdownValueUnit("闭卷回答", record.answer)}\n`;
}
function serializeResult(record: ResultRecord): string {
  const keys = ["schemaVersion", "id", "type", "title", "cardId", "idempotencyKey", "attemptRequestHash", "commitState",
    "cardPath", "cardTitle", "cardType", "concept", "attemptedAt", "promptVersion", "declaredDontKnow",
    "confidenceBeforeReveal", "durationMs", "assistanceLevel", "baseCardSha256", "resultRequestHash", "reviewSequence",
    "feedback", "blockType", "reviewedAt", "evidenceQuality", "diagnosisTargetCardType", "previousNextReview",
    "previousBlockType", "intervalDays", "nextReview", "previousMastery", "nextMastery", "previousLastAppliedReviewId",
    "previousLastAppliedReviewSequence", "previousReviewAppliedAt", "previousReviewOverrideAt", "stagedCardSha256"] as const;
  const frontmatter = ["---", ...keys.map((key) => `${key}: ${markdownFrontmatterValue(record[key])}`), "---"].join("\n");
  const draft = record.diagnosisDraft;
  return `${frontmatter}\n\n# ${record.title}\n\n${serializeMarkdownValueUnit("闭卷回答", record.answer)}\n\n${serializeMarkdownValueUnit("自我纠正", record.selfCorrection)}` +
    (draft ? `\n\n${serializeMarkdownValueUnit("我一开始以为的问题", draft.assumedProblem)}\n\n${serializeMarkdownValueUnit("原因假设（待复测）", draft.causeHypothesis)}\n\n${serializeMarkdownValueUnit("下一步最小行动", draft.nextMinimumAction)}` : "") +
    `\n\n## 调度结果\n间隔天数：${record.intervalDays}\n下次复习：${record.nextReview}\n`;
}

function parseRecordRaw(raw: string): ParsedRecord | null {
  const parsed = matter(raw); const data = parsed.data;
  if (data.schemaVersion !== 2) {
    if (data.commitState !== "committed") return null;
    return legacyCommittedSchema.parse(data);
  }
  const answer = extractMarkdownValueUnit(raw, "闭卷回答"); if (answer === null) throw new ReviewServiceError("INVALID_REVIEW_RECORD", "Review answer evidence is invalid", 409);
  if (data.commitState === "attempted") return { ...v2AttemptedSchema.parse(data), answer: answer.value };
  const frontmatter = v2ResultSchema.parse(data); const selfCorrection = extractMarkdownValueUnit(raw, "自我纠正");
  if (selfCorrection === null) throw new ReviewServiceError("INVALID_REVIEW_RECORD", "Review correction evidence is invalid", 409);
  const diagnosisDraft = frontmatter.diagnosisTargetCardType === null ? null : {
    assumedProblem: requireValueUnit(raw, "我一开始以为的问题"),
    causeHypothesis: requireValueUnit(raw, "原因假设（待复测）"),
    nextMinimumAction: requireValueUnit(raw, "下一步最小行动"),
    targetCardType: frontmatter.diagnosisTargetCardType
  };
  return { ...frontmatter, answer: answer.value, selfCorrection: selfCorrection.value, diagnosisDraft };
}
async function readRecordAt(vaultPath: string, relativePath: string): Promise<ParsedRecord | null> {
  const raw = await readFile(resolveInsideRoot(vaultPath, relativePath), "utf8");
  return parseRecordRaw(raw);
}
async function readRecord(vaultPath: string, id: string): Promise<ParsedRecord | null> {
  for (const directory of REVIEW_READ_DIRECTORIES) {
    const relativePath = `${directory}/${id}.md`;
    if (await pathExists(resolveInsideRoot(vaultPath, relativePath))) {
      return readRecordAt(vaultPath, relativePath);
    }
  }
  return null;
}
async function collectPaths(
  vaultPath: string,
  directory: string,
  depth = 0
): Promise<Array<{ relativePath: string; depth: number }>> {
  if (depth > REVIEW_SCAN_LIMITS.maxDepth) {
    throw new IoBudgetError(
      "IO_DEPTH_LIMIT",
      `Review directory depth exceeds ${REVIEW_SCAN_LIMITS.maxDepth}`
    );
  }
  let entries; try { entries = await readdir(resolveInsideRoot(vaultPath, directory), { withFileTypes: true }); }
  catch (e) { if (hasErrorCode(e, "ENOENT")) return []; throw e; }
  const paths: Array<{ relativePath: string; depth: number }> = [];
  for (const entry of entries) { const relative = normalizeVaultRelativePath(`${directory}/${entry.name}`);
    if (entry.isDirectory()) paths.push(...await collectPaths(vaultPath, relative, depth + 1)); else if (entry.isFile() && entry.name.endsWith(".md")) paths.push({ relativePath: relative, depth }); }
  return paths.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function groupCommittedReviews(
  records: readonly ParsedRecord[]
): Map<string, Array<LegacyCommitted | ResultRecord>> {
  const byCard = new Map<string, Array<LegacyCommitted | ResultRecord>>();
  for (const record of records) {
    if (record.commitState !== "committed") continue;
    const committed = record as LegacyCommitted | ResultRecord;
    const history = byCard.get(committed.cardId);
    if (history) history.push(committed); else byCard.set(committed.cardId, [committed]);
  }
  for (const history of byCard.values()) {
    history.sort((a, b) => a.reviewSequence - b.reviewSequence);
  }
  return byCard;
}

async function scanCommittedReviews(
  vaultPath: string
): Promise<Map<string, Array<LegacyCommitted | ResultRecord>>> {
  const candidates = new Map<string, number>();
  for (const directory of REVIEW_READ_DIRECTORIES) {
    for (const candidate of await collectPaths(vaultPath, directory)) {
      candidates.set(candidate.relativePath, candidate.depth);
      if (candidates.size > REVIEW_SCAN_LIMITS.maxFiles) {
        throw new IoBudgetError(
          "IO_FILE_COUNT_LIMIT",
          `Review record count exceeds ${REVIEW_SCAN_LIMITS.maxFiles}`
        );
      }
    }
  }
  const budget = new IoBudget({
    maxDepth: REVIEW_SCAN_LIMITS.maxDepth,
    maxFiles: REVIEW_SCAN_LIMITS.maxFiles,
    maxFileBytes: REVIEW_SCAN_LIMITS.maxFileBytes,
    maxTotalBytes: REVIEW_SCAN_LIMITS.maxTotalBytes,
    maxConcurrency: REVIEW_SCAN_LIMITS.maxConcurrency,
    deadlineAt: Date.now() + REVIEW_SCAN_LIMITS.timeoutMs
  });
  const paths = [...candidates].sort(([a], [b]) => a.localeCompare(b));
  const records = await boundedMap(
    paths,
    REVIEW_SCAN_LIMITS.maxConcurrency,
    async ([relativePath, depth]) => {
      budget.checkpoint();
      const file = await readBoundedRegularFile(
        vaultPath,
        resolveInsideRoot(vaultPath, relativePath),
        {
          maxBytes: REVIEW_SCAN_LIMITS.maxFileBytes,
          label: "Review record"
        }
      );
      budget.claimFile(file.data.length, depth);
      return parseRecordRaw(file.data.toString("utf8"));
    }
  );
  return groupCommittedReviews(
    records.filter((record): record is ParsedRecord => record !== null)
  );
}

async function committedForCard(vaultPath: string, cardId: string): Promise<Array<LegacyCommitted | ResultRecord>> {
  return (await scanCommittedReviews(vaultPath)).get(cardId) ?? [];
}

function evidenceQualityFor(attempt: AttemptedRecord, feedback: ReviewFeedback): EvidenceQuality {
  if (attempt.declaredDontKnow || feedback === "forgot" || feedback === "fuzzy") return "insufficient";
  return attempt.assistanceLevel === "none" ? "independent" : "assisted";
}
function nextMastery(
  feedback: ReviewFeedback,
  evidenceQuality: EvidenceQuality,
  previousMastery: PersistedMastery
): PersistedMastery {
  if (feedback === "forgot" || feedback === "fuzzy") {
    return "rebuild";
  }
  if (evidenceQuality !== "independent" && previousMastery === "rebuild") {
    return "rebuild";
  }
  return "learning";
}
function applyReview(card: CardRecord, record: ResultRecord): CardRecord {
  return cardRecordSchema.parse({ ...card, schemaVersion: 2, nextReview: record.nextReview, mastery: record.nextMastery,
    blockType: record.blockType ?? card.blockType, lastAppliedReviewId: record.id,
    lastAppliedReviewSequence: record.reviewSequence, reviewAppliedAt: record.reviewedAt,
    reviewOverrideAt: null, pendingReviewId: null,
    revisionLog: [...card.revisionLog, { at: utcDateOnly(record.reviewedAt), note: "Reviewed card", reviewId: record.id }] }) as CardRecord;
}

async function refreshReviewProjection(
  context: LibraryOperationContext
): Promise<"fresh" | "stale"> {
  try {
    await rebuildReviewQueueInVault(context);
    return "fresh";
  } catch (error) {
    if (context.signal.aborted) {
      throw error;
    }
    return "stale";
  }
}

export async function startReviewAttemptInVault(
  context: LibraryOperationContext,
  cardId: string,
  rawInput: ReviewAttemptInput
) {
  const vaultPath = context.path;
  context.assertCurrent();
  const input = reviewAttemptInputSchema.parse(rawInput); const persisted = await getCardByIdInVault(context, cardId);
  if (persisted.mastery === "archived") throw new ReviewServiceError("REVIEW_CARD_NOT_REVIEWABLE", "Archived cards cannot be reviewed", 409);
  const cardRaw = await readFile(resolveInsideRoot(vaultPath, persisted.relativePath), "utf8"); const card = parseCardMarkdown(cardRaw);
  if (card.id !== cardId) throw new ReviewServiceError("REVIEW_CARD_ID_MISMATCH", "Indexed card identity does not match its Markdown", 409);
  if (card.nextReview > utcDateOnly(new Date().toISOString())) throw new ReviewServiceError("REVIEW_CARD_NOT_DUE", "Card is not due for review", 409);
  const id = reviewIdFor(cardId, input.idempotencyKey); const hash = attemptHash(cardId, input); const attemptedAt = new Date().toISOString();
  const record: AttemptedRecord = { schemaVersion: 2, id, type: "review", title: `复习记录：${card.title}`,
    cardId, idempotencyKey: input.idempotencyKey, attemptRequestHash: hash, commitState: "attempted",
    cardPath: persisted.relativePath, cardTitle: card.title, cardType: card.type, concept: card.concept,
    attemptedAt, promptVersion: "recall-v1", declaredDontKnow: input.declaredDontKnow,
    confidenceBeforeReveal: input.confidenceBeforeReveal, durationMs: input.durationMs,
    assistanceLevel: input.assistanceLevel, baseCardSha256: sha256(cardRaw), answer: input.answer };
  let replayed = false;
  try { await atomicCreateText(recordPath(vaultPath, id), serializeAttempt(record), { root: vaultPath }); }
  catch (e) { if (!hasErrorCode(e, "EEXIST")) throw e; replayed = true;
    const existing = await readRecord(vaultPath, id);
    if (!existing || !isV2Record(existing) || existing.attemptRequestHash !== hash) throw new ReviewServiceError("IDEMPOTENCY_KEY_REUSE", "Idempotency key was reused with a different attempt", 409);
    if (!isAttemptedRecord(existing)) throw new ReviewServiceError("REVIEW_ATTEMPT_ALREADY_COMPLETED", "Review attempt is already completed", 409);
  }
  const durable = await readRecord(vaultPath, id);
  if (!durable || !isAttemptedRecord(durable)) throw new ReviewServiceError("INVALID_REVIEW_RECORD", "Attempt was not durably readable", 500);
  if (sha256(cardRaw) !== durable.baseCardSha256) throw new ReviewServiceError("REVIEW_ATTEMPT_STALE", "Card changed after the attempt", 409);
  return { attemptId: id, attemptedAt: durable.attemptedAt, promptVersion: durable.promptVersion, replayed, revealedCard: card };
}

export async function getReviewAttemptInVault(
  context: LibraryOperationContext,
  attemptId: string
) {
  const vaultPath = context.path;
  context.assertCurrent();
  const record = await readRecord(vaultPath, attemptId);
  if (!record || !isAttemptedRecord(record)) throw new ReviewServiceError("REVIEW_ATTEMPT_NOT_FOUND", "Review attempt was not found", 404);
  const raw = await readFile(resolveInsideRoot(vaultPath, record.cardPath), "utf8");
  if (sha256(raw) !== record.baseCardSha256) throw new ReviewServiceError("REVIEW_ATTEMPT_STALE", "Card changed after the attempt", 409);
  return { attemptId: record.id, cardId: record.cardId, answer: record.answer, declaredDontKnow: record.declaredDontKnow,
    confidenceBeforeReveal: record.confidenceBeforeReveal, assistanceLevel: record.assistanceLevel, revealedCard: parseCardMarkdown(raw) };
}

async function submitReviewResultUnlocked(
  context: LibraryOperationContext,
  cardId: string,
  rawInput: ReviewResultInput
): Promise<ReviewSubmitResponse> {
  const vaultPath = context.path;
  const input = reviewResultInputSchema.parse(rawInput);
  const attemptRelativePath = `${REVIEW_DIRECTORY}/${input.attemptId}.md`;
  let attemptSnapshot;
  try {
    attemptSnapshot = await readVersionedText(
      resolveInsideRoot(vaultPath, attemptRelativePath)
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      throw new ReviewServiceError("REVIEW_ATTEMPT_NOT_FOUND", "Review attempt was not found", 404);
    }
    throw error;
  }
  const parsed = parseRecordRaw(attemptSnapshot.content);
  if (!parsed || !isV2Record(parsed)) throw new ReviewServiceError("REVIEW_ATTEMPT_NOT_FOUND", "Review attempt was not found", 404);
  if (parsed.cardId !== cardId) throw new ReviewServiceError("REVIEW_ATTEMPT_CARD_MISMATCH", "Route card does not match attempt card", 409);
  const hash = resultHash(input);
  if (isResultRecord(parsed) && parsed.commitState === "committed") {
    if (parsed.resultRequestHash !== hash) throw new ReviewServiceError("REVIEW_RESULT_CONFLICT", "Committed result payload differs", 409);
    return {
      result: resultFromV2(parsed),
      replayed: true,
      projectionStatus: await refreshReviewProjection(context)
    };
  }
  if (isResultRecord(parsed)) throw new ReviewServiceError("REVIEW_PENDING_RETRY_REQUIRED", "Pending review requires recovery", 409);
  const attempt = parsed;
  const cardSnapshot = await readVersionedText(
    resolveInsideRoot(vaultPath, attempt.cardPath)
  );
  const cardRaw = cardSnapshot.content;
  if (sha256(cardRaw) !== attempt.baseCardSha256) throw new ReviewServiceError("REVIEW_ATTEMPT_STALE", "Card changed after the attempt", 409);
  const card = parseCardMarkdown(cardRaw); if (card.id !== cardId) throw new ReviewServiceError("REVIEW_ATTEMPT_CARD_MISMATCH", "Card identity changed", 409);
  const reviewedAt = new Date().toISOString();
  const evidenceQuality = evidenceQualityFor(attempt, input.feedback);
  let intervalDays = REVIEW_INTERVAL_DAYS[input.feedback as DateReviewFeedback];
  if (evidenceQuality !== "independent") intervalDays = Math.min(intervalDays, 3) as 1 | 3 | 7 | 14;
  const history = await committedForCard(vaultPath, cardId); const nextReview = addDays(utcDateOnly(reviewedAt), intervalDays);
  const base: ResultRecord = { ...attempt, commitState: "pending", resultRequestHash: hash,
    reviewSequence: history.length === 0 ? 1 : Math.max(...history.map((item) => item.reviewSequence)) + 1,
    feedback: input.feedback, blockType: input.blockType, reviewedAt,
    evidenceQuality, diagnosisTargetCardType: input.diagnosisDraft?.targetCardType ?? null,
    previousNextReview: card.nextReview, previousBlockType: card.blockType, intervalDays, nextReview,
    previousMastery: card.mastery, nextMastery: nextMastery(input.feedback, evidenceQuality, card.mastery),
    previousLastAppliedReviewId: card.lastAppliedReviewId, previousLastAppliedReviewSequence: card.lastAppliedReviewSequence,
    previousReviewAppliedAt: card.reviewAppliedAt, previousReviewOverrideAt: card.reviewOverrideAt,
    stagedCardSha256: "0".repeat(64), selfCorrection: input.selfCorrection, diagnosisDraft: input.diagnosisDraft };
  const stagedCard = applyReview(card, base); const stagedMarkdown = serializeCardMarkdown(stagedCard);
  const pending: ResultRecord = { ...base, stagedCardSha256: sha256(stagedMarkdown) };
  const committed: ResultRecord = {
    ...pending,
    commitState: "committed"
  };
  await runFileTransaction({
    vaultPath,
    vaultId: context.vaultId,
    operation: "review-commit",
    assertCurrent: context.assertCurrent,
    targets: [
      {
        relativePath: attemptRelativePath,
        content: serializeResult(committed),
        expectedVersion: attemptSnapshot.version
      },
      {
        relativePath: attempt.cardPath,
        content: stagedMarkdown,
        expectedVersion: cardSnapshot.version
      }
    ]
  });
  return {
    result: resultFromV2(committed),
    replayed: false,
    projectionStatus: await refreshReviewProjection(context)
  };
}

export async function submitReviewResultInVault(
  context: LibraryOperationContext,
  cardId: string,
  rawInput: ReviewResultInput
): Promise<ReviewSubmitResponse> {
  return withCardLock(cardId, () =>
    submitReviewResultUnlockedWithGeneration(
      context,
      cardId,
      rawInput
    )
  );
}

async function submitReviewResultUnlockedWithGeneration(
  context: LibraryOperationContext,
  cardId: string,
  rawInput: ReviewResultInput
): Promise<ReviewSubmitResponse> {
  context.assertCurrent();
  const result = await submitReviewResultUnlocked(context, cardId, rawInput);
  context.assertCurrent();
  return result;
}

function resultFromV2(record: ResultRecord): ReviewResult {
  return { reviewId: record.id, cardId: record.cardId, feedback: record.feedback, blockType: record.blockType,
    reviewSequence: record.reviewSequence, reviewedAt: record.reviewedAt, intervalDays: record.intervalDays,
    nextReview: record.nextReview, nextMastery: record.nextMastery, evidenceQuality: record.evidenceQuality };
}

async function queueItems(vaultPath: string, index: IndexDocument, today: string): Promise<ReviewQueueItem[]> {
  const entries = index.assets.filter((asset): asset is IndexEntry & { assetType: CardType; concept: string; mastery: Exclude<IndexEntry["mastery"], null>; nextReview: string } =>
    (CARD_TYPES as readonly string[]).includes(asset.assetType) && asset.concept !== null && asset.mastery !== null && asset.nextReview !== null && !asset.archived && asset.nextReview <= today);
  const reviewsByCard = await scanCommittedReviews(vaultPath);
  const items = entries.map((asset) => { const history = reviewsByCard.get(asset.id) ?? []; const latest = history.at(-1);
    return { cardId: asset.id, cardPath: asset.relativePath, cardType: asset.assetType, concept: asset.concept,
      mastery: asset.mastery, nextReview: asset.nextReview, lastReviewSequence: latest?.reviewSequence ?? null,
      lastReviewed: latest?.reviewedAt ?? null, due: true as const,
      prompt: `不看原文，用自己的话回答：${asset.concept} 这张${CARD_LABELS[asset.assetType].label}想让我真正记住什么？` }; });
  return items.sort((a, b) => a.nextReview.localeCompare(b.nextReview) || a.cardId.localeCompare(b.cardId));
}
async function buildReviewQueue(
  vaultPath: string,
  index: IndexDocument
): Promise<ReviewQueueDocument> {
  const generatedAt = new Date().toISOString();
  const queue: ReviewQueueDocument = {
    generatedAt,
    sourceIndexFingerprint: index.sourceFingerprint,
    items: await queueItems(vaultPath, index, generatedAt.slice(0, 10))
  };
  await atomicWriteText(
    resolveInsideRoot(vaultPath, REVIEW_QUEUE_PATH),
    `${JSON.stringify(queue, null, 2)}\n`,
    { root: vaultPath }
  );
  return queue;
}

export async function rebuildReviewQueueInVault(
  context: LibraryOperationContext
): Promise<ReviewQueueDocument> {
  return buildReviewQueue(
    context.path,
    await readIndexProjection(context.path, { signal: context.signal })
  );
}

export async function readReviewProjectionInVault(
  context: LibraryOperationContext
): Promise<ReviewQueueDocument> {
  const vaultPath = context.path;
  context.assertCurrent();
  const index = await readIndexProjection(vaultPath, {
    signal: context.signal
  });
  const cached = await readProjectionFile(
    vaultPath,
    REVIEW_QUEUE_PATH,
    reviewQueueDocumentSchema
  );
  if (
    cached !== null &&
    cached.sourceIndexFingerprint === index.sourceFingerprint
  ) {
    return cached;
  }
  return buildReviewQueue(vaultPath, index);
}

export async function getTodaysReviewQueueInVault(
  context: LibraryOperationContext
): Promise<ReviewQueueDocument> {
  return readReviewProjectionInVault(context);
}
