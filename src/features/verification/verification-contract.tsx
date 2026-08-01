export type AssistanceLevel = "none" | "hint" | "source" | "ai";
export type EvidenceStatus =
  | "awaiting-verification"
  | "accepted"
  | "repair-needed"
  | "revoked"
  | "affected";
export type RelationType =
  | "requires"
  | "proves_with"
  | "illustrates"
  | "refutes"
  | "replaces";
export type VerifierKind =
  | "ai-review"
  | "human-review"
  | "gpt-plus-import";
export type Finding = { location: string; issue: string };

export type RecentCard = {
  id: string;
  title: string;
  concept: string;
  type: string;
};

export type EvidenceVerdict = {
  id: string;
  verifierKind: VerifierKind;
  verificationReport: {
    summary: string;
    criticalErrors: Finding[];
    gaps: Finding[];
  };
  verdict: "correct" | "wrong";
  repairHints: string;
  verifiedAt: string;
  confirmedByUser?: boolean;
  formalProof?: false;
};

export type EvidenceSummary = {
  id: string;
  title: string;
  concept: string;
  cardId: string;
  statement: string;
  predecessorIds: string[];
  relations: Array<{
    targetEvidenceId: string;
    targetCardId: string;
    type: RelationType;
  }>;
  assistanceLevel: AssistanceLevel;
  evidenceQuality: "independent" | "assisted";
  createdAt: string;
  status: EvidenceStatus;
  qualifiesForMastery: boolean;
  verdict: EvidenceVerdict | null;
  contextSnapshot: null | {
    cardRevision: number;
    cardSnapshotSha256: string;
    sourceSnapshots: Array<{
      readingId: string;
      relativePath: string;
      snapshotSha256: string;
      excerpt: string;
      locator: string | null;
    }>;
  };
  revocationImpacts: Array<{
    rootEvidenceId: string;
    evidenceId: string;
    upstreamEvidenceId: string | null;
    path: string[];
    reason: string;
    revokedAt: string;
  }>;
};

export type EvidenceDetail = EvidenceSummary & {
  cardPath: string;
  proofAttempt: string;
  relativePath: string;
  verificationPrompt: string;
};

export const STATUS_LABELS: Record<EvidenceStatus, string> = {
  "awaiting-verification": "等待审查",
  accepted: "审查通过",
  "repair-needed": "需要修复",
  revoked: "已撤销",
  affected: "受上游影响"
};

export const RELATION_LABELS: Record<RelationType, string> = {
  requires: "requires · 依赖",
  proves_with: "proves_with · 联合证明",
  illustrates: "illustrates · 举例说明",
  refutes: "refutes · 反驳",
  replaces: "replaces · 替代"
};

export const ASSISTANCE_LABELS: Record<AssistanceLevel, string> = {
  none: "自报未使用辅助",
  hint: "自报使用了提示",
  source: "自报查看了材料",
  ai: "自报使用了 AI"
};

export function emptyFinding(): Finding {
  return { location: "", issue: "" };
}

export function normalizeFindings(findings: Finding[]): Finding[] {
  return findings
    .map((finding) => ({
      location: finding.location.trim(),
      issue: finding.issue.trim()
    }))
    .filter((finding) => finding.location !== "" || finding.issue !== "");
}

function isFindingArray(value: unknown): value is Finding[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "location" in item &&
        typeof item.location === "string" &&
        "issue" in item &&
        typeof item.issue === "string"
    )
  );
}

export type ImportedVerdict = {
  criticalErrors: Finding[];
  gaps: Finding[];
  repairHints: string;
  summary: string;
  verdict: "correct" | "wrong";
};

export function parseImportedVerdict(source: string): ImportedVerdict {
  const parsed: unknown = JSON.parse(source);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("verificationReport" in parsed) ||
    typeof parsed.verificationReport !== "object" ||
    parsed.verificationReport === null ||
    !("summary" in parsed.verificationReport) ||
    typeof parsed.verificationReport.summary !== "string" ||
    !("criticalErrors" in parsed.verificationReport) ||
    !isFindingArray(parsed.verificationReport.criticalErrors) ||
    !("gaps" in parsed.verificationReport) ||
    !isFindingArray(parsed.verificationReport.gaps) ||
    !("verdict" in parsed) ||
    (parsed.verdict !== "correct" && parsed.verdict !== "wrong") ||
    !("repairHints" in parsed) ||
    typeof parsed.repairHints !== "string"
  ) {
    throw new Error("JSON 缺少严格审查字段，或字段类型不正确。");
  }
  return {
    criticalErrors: parsed.verificationReport.criticalErrors,
    gaps: parsed.verificationReport.gaps,
    repairHints: parsed.repairHints,
    summary: parsed.verificationReport.summary,
    verdict: parsed.verdict
  };
}

export function FindingsEditor({
  label,
  value,
  onChange
}: {
  label: string;
  value: Finding[];
  onChange: (value: Finding[]) => void;
}) {
  return (
    <fieldset className="verification-findings">
      <legend>{label}</legend>
      {value.map((finding, index) => (
        <div className="verification-finding-row" key={`${label}-${index}`}>
          <label>
            位置
            <input
              aria-label={`${label} ${index + 1} 位置`}
              onChange={(event) => {
                const next = [...value];
                next[index] = { ...finding, location: event.target.value };
                onChange(next);
              }}
              value={finding.location}
            />
          </label>
          <label>
            问题
            <textarea
              aria-label={`${label} ${index + 1} 问题`}
              onChange={(event) => {
                const next = [...value];
                next[index] = { ...finding, issue: event.target.value };
                onChange(next);
              }}
              rows={2}
              value={finding.issue}
            />
          </label>
          {value.length > 1 ? (
            <button
              className="button button-ghost"
              onClick={() =>
                onChange(
                  value.filter((_, itemIndex) => itemIndex !== index)
                )
              }
              type="button"
            >
              删除这一项
            </button>
          ) : null}
        </div>
      ))}
      <button
        className="button button-ghost"
        onClick={() => onChange([...value, emptyFinding()])}
        type="button"
      >
        添加{label}
      </button>
    </fieldset>
  );
}
