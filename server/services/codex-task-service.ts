import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { codexTaskCreateInputSchema } from "../domain/schemas";
import type {
  BlockType,
  CodexTaskCreateInput
} from "../domain/types";
import { readAssetVersion, readVersionedText } from "../lib/asset-version";
import { allocateUniqueMarkdownPath } from "../lib/filename";
import { resolveInsideRoot } from "../lib/path-safety";
import {
  learningLibraryRelativePath,
  type LibraryOperationContext
} from "../persistence/library-context";
import {
  markdownFrontmatterValue,
  serializeMarkdownValueUnit
} from "../persistence/markdown-value";
import {
  createSaveReceipt,
  type SaveReceipt
} from "../persistence/save-receipt";
import type { ProjectionOutcome } from "../projections/projection-types";
import { refreshIndexProjection } from "../projections/projection-runner";
import { runFileTransaction } from "../transactions/transaction-runner";
import { getCardByIdInVault } from "./card-service";
import { getReadingByIdInVault } from "./reading-service";
import { CODEX_TASK_DIRECTORY } from "../../shared/vault-map";

export const CODEX_TASK_REQUESTED_ACTIONS = [
  "请先复述我当前材料中已经明确的事实。",
  "请指出我卡住的最小前提、定义缺口或例子缺口。",
  "请给我一个不直接替我完成证明或答案的提示。",
  "请设计一个我可以自己做的下一步检查。",
  "请建议我应该沉淀成哪一种 Aleksi 卡片，并说明原因。"
] as const;

export const CODEX_TASK_LEARNING_GUARDRAIL =
  "Do not replace my learning / 不要替代我的学习：请把回答限制在复述、追问、提示、检查清单和最小反例上；不要直接替我完成证明、作业、最终答案或完整总结。";

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  definition: "定义",
  example: "例子",
  counterexample: "反例",
  "proof-search": "证明搜索",
  technical: "技术",
  expression: "表达",
  transfer: "迁移",
  emotion: "情绪"
};

export type CodexTaskRecord = {
  id: string;
  type: "codex-task";
  title: string;
  concept: string;
  sourceReading: string | null;
  relatedCard: string | null;
  currentMaterial: string;
  understanding: string;
  blockType: BlockType;
  requestedActions: readonly string[];
  learningGuardrail: string;
  createdAt: string;
};

export type PersistedCodexTask = CodexTaskRecord & {
  relativePath: string;
  modifiedAt: string;
};

export type CodexTaskSaveReceipt = SaveReceipt;

export type SavedCodexTaskResponse = {
  codexTask: PersistedCodexTask;
  saveReceipt: CodexTaskSaveReceipt;
} & ProjectionOutcome;

function assetLink(relativePath: string, title: string): string {
  return `[[${relativePath.replace(/\.md$/u, "")}|${title}]]`;
}

function datePrefix(createdAt: string): string {
  return createdAt.slice(0, 10).replaceAll("-", "");
}

function serializeCodexTaskMarkdown(
  task: CodexTaskRecord,
  references: {
    sourceReadingTitle: string | null;
    relatedCardTitle: string | null;
  }
): string {
  const frontmatter = [
    "---",
    `id: ${markdownFrontmatterValue(task.id)}`,
    `type: ${markdownFrontmatterValue(task.type)}`,
    `title: ${markdownFrontmatterValue(task.title)}`,
    `concept: ${markdownFrontmatterValue(task.concept)}`,
    `sourceReading: ${markdownFrontmatterValue(task.sourceReading)}`,
    `relatedCard: ${markdownFrontmatterValue(task.relatedCard)}`,
    `blockType: ${markdownFrontmatterValue(task.blockType)}`,
    `createdAt: ${markdownFrontmatterValue(task.createdAt)}`,
    "---"
  ].join("\n");
  const metadata = [`所属概念：[[${task.concept}]]`];

  if (task.sourceReading === null || references.sourceReadingTitle === null) {
    metadata.push("来源材料：无");
  } else {
    metadata.push(
      `来源材料：${assetLink(task.sourceReading, references.sourceReadingTitle)}`
    );
  }

  if (task.relatedCard === null || references.relatedCardTitle === null) {
    metadata.push("关联卡片：无");
  } else {
    metadata.push(
      `关联卡片：${assetLink(task.relatedCard, references.relatedCardTitle)}`
    );
  }

  const requestedActions = [
    "## 请你执行",
    ...task.requestedActions.map((action, index) => `${index + 1}. ${action}`)
  ].join("\n");
  const sections = [
    serializeMarkdownValueUnit("当前材料", task.currentMaterial),
    serializeMarkdownValueUnit("我的理解", task.understanding),
    serializeMarkdownValueUnit("当前卡点", BLOCK_TYPE_LABELS[task.blockType]),
    requestedActions,
    serializeMarkdownValueUnit("学习边界", task.learningGuardrail)
  ];

  return (
    `${frontmatter}\n\n` +
    `# ${task.title}\n\n` +
    `${metadata.join("\n")}\n\n` +
    `${sections.join("\n\n")}\n`
  );
}

async function resolveSourceReading(
  context: LibraryOperationContext,
  sourceReadingId: string | undefined
): Promise<{ relativePath: string; title: string } | null> {
  if (sourceReadingId === undefined) {
    return null;
  }

  const reading = await getReadingByIdInVault(context, sourceReadingId);
  return {
    relativePath: reading.relativePath,
    title: reading.title
  };
}

async function resolveRelatedCard(
  context: LibraryOperationContext,
  relatedCardId: string | undefined
): Promise<{ relativePath: string; title: string } | null> {
  if (relatedCardId === undefined) {
    return null;
  }

  const card = await getCardByIdInVault(context, relatedCardId);
  return {
    relativePath: card.relativePath,
    title: card.title
  };
}

export async function createCodexTaskInVault(
  context: LibraryOperationContext,
  rawInput: CodexTaskCreateInput
): Promise<SavedCodexTaskResponse> {
  const vaultPath = context.path;
  const input = codexTaskCreateInputSchema.parse(rawInput);
  const [sourceReading, relatedCard] = await Promise.all([
    resolveSourceReading(context, input.sourceReadingId),
    resolveRelatedCard(context, input.relatedCardId)
  ]);
  const createdAt = new Date().toISOString();
  const title = `Codex 任务：${input.concept}卡点诊断`;
  const record: CodexTaskRecord = {
    id: randomUUID(),
    type: "codex-task",
    title,
    concept: input.concept,
    sourceReading: sourceReading?.relativePath ?? null,
    relatedCard: relatedCard?.relativePath ?? null,
    currentMaterial: input.currentMaterial,
    understanding: input.understanding,
    blockType: input.blockType,
    requestedActions: CODEX_TASK_REQUESTED_ACTIONS,
    learningGuardrail: CODEX_TASK_LEARNING_GUARDRAIL,
    createdAt
  };
  const directory = resolveInsideRoot(vaultPath, CODEX_TASK_DIRECTORY);
  const targetPath = await allocateUniqueMarkdownPath(
    directory,
    `${datePrefix(createdAt)}-${title}`,
    { root: vaultPath }
  );
  const relativePath = learningLibraryRelativePath(vaultPath, targetPath);
  const reservedVersion = await readAssetVersion(targetPath);
  await runFileTransaction({
    vaultPath,
    vaultId: context.vaultId,
    operation: "codex-task-create",
    assertCurrent: context.assertCurrent,
    targets: [{
      relativePath,
      content: serializeCodexTaskMarkdown(record, {
        sourceReadingTitle: sourceReading?.title ?? null,
        relatedCardTitle: relatedCard?.title ?? null
      }),
      expectedVersion: reservedVersion
    }]
  });
  const saved = await readVersionedText(targetPath);
  const projection = await refreshIndexProjection(vaultPath, context.signal);
  const receipt = createSaveReceipt(
      relativePath,
      await realpath(targetPath),
      saved.modifiedAt
  );

  return {
      codexTask: {
        ...record,
        relativePath,
        modifiedAt: receipt.modifiedAt
      },
      saveReceipt: receipt,
      ...projection
    };
}
