import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import matter from "gray-matter";
import type { z } from "zod";
import { CODEX_TASK_DIRECTORY, VERIFICATION_DIRECTORY } from "../../shared/vault-map";
import { evidenceIdSchema } from "../domain/schemas";
import { atomicCreateText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import {
  assertRealPathInsideRoot,
  resolveInsideRoot
} from "../lib/path-safety";
import {
  activeLearningLibrary,
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
  VerificationState
} from "./verification-domain";

export { activeLearningLibrary as activeVaultPath };

function sameFileIdentity(
  opened: { dev: bigint; ino: bigint },
  current: { dev: bigint; ino: bigint }
): boolean {
  if (opened.ino === 0n || current.ino === 0n) return false;
  return process.platform === "win32"
    ? opened.ino === current.ino
    : opened.dev === current.dev && opened.ino === current.ino;
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
  schema: z.ZodType<T>
): Promise<T> {
  const before = await lstat(absolutePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw invalidEvidenceFile("Evidence records must be regular files");
  }
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );
  try {
    const opened = await handle.stat({ bigint: true });
    await assertRealPathInsideRoot(vaultPath, absolutePath);
    const current = await lstat(absolutePath, { bigint: true });
    if (!opened.isFile() || !current.isFile() || current.isSymbolicLink() ||
      !sameFileIdentity(opened, current)) {
      throw invalidEvidenceFile(
        "Evidence file identity changed while it was being opened"
      );
    }
    const raw = await handle.readFile({ encoding: "utf8" });
    const after = await lstat(absolutePath, { bigint: true });
    if (!after.isFile() || after.isSymbolicLink() ||
      !sameFileIdentity(opened, after)) {
      throw invalidEvidenceFile(
        "Evidence file identity changed while it was being read"
      );
    }
    return schema.parse(matter(raw).data);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) throw error;
    if (error instanceof Error && error.name === "VerificationServiceError") {
      throw error;
    }
    throw invalidEvidenceFile(
      "Evidence record is corrupt or does not match its schema"
    );
  } finally {
    await handle.close();
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
    return await readdir(directory);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}

async function allCandidates(
  vaultPath: string
): Promise<EvidenceCandidateRecord[]> {
  const entries = await directoryEntries(vaultPath);
  if (entries.length === 0) return [];
  const directory = await verificationDirectory(vaultPath, false);
  return Promise.all(entries
    .filter((entry) => CANDIDATE_FILENAME_PATTERN.test(entry))
    .map(async (entry) => {
      const record = validateCandidateRecord(
        await safeReadRecord(vaultPath, resolveInsideRoot(directory, entry), candidateRecordSchema) as EvidenceCandidateRecord
      );
      if (entry !== `${record.id}.md`) {
        throw invalidEvidenceFile(
          "Evidence candidate filename does not match its content ID"
        );
      }
      return record;
    }));
}

async function allVerdicts(
  vaultPath: string
): Promise<EvidenceVerdictRecord[]> {
  const entries = await directoryEntries(vaultPath);
  if (entries.length === 0) return [];
  const directory = await verificationDirectory(vaultPath, false);
  const records = await Promise.all(entries
    .filter((entry) => VERDICT_FILENAME_PATTERN.test(entry))
    .map(async (entry) => {
      const record = validateVerdictRecord(
        await safeReadRecord(vaultPath, resolveInsideRoot(directory, entry), verdictRecordSchema) as EvidenceVerdictRecord
      );
      const expected = `${record.candidateId.replace(/^evidence-/u, "verdict-")}.md`;
      if (entry !== expected) throw invalidEvidenceFile("Evidence verdict filename does not match its candidate ID");
      return record;
    }));
  if (new Set(records.map((record) => record.candidateId)).size !== records.length) {
    throw invalidEvidenceFile("A candidate has more than one verdict file");
  }
  return records;
}

async function allRevocations(
  vaultPath: string
): Promise<EvidenceRevocationRecord[]> {
  const entries = await directoryEntries(vaultPath);
  if (entries.length === 0) return [];
  const directory = await verificationDirectory(vaultPath, false);
  const records = await Promise.all(entries
    .filter((entry) => REVOCATION_FILENAME_PATTERN.test(entry))
    .map(async (entry) => {
      const record = validateRevocationRecord(
        await safeReadRecord(vaultPath, resolveInsideRoot(directory, entry), revocationRecordSchema) as EvidenceRevocationRecord
      );
      const expected = `${record.rootEvidenceId.replace(/^evidence-/u, "revocation-")}.md`;
      if (entry !== expected) throw invalidEvidenceFile("Evidence revocation filename does not match its root evidence ID");
      return record;
    }));
  if (new Set(records.map((record) => record.rootEvidenceId)).size !== records.length) {
    throw invalidEvidenceFile("Evidence has more than one revocation file");
  }
  return records;
}

export async function readVerificationState(
  vaultPath: string
): Promise<VerificationState> {
  const [candidates, verdicts, revocations] = await Promise.all([
    allCandidates(vaultPath), allVerdicts(vaultPath), allRevocations(vaultPath)
  ]);
  return { candidates, verdicts, revocations };
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
    const record = validateCandidateRecord(
      await safeReadRecord(vaultPath, absolutePath, candidateRecordSchema) as EvidenceCandidateRecord
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
