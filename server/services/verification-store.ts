import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename } from "node:fs/promises";
import matter from "gray-matter";
import type { z } from "zod";
import { CODEX_TASK_DIRECTORY, VERIFICATION_DIRECTORY } from "../../shared/vault-map";
import { evidenceIdSchema } from "../domain/schemas";
import { atomicCreateText } from "../lib/atomic-write";
import { boundedMap } from "../lib/bounded-map";
import { readBoundedRegularFile } from "../lib/bounded-regular-file";
import { hasErrorCode } from "../lib/error-code";
import { IoBudget } from "../lib/io-budget";
import {
  assertRealPathInsideRoot,
  resolveInsideRoot
} from "../lib/path-safety";
import {
  learningLibraryRelativePath
} from "../persistence/library-context";
import {
  CANDIDATE_FILENAME_PATTERN,
  REVOCATION_FILENAME_PATTERN,
  VERDICT_FILENAME_PATTERN,
  candidateRecordSchema,
  invalidEvidenceFile,
  revocationRecordSchema,
  validateCandidateRecord,
  validateRevocationRecord,
  validateVerdictRecord,
  verdictRecordSchema
} from "./verification-domain";
import type {
  EvidenceCandidateRecord,
  EvidenceRevocationRecord,
  EvidenceVerdictRecord,
  VerificationDiagnostic,
  VerificationState
} from "./verification-domain";

const MAX_VERIFICATION_RECORDS = 10_000;
const MAX_VERIFICATION_RECORD_BYTES = 1024 * 1024;
const VERIFICATION_READ_CONCURRENCY = 8;
const MAX_VERIFICATION_TOTAL_BYTES = 256 * 1024 * 1024;

function verificationIoBudget(): IoBudget {
  return new IoBudget({
    maxDepth: 1,
    maxFiles: MAX_VERIFICATION_RECORDS,
    maxFileBytes: MAX_VERIFICATION_RECORD_BYTES,
    maxTotalBytes: MAX_VERIFICATION_TOTAL_BYTES,
    maxConcurrency: VERIFICATION_READ_CONCURRENCY,
    deadlineAt: Date.now() + 15_000
  });
}

async function verificationDirectory(
  vaultPath: string,
  create: boolean
): Promise<string> {
  const directory = resolveInsideRoot(vaultPath, VERIFICATION_DIRECTORY);
  if (create) {
    const parent = resolveInsideRoot(vaultPath, CODEX_TASK_DIRECTORY);
    await assertRealPathInsideRoot(vaultPath, parent);
    try {
      await mkdir(directory);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
    }
  }
  await assertRealPathInsideRoot(vaultPath, directory);
  return directory;
}

export function vaultRelativePath(
  vaultPath: string,
  absolutePath: string
): string {
  return learningLibraryRelativePath(vaultPath, absolutePath);
}

async function safeReadRecord<T>(
  vaultPath: string,
  absolutePath: string,
  schema: z.ZodType<T>,
  budget: IoBudget
): Promise<T> {
  budget.checkpoint();
  const bounded = await readBoundedRegularFile(vaultPath, absolutePath, {
    maxBytes: MAX_VERIFICATION_RECORD_BYTES,
    label: "Evidence record"
  });
  budget.claimFile(bounded.data.length, 0);
  try {
    return schema.parse(matter(bounded.data.toString("utf8")).data);
  } catch (error) {
    if (error instanceof Error && error.name === "VerificationServiceError") {
      throw error;
    }
    throw invalidEvidenceFile(
      "Evidence record is corrupt or does not match its schema"
    );
  }
}

async function directoryEntries(vaultPath: string): Promise<string[]> {
  let directory: string;
  try {
    directory = await verificationDirectory(vaultPath, false);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  try {
    const entries = await readdir(directory);
    if (entries.length > MAX_VERIFICATION_RECORDS) {
      throw invalidEvidenceFile(
        `Evidence record count exceeds ${MAX_VERIFICATION_RECORDS}`
      );
    }
    return entries;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}

type RecordGroup<T> = {
  records: T[];
  diagnostics: VerificationDiagnostic[];
};

async function quarantineInvalidRecord(
  absolutePath: string,
  entry: string
): Promise<VerificationDiagnostic> {
  const errorId = randomUUID();
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  await rename(
    absolutePath,
    `${absolutePath}.corrupt-${stamp}-${errorId}`
  ).catch((error: unknown) => {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  });
  return {
    errorId,
    file: entry,
    message: "Evidence record was quarantined because it is invalid"
  };
}

async function readRecordGroup<T>(
  vaultPath: string,
  entries: readonly string[],
  pattern: RegExp,
  readEntry: (directory: string, entry: string) => Promise<T>
): Promise<RecordGroup<T>> {
  if (entries.length === 0) return { records: [], diagnostics: [] };
  const directory = await verificationDirectory(vaultPath, false);
  const outcomes = await boundedMap(
    entries.filter((entry) => pattern.test(entry)),
    VERIFICATION_READ_CONCURRENCY,
    async (entry) => {
      try {
        return {
          record: await readEntry(directory, entry),
          diagnostic: null
        };
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "VerificationServiceError" ||
          !("code" in error) ||
          error.code !== "INVALID_EVIDENCE_FILE"
        ) {
          throw error;
        }
        return {
          record: null,
          diagnostic: await quarantineInvalidRecord(
            resolveInsideRoot(directory, entry),
            entry
          )
        };
      }
    }
  );
  const records: T[] = [];
  const diagnostics: VerificationDiagnostic[] = [];
  for (const outcome of outcomes) {
    if (outcome.record !== null) records.push(outcome.record as T);
    if (outcome.diagnostic !== null) diagnostics.push(outcome.diagnostic);
  }
  return { records, diagnostics };
}

async function allCandidates(
  vaultPath: string,
  existingEntries?: string[],
  budget = verificationIoBudget()
): Promise<RecordGroup<EvidenceCandidateRecord>> {
  const entries = existingEntries ?? await directoryEntries(vaultPath);
  return readRecordGroup(
    vaultPath,
    entries,
    CANDIDATE_FILENAME_PATTERN,
    async (directory, entry) => {
      const record = validateCandidateRecord(
        await safeReadRecord(vaultPath, resolveInsideRoot(directory, entry), candidateRecordSchema, budget) as EvidenceCandidateRecord
      );
      if (entry !== `${record.id}.md`) {
        throw invalidEvidenceFile(
          "Evidence candidate filename does not match its content ID"
        );
      }
      return record;
    }
  );
}

async function allVerdicts(
  vaultPath: string,
  existingEntries?: string[],
  budget = verificationIoBudget()
): Promise<RecordGroup<EvidenceVerdictRecord>> {
  const entries = existingEntries ?? await directoryEntries(vaultPath);
  const group = await readRecordGroup(
    vaultPath,
    entries,
    VERDICT_FILENAME_PATTERN,
    async (directory, entry) => {
      const record = validateVerdictRecord(
        await safeReadRecord(vaultPath, resolveInsideRoot(directory, entry), verdictRecordSchema, budget) as EvidenceVerdictRecord
      );
      const expected = `${record.candidateId.replace(/^evidence-/u, "verdict-")}.md`;
      if (entry !== expected) throw invalidEvidenceFile("Evidence verdict filename does not match its candidate ID");
      return record;
    }
  );
  if (new Set(group.records.map((record) => record.candidateId)).size !== group.records.length) {
    throw invalidEvidenceFile("A candidate has more than one verdict file");
  }
  return group;
}

async function allRevocations(
  vaultPath: string,
  existingEntries?: string[],
  budget = verificationIoBudget()
): Promise<RecordGroup<EvidenceRevocationRecord>> {
  const entries = existingEntries ?? await directoryEntries(vaultPath);
  const group = await readRecordGroup(
    vaultPath,
    entries,
    REVOCATION_FILENAME_PATTERN,
    async (directory, entry) => {
      const record = validateRevocationRecord(
        await safeReadRecord(vaultPath, resolveInsideRoot(directory, entry), revocationRecordSchema, budget) as EvidenceRevocationRecord
      );
      const expected = `${record.rootEvidenceId.replace(/^evidence-/u, "revocation-")}.md`;
      if (entry !== expected) throw invalidEvidenceFile("Evidence revocation filename does not match its root evidence ID");
      return record;
    }
  );
  if (new Set(group.records.map((record) => record.rootEvidenceId)).size !== group.records.length) {
    throw invalidEvidenceFile("Evidence has more than one revocation file");
  }
  return group;
}

export async function readVerificationState(
  vaultPath: string
): Promise<VerificationState> {
  const entries = await directoryEntries(vaultPath);
  const budget = verificationIoBudget();
  const candidates = await allCandidates(vaultPath, entries, budget);
  const verdicts = await allVerdicts(vaultPath, entries, budget);
  const revocations = await allRevocations(vaultPath, entries, budget);
  return {
    candidates: candidates.records,
    verdicts: verdicts.records,
    revocations: revocations.records,
    diagnostics: [
      ...candidates.diagnostics,
      ...verdicts.diagnostics,
      ...revocations.diagnostics
    ]
  };
}

export async function candidateById(
  vaultPath: string,
  id: string
): Promise<{ record: EvidenceCandidateRecord; absolutePath: string } | null> {
  const parsedId = evidenceIdSchema.parse(id);
  let directory: string;
  try {
    directory = await verificationDirectory(vaultPath, false);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
  const absolutePath = resolveInsideRoot(directory, `${parsedId}.md`);
  try {
    const budget = verificationIoBudget();
    const record = validateCandidateRecord(
      await safeReadRecord(vaultPath, absolutePath, candidateRecordSchema, budget) as EvidenceCandidateRecord
    );
    if (record.id !== parsedId) throw invalidEvidenceFile("Evidence candidate filename does not match its content ID");
    return { record, absolutePath };
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

export async function createVerificationFile(
  vaultPath: string,
  filename: string,
  content: string
): Promise<boolean> {
  const directory = await verificationDirectory(vaultPath, true);
  try {
    await atomicCreateText(resolveInsideRoot(directory, filename), content, {
      root: vaultPath
    });
    return true;
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) return false;
    throw error;
  }
}
