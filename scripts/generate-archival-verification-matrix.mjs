#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(
  root,
  "docs/reference/ALEKSI_0.1.4_ARCHIVAL_1.0_MASTER_PLAN.md"
);
const outputPath = resolve(
  root,
  "docs/current/ARCHIVAL_VERIFICATION_MATRIX.md"
);

const evidenceByPrefix = Object.freeze({
  S: "`tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts`",
  T: "`tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts`",
  L: "`tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts`",
  A: "`tests/server/app-settings-recovery.test.ts`",
  P: "`tests/server/index-service.test.ts`, `tests/api/verification.test.ts`",
  B: "`tests/api/backup-restore.test.ts`, restore-drill report",
  D: "source lifecycle tests plus Windows qualification report",
  C: "`tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx`",
  R: "CI, Windows qualification, release, and soak evidence"
});

const windowsEvidenceByPrefix = Object.freeze({
  S: "Production Playwright; native launch cases in Windows qualification",
  T: "Vitest fault matrix; process-kill cases in Windows qualification",
  L: "Vitest/Supertest; disconnect and process cases in Windows qualification",
  A: "Vitest fault boundaries; process-kill cases in Windows qualification",
  P: "Vitest/Supertest",
  B: "Automated restore drill on clean Windows runner",
  D: "GitHub Actions clean Windows runner required",
  C: "Vitest/Playwright; 10,000-card performance report",
  R: "GitHub Actions or external clean-machine evidence required"
});

function escapeCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

const source = await readFile(sourcePath, "utf8");
const section = source.match(
  /## 6\. Mandatory verification matrix([\s\S]*?)\n---\n\n## 7\./u
)?.[1];
if (section === undefined) {
  throw new Error("Mandatory verification matrix section was not found");
}

const cases = Array.from(
  section.matchAll(/^- \*\*([A-Z]\d{2}):\*\* (.+)$/gmu),
  (match) => ({ id: match[1], requirement: match[2].trim() })
);
if (cases.length !== 108) {
  throw new Error(`Expected 108 verification cases, found ${cases.length}`);
}
if (new Set(cases.map(({ id }) => id)).size !== cases.length) {
  throw new Error("Verification matrix contains duplicate IDs");
}

const rows = cases.map(({ id, requirement }) => {
  const prefix = id[0];
  return `| ${id} | ${escapeCell(requirement)} | ${evidenceByPrefix[prefix]} | ${windowsEvidenceByPrefix[prefix]} | not-run | — |`;
});

const output = `# Archival 1.0 Verification Matrix

> Generated from \`docs/reference/ALEKSI_0.1.4_ARCHIVAL_1.0_MASTER_PLAN.md\` by \`npm run generate:archival-matrix\`.
>
> A row changes from \`not-run\` only when the linked machine-readable evidence exists. Source tests cannot satisfy Windows lifecycle evidence by themselves.

| ID | Requirement | Automated evidence | Windows evidence | Status | Artifact |
|---|---|---|---|---|---|
${rows.join("\n")}
`;

await writeFile(outputPath, output, "utf8");
console.log(`Wrote ${cases.length} verification cases to ${outputPath}`);
