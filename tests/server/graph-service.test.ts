import { Buffer } from "node:buffer";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cardRecordSchema } from "../../server/domain/schemas";
import type { BlockType, CardRecord } from "../../server/domain/types";
import { serializeCardMarkdown } from "../../server/lib/markdown-codec";
import {
  readGraphProjection,
  rebuildGraphState
} from "../../server/services/graph-service";
import {
  ARCHIVE_DIRECTORY,
  CARD_DIRECTORIES,
  CODEX_TASK_DIRECTORY as CODEX_DIRECTORY,
  DIAGNOSIS_DIRECTORY,
  READING_DIRECTORY,
  REVIEW_DIRECTORY
} from "../../shared/vault-map";
import { createTempVaultContext, readJsonFile, VAULT_FOLDERS } from "../temp-vault";

const NOW = "2026-06-22T03:14:15.926Z";
type GraphFixtureCardType =
  | "concept"
  | "definition"
  | "example"
  | "boundary"
  | "counterexample"
  | "process"
  | "mistake"
  | "proof";

type GraphState = Awaited<ReturnType<typeof rebuildGraphState>>;

async function createVault(): Promise<string> {
  const context = await createTempVaultContext();
  const vaultPath = context.path("Vault");
  const fixtureFolders = Array.from(
    new Set([...VAULT_FOLDERS, ...Object.values(CARD_DIRECTORIES)])
  );

  await Promise.all(
    fixtureFolders.map((folder) =>
      mkdir(join(vaultPath, folder), { recursive: true })
    )
  );

  return vaultPath;
}

function revisionLog(at = "2026-06-22") {
  return [{ at, note: "Created card", reviewId: null }];
}

function cardPayload(type: GraphFixtureCardType): Record<string, string> {
  switch (type) {
    case "concept":
      return {
        formalExplanation: "A limit describes eventual closeness.",
        myUnderstanding: "After some stage, the tail obeys any requested tolerance.",
        commonMisunderstanding: "Treating N as fixed before ε.",
        usageContext: "Use when naming the core object."
      };
    case "definition":
      return {
        formalDefinition: "For every ε > 0 there is an N.",
        plainExplanation: "Choose the tolerance before choosing the stage.",
        quantifierStructure: "∀ε ∃N ∀n",
        commonMisunderstandings: "N may depend on ε, but not on n."
      };
    case "example":
      return {
        exampleContent: "The sequence 1/n converges to 0.",
        whyItFits: "After N > 1/ε, every later term is small.",
        trainingPurpose: "Practice choosing N from ε."
      };
    case "counterexample":
      return {
        counterexampleContent: "The sequence (-1)^n.",
        brokenCondition: "No tail stays in one small neighborhood.",
        whyItIsNot: "The terms keep jumping between two values."
      };
    case "boundary":
      return {
        confusingObjects: "Limit vs eventually bounded",
        similarity: "Both talk about tails.",
        keyDifference: "Limit requires arbitrary small neighborhoods.",
        judgementRule: "Ask whether every ε works."
      };
    case "process":
      return {
        task: "Prove a sequence limit.",
        steps: "Pick ε, choose N, verify the tail.",
        keyTurn: "Let N depend on ε.",
        pitfall: "Choosing N before seeing ε.",
        usageContext: "Use while solving a limit proof."
      };
    case "mistake":
      return {
        mistake: "I choose N as a constant.",
        originalThinking: "One large N should work for all tolerances.",
        realCause: "I missed the dependency N(ε).",
        correctMethod: "Solve the inequality after ε is known.",
        recognitionSignal: "I write N before writing ε."
      };
    case "proof":
      return {
        proposition: "A convergent sequence has a unique limit.",
        firstAttempt: "Try to compare both limits directly.",
        keyMove: "Use ε/2 around each proposed limit.",
        proofOutline: "Make both distances small, then use the triangle inequality.",
        failureReason: "Forgetting to use the same tail for both limits."
      };
  }
}

function makeCard(
  overrides: Partial<CardRecord> & {
    id: string;
    type: GraphFixtureCardType;
    title: string;
    concept: string;
  }
): CardRecord {
  return cardRecordSchema.parse({
    relatedConcepts: [],
    sourceReading: "01-阅读材料/source.md",
    excerpt: "source excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    mastery: "learning",
    createdAt: NOW,
    nextReview: "2026-06-23",
    lastAppliedReviewId: null,
    lastAppliedReviewSequence: null,
    reviewAppliedAt: null,
    reviewOverrideAt: null,
    pendingReviewId: null,
    revisionLog: revisionLog(),
    ...overrides,
    ...cardPayload(overrides.type)
  }) as CardRecord;
}

async function writeCard(
  vaultPath: string,
  card: CardRecord,
  options: { archived?: boolean } = {}
): Promise<void> {
  const directory = options.archived
    ? ARCHIVE_DIRECTORY
    : CARD_DIRECTORIES[card.type as GraphFixtureCardType];
  const path = join(vaultPath, directory, `${card.id}.md`);
  await writeFile(path, serializeCardMarkdown(card), "utf8");
}

function frontmatter(data: Record<string, unknown>): string {
  return [
    "---",
    ...Object.entries(data).map(
      ([key, value]) => `${key}: ${JSON.stringify(value)}`
    ),
    "---"
  ].join("\n");
}

function valueUnit(heading: string, value: string): string {
  return [
    `## ${heading}`,
    `<!-- aleksi:value bytes=${Buffer.byteLength(value, "utf8")} -->`,
    value,
    "<!-- /aleksi:value -->"
  ].join("\n");
}

async function writeSimpleAsset(
  vaultPath: string,
  directory: string,
  filename: string,
  data: Record<string, unknown>,
  body = ""
): Promise<void> {
  await writeFile(
    join(vaultPath, directory, filename),
    `${frontmatter(data)}\n\n# ${String(data.title)}\n\n${body}`,
    "utf8"
  );
}

async function writeDiagnosis(
  vaultPath: string,
  options: {
    id: string;
    concept: string;
    blockType: BlockType;
    createdAt: string;
    nextMinimumAction: string;
  }
): Promise<void> {
  await writeSimpleAsset(
    vaultPath,
    DIAGNOSIS_DIRECTORY,
    `${options.id}.md`,
    {
      id: options.id,
      type: "diagnosis",
      title: `卡点诊断：${options.concept}`,
      concept: options.concept,
      relatedCard: null,
      blockType: options.blockType,
      targetCardType: "definition",
      createdAt: options.createdAt
    },
    `${valueUnit("下一步最小行动", options.nextMinimumAction)}\n`
  );
}

function alphaState(state: GraphState) {
  return state.concepts.Alpha;
}

describe("concept flywheel graph service", () => {
  it("returns a fresh graph projection without rewriting its cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const vaultPath = await createVault();
    await writeCard(
      vaultPath,
      makeCard({
        id: "00000000-0000-4000-8000-000000000001",
        type: "concept",
        title: "Stable graph",
        concept: "Stable"
      })
    );

    const first = await readGraphProjection(vaultPath);
    const graphPath = join(vaultPath, ".aleksi", "graph-state.json");
    const firstMtime = (await stat(graphPath)).mtimeMs;
    const second = await readGraphProjection(vaultPath);

    expect(second).toEqual(first);
    expect((await stat(graphPath)).mtimeMs).toBe(firstMtime);

    await writeFile(graphPath, "{broken projection\n", "utf8");
    const recovered = await readGraphProjection(vaultPath);
    expect(recovered).toEqual(first);
    await expect(readJsonFile(graphPath)).resolves.toEqual(first);
  });

  it("rebuilds the V0.2 generic coverage cache from one active concept card", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const vaultPath = await createVault();

    await writeCard(
      vaultPath,
      makeCard({
        id: "00000000-0000-4000-8000-000000000001",
        type: "concept",
        title: "ε-N 概念卡",
        concept: "ε-N"
      })
    );

    const state = await rebuildGraphState(vaultPath);

    expect(state).toEqual({
      generatedAt: NOW,
      sourceIndexFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      concepts: {
        "ε-N": {
          concept: "ε-N",
          rings: {
            concept: { count: 1, coverage: "established", learningStatus: "learning", evidenceConfidence: "unverified" },
            example: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
            boundary: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
            process: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
            mistake: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" }
          },
          currentBlock: null,
          nextAction: "补 1 张例子卡",
          hasDueReview: false,
          relatedConcepts: [],
          suggestedNextActions: [
            "补 1 张例子卡",
            "补 1 张边界卡",
            "补 1 张流程卡",
            "补 1 张错误卡"
          ]
        }
      }
    });

    await expect(
      readJsonFile(join(vaultPath, ".aleksi", "graph-state.json"))
    ).resolves.toEqual(state);
  });

  it("aggregates active cards with deterministic rings, diagnoses, due reviews, and related concepts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const vaultPath = await createVault();

    await writeCard(
      vaultPath,
      makeCard({
        id: "00000000-0000-4000-8000-000000000101",
        type: "concept",
        title: "Alpha concept",
        concept: "Alpha",
        relatedConcepts: ["Beta", "Gamma"],
        nextAction: "Card action should lose to diagnosis.",
        nextReview: "2026-06-22"
      })
    );
    await writeCard(
      vaultPath,
      makeCard({
        id: "00000000-0000-4000-8000-000000000102",
        type: "example",
        title: "Alpha example",
        concept: "Alpha",
        relatedConcepts: ["Beta"],
        mastery: "rebuild"
      })
    );
    await writeCard(
      vaultPath,
      makeCard({
        id: "00000000-0000-4000-8000-000000000103",
        type: "process",
        title: "Alpha process",
        concept: "Alpha",
        mastery: "learning"
      })
    );
    await writeCard(
      vaultPath,
      makeCard({
        id: "00000000-0000-4000-8000-000000000201",
        type: "definition",
        title: "Beta definition",
        concept: "Beta",
        relatedConcepts: ["Alpha"],
        nextAction: "Use stored Beta action."
      })
    );
    await writeCard(
      vaultPath,
      makeCard({
        id: "00000000-0000-4000-8000-000000000202",
        type: "proof",
        title: "Beta proof",
        concept: "Beta",
        mastery: "mastered"
      })
    );

    await writeDiagnosis(vaultPath, {
      id: "diagnosis-c",
      concept: "Alpha",
      blockType: "expression",
      createdAt: "2026-06-22T02:00:00.000Z",
      nextMinimumAction: "This tied diagnosis should lose by ID."
    });
    await writeDiagnosis(vaultPath, {
      id: "diagnosis-a",
      concept: "Alpha",
      blockType: "proof-search",
      createdAt: "2026-06-22T02:00:00.000Z",
      nextMinimumAction: "Use the smallest tied diagnosis action."
    });
    await writeDiagnosis(vaultPath, {
      id: "diagnosis-b",
      concept: "Alpha",
      blockType: "technical",
      createdAt: "2026-06-22T01:00:00.000Z",
      nextMinimumAction: "This older diagnosis should lose."
    });
    await writeDiagnosis(vaultPath, {
      id: "diagnosis-only",
      concept: "DiagnosisOnly",
      blockType: "definition",
      createdAt: "2026-06-22T03:00:00.000Z",
      nextMinimumAction: "This cannot create a graph node."
    });

    await writeCard(
      vaultPath,
      makeCard({
        id: "00000000-0000-4000-8000-000000000301",
        type: "definition",
        title: "Archived definition",
        concept: "ArchivedOnly",
        mastery: "archived"
      }),
      { archived: true }
    );
    await writeSimpleAsset(vaultPath, READING_DIRECTORY, "reading-only.md", {
      id: "reading-only",
      type: "reading",
      title: "Reading only",
      concept: "ReadingOnly"
    });
    await writeSimpleAsset(vaultPath, CODEX_DIRECTORY, "codex-only.md", {
      id: "codex-only",
      type: "codex-task",
      title: "Codex only",
      concept: "CodexOnly"
    });
    await writeSimpleAsset(vaultPath, REVIEW_DIRECTORY, "pending-review.md", {
      id: "review-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      type: "review",
      title: "Pending review",
      concept: "ReviewOnly",
      commitState: "pending"
    });

    const first = await rebuildGraphState(vaultPath);
    const rawCache = await readFile(
      join(vaultPath, ".aleksi", "graph-state.json"),
      "utf8"
    );
    const second = await rebuildGraphState(vaultPath);

    expect(Object.keys(first.concepts)).toEqual(["Alpha", "Beta"]);
    expect(first).toEqual(second);
    expect(JSON.parse(rawCache)).toEqual(first);

    expect(alphaState(first)).toMatchObject({
      concept: "Alpha",
      rings: {
        concept: { count: 1, coverage: "established", learningStatus: "due-for-review", evidenceConfidence: "unverified" },
        example: { count: 1, coverage: "needs-repair", learningStatus: "needs-repair", evidenceConfidence: "unverified" },
        boundary: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
        process: { count: 1, coverage: "established", learningStatus: "learning", evidenceConfidence: "unverified" },
        mistake: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" }
      },
      currentBlock: "proof-search",
      nextAction: "Use the smallest tied diagnosis action.",
      hasDueReview: true,
      relatedConcepts: ["Beta"],
      suggestedNextActions: [
        "重构例子卡",
        "补 1 张边界卡",
        "补 1 张错误卡",
        "完成今日到期复习"
      ]
    });

    expect(first.concepts.Beta).toMatchObject({
      concept: "Beta",
      rings: {
        concept: { count: 1, coverage: "established", learningStatus: "learning", evidenceConfidence: "unverified" },
        example: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
        boundary: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
        process: { count: 1, coverage: "established", learningStatus: "verified", evidenceConfidence: "unverified" },
        mistake: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" }
      },
      currentBlock: null,
      nextAction: "Use stored Beta action.",
      hasDueReview: false,
      relatedConcepts: ["Alpha"],
      suggestedNextActions: ["补 1 张例子卡", "补 1 张边界卡", "补 1 张错误卡"]
    });
  });
});
