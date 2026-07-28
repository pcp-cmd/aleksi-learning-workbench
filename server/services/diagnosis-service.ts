import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { diagnosisCreateInputSchema } from "../domain/schemas";
import type {
  BlockType,
  CardType,
  DiagnosisCreateInput
} from "../domain/types";
import { readAssetVersion, readVersionedText } from "../lib/asset-version";
import { allocateUniqueMarkdownPath } from "../lib/filename";
import { resolveInsideRoot } from "../lib/path-safety";
import { learningLibraryRelativePath } from "../persistence/library-context";
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
import { readVaultId } from "./vault-service";
import { CARD_LABELS } from "../../shared/card-labels";
import { DIAGNOSIS_DIRECTORY } from "../../shared/vault-map";

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

export type DiagnosisRecord = {
  id: string;
  type: "diagnosis";
  title: string;
  concept: string;
  relatedCard: string | null;
  blockType: BlockType;
  manifestation: string;
  assumedProblem: string;
  actualCause: string;
  nextMinimumAction: string;
  targetCardType: CardType;
  createdAt: string;
};

export type PersistedDiagnosis = DiagnosisRecord & {
  relativePath: string;
  modifiedAt: string;
};

export type DiagnosisSaveReceipt = SaveReceipt;

export type SavedDiagnosisResponse = {
  diagnosis: PersistedDiagnosis;
  saveReceipt: DiagnosisSaveReceipt;
} & ProjectionOutcome;

function assetLink(relativePath: string, title: string): string {
  return `[[${relativePath.replace(/\.md$/u, "")}|${title}]]`;
}

function serializeDiagnosisMarkdown(
  diagnosis: DiagnosisRecord,
  relatedCardTitle: string | null
): string {
  const frontmatter = [
    "---",
    `id: ${markdownFrontmatterValue(diagnosis.id)}`,
    `type: ${markdownFrontmatterValue(diagnosis.type)}`,
    `title: ${markdownFrontmatterValue(diagnosis.title)}`,
    `concept: ${markdownFrontmatterValue(diagnosis.concept)}`,
    `relatedCard: ${markdownFrontmatterValue(diagnosis.relatedCard)}`,
    `blockType: ${markdownFrontmatterValue(diagnosis.blockType)}`,
    `targetCardType: ${markdownFrontmatterValue(diagnosis.targetCardType)}`,
    `createdAt: ${markdownFrontmatterValue(diagnosis.createdAt)}`,
    "---"
  ].join("\n");
  const metadata = [`所属概念：[[${diagnosis.concept}]]`];

  if (diagnosis.relatedCard === null || relatedCardTitle === null) {
    metadata.push("关联卡片：无");
  } else {
    metadata.push(
      `关联卡片：${assetLink(diagnosis.relatedCard, relatedCardTitle)}`
    );
  }

  const sections = [
    serializeMarkdownValueUnit("当前卡点", BLOCK_TYPE_LABELS[diagnosis.blockType]),
    serializeMarkdownValueUnit("具体表现", diagnosis.manifestation),
    serializeMarkdownValueUnit("我一开始以为的问题", diagnosis.assumedProblem),
    serializeMarkdownValueUnit("现在判断的真实原因", diagnosis.actualCause),
    serializeMarkdownValueUnit("下一步最小行动", diagnosis.nextMinimumAction),
    serializeMarkdownValueUnit(
      "要沉淀成哪类卡片",
      CARD_LABELS[diagnosis.targetCardType].label
    )
  ];

  return (
    `${frontmatter}\n\n` +
    `# ${diagnosis.title}\n\n` +
    `${metadata.join("\n")}\n\n` +
    `${sections.join("\n\n")}\n`
  );
}

async function resolveRelatedCard(
  vaultPath: string,
  relatedCardId: string | undefined
): Promise<{ relativePath: string; title: string } | null> {
  if (relatedCardId === undefined) {
    return null;
  }

  const card = await getCardByIdInVault(vaultPath, relatedCardId);
  return {
    relativePath: card.relativePath,
    title: card.title
  };
}

export async function createDiagnosisInVault(
  vaultPath: string,
  rawInput: DiagnosisCreateInput
): Promise<SavedDiagnosisResponse> {
  const input = diagnosisCreateInputSchema.parse(rawInput);
  const relatedCard = await resolveRelatedCard(vaultPath, input.relatedCardId);
  const title = `卡点诊断：${input.concept}`;
  const record: DiagnosisRecord = {
    id: randomUUID(),
    type: "diagnosis",
    title,
    concept: input.concept,
    relatedCard: relatedCard?.relativePath ?? null,
    blockType: input.blockType,
    manifestation: input.manifestation,
    assumedProblem: input.assumedProblem,
    actualCause: input.actualCause,
    nextMinimumAction: input.nextMinimumAction,
    targetCardType: input.targetCardType,
    createdAt: new Date().toISOString()
  };
  const directory = resolveInsideRoot(vaultPath, DIAGNOSIS_DIRECTORY);
  const targetPath = await allocateUniqueMarkdownPath(directory, title, {
    root: vaultPath
  });
  const relativePath = learningLibraryRelativePath(vaultPath, targetPath);
  const reservedVersion = await readAssetVersion(targetPath);
  await runFileTransaction({
    vaultPath,
    vaultId: await readVaultId(vaultPath),
    operation: "diagnosis-create",
    targets: [{
      relativePath,
      content: serializeDiagnosisMarkdown(record, relatedCard?.title ?? null),
      expectedVersion: reservedVersion
    }]
  });
  const saved = await readVersionedText(targetPath);
  const projection = await refreshIndexProjection(vaultPath);
  const receipt = createSaveReceipt(
    relativePath,
    await realpath(targetPath),
    saved.modifiedAt
  );

  return {
      diagnosis: {
        ...record,
        relativePath,
        modifiedAt: receipt.modifiedAt
      },
      saveReceipt: receipt,
      ...projection
    };
}
