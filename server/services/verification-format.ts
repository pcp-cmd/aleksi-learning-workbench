import type { EvidenceFinding } from "../domain/types";
import type {
  EvidenceCandidateRecord,
  EvidenceRevocationRecord,
  EvidenceVerdictRecord
} from "./verification-domain";

function frontmatterLine(key: string, value: unknown): string {
  return `${key}: ${JSON.stringify(value)}`;
}

function valueSection(heading: string, value: string): string {
  return `## ${heading}\n\n${value}`;
}

export function candidateMarkdown(record: EvidenceCandidateRecord): string {
  const metadata = [
    frontmatterLine("schemaVersion", record.schemaVersion),
    frontmatterLine("id", record.id),
    frontmatterLine("type", record.type),
    frontmatterLine("title", record.title),
    frontmatterLine("concept", record.concept),
    frontmatterLine("cardId", record.cardId),
    frontmatterLine("cardPath", record.cardPath),
    frontmatterLine("statement", record.statement),
    frontmatterLine("proofAttempt", record.proofAttempt),
    frontmatterLine("predecessorIds", record.predecessorIds)
  ];
  if (record.schemaVersion === 2) {
    metadata.push(
      frontmatterLine("relations", record.relations),
      frontmatterLine("contextSnapshot", record.contextSnapshot)
    );
  }
  metadata.push(
    frontmatterLine("assistanceLevel", record.assistanceLevel),
    frontmatterLine("evidenceQuality", record.evidenceQuality),
    frontmatterLine("createdAt", record.createdAt)
  );
  const frontmatter = ["---", ...metadata, "---"].join("\n");
  const relations =
    record.schemaVersion === 2 && record.relations.length > 0
      ? record.relations
          .map(
            (relation) =>
              `- ${relation.type}: ${relation.targetEvidenceId} (${relation.targetCardId})`
          )
          .join("\n")
      : "无";

  return `${frontmatter}\n\n# ${record.title}\n\n${valueSection("候选陈述", record.statement)}\n\n${valueSection("学习者证明或论证", record.proofAttempt)}\n\n${valueSection("证据关系", relations)}\n\n${valueSection("信任边界", "这是候选证据，不是已验证事实。AI 审查不是形式化证明；重要结论仍需合格的人类或形式化工具复核。")}\n`;
}

function findingsMarkdown(heading: string, findings: EvidenceFinding[]): string {
  if (findings.length === 0) return valueSection(heading, "无");
  return valueSection(
    heading,
    findings.map((finding) => `- ${finding.location}：${finding.issue}`).join("\n")
  );
}

export function verdictMarkdown(record: EvidenceVerdictRecord): string {
  const metadata = [
    frontmatterLine("schemaVersion", record.schemaVersion),
    frontmatterLine("id", record.id),
    frontmatterLine("type", record.type),
    frontmatterLine("title", record.title),
    frontmatterLine("concept", record.concept),
    frontmatterLine("candidateId", record.candidateId),
    frontmatterLine("verifierKind", record.verifierKind),
    frontmatterLine("verificationReport", record.verificationReport),
    frontmatterLine("verdict", record.verdict),
    frontmatterLine("repairHints", record.repairHints)
  ];
  if (record.schemaVersion === 2) {
    metadata.push(
      frontmatterLine("confirmedByUser", record.confirmedByUser),
      frontmatterLine("formalProof", record.formalProof)
    );
  }
  metadata.push(frontmatterLine("verifiedAt", record.verifiedAt));
  const frontmatter = ["---", ...metadata, "---"].join("\n");

  return `${frontmatter}\n\n# ${record.title}\n\n${valueSection("审查摘要", record.verificationReport.summary)}\n\n${findingsMarkdown("关键错误", record.verificationReport.criticalErrors)}\n\n${findingsMarkdown("论证缺口", record.verificationReport.gaps)}\n\n${valueSection("修复提示", record.repairHints || "无")}\n\n${valueSection("信任边界", "此结论是人工或 LLM 审查记录，不是形式化证明证书。")}\n`;
}

export function revocationMarkdown(record: EvidenceRevocationRecord): string {
  const frontmatter = [
    "---",
    frontmatterLine("schemaVersion", record.schemaVersion),
    frontmatterLine("id", record.id),
    frontmatterLine("type", record.type),
    frontmatterLine("rootEvidenceId", record.rootEvidenceId),
    frontmatterLine("reason", record.reason),
    frontmatterLine("revokedAt", record.revokedAt),
    frontmatterLine("impacts", record.impacts),
    "---"
  ].join("\n");
  const impactLines = record.impacts
    .map((impact) => `- ${impact.evidenceId}: ${impact.path.join(" → ")}`)
    .join("\n");
  return `${frontmatter}\n\n# 证据撤销：${record.rootEvidenceId}\n\n${valueSection("原因", record.reason)}\n\n${valueSection("传播路径", impactLines)}\n\n${valueSection("保留策略", "候选证据与原判定均保留；撤销只追加记录并将相关知识节点置为待复核。")}\n`;
}

export function verificationPrompt(record: EvidenceCandidateRecord): string {
  const context = record.schemaVersion === 2
    ? [
        `Card snapshot SHA-256: ${record.contextSnapshot.cardSnapshotSha256}`,
        `Card revision: ${record.contextSnapshot.cardRevision}`,
        `Source snapshots: ${record.contextSnapshot.sourceSnapshots.map((source) => `${source.readingId} ${source.snapshotSha256} ${source.relativePath}`).join(", ") || "none"}`
      ]
    : [];
  return [
    "请在新的上下文中检查下面这份学习者论证。不要替学习者重写完整答案。", "",
    `Candidate ID: ${record.id}`, `Statement: ${record.statement}`,
    `Proof attempt: ${record.proofAttempt}`,
    `Accepted predecessors: ${record.predecessorIds.join(", ") || "none"}`,
    ...context, "",
    "Return correct if and only if criticalErrors and gaps are both empty.",
    "This is an LLM/human review record, not a formal proof certificate.",
    "返回 JSON：",
    JSON.stringify({
      verificationReport: {
        summary: "string",
        criticalErrors: [{ location: "string", issue: "string" }],
        gaps: [{ location: "string", issue: "string" }]
      },
      verdict: "correct | wrong", repairHints: "string"
    }, null, 2)
  ].join("\n");
}
