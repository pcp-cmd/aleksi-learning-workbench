import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  rm
} from "node:fs/promises";
import { dirname } from "node:path";
import { atomicCreateText, atomicWriteText } from "../lib/atomic-write";
import { readBoundedRegularFile } from "../lib/bounded-regular-file";
import { hasErrorCode } from "../lib/error-code";
import {
  assertRealPathInsideRoot,
  resolveInsideRoot
} from "../lib/path-safety";
import {
  transactionJournalSchema,
  type TransactionJournal
} from "./transaction-types";

export const TRANSACTION_DIRECTORY = ".aleksi/transactions";
const MAX_TRANSACTION_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function readTextIfPresent(
  root: string,
  path: string,
  maxBytes = MAX_TRANSACTION_TEXT_BYTES
): Promise<string | null> {
  try {
    return (
      await readBoundedRegularFile(root, path, {
        maxBytes,
        label: "Transaction file"
      })
    ).data.toString("utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function journalPath(vaultPath: string, transactionId: string): string {
  return resolveInsideRoot(
    vaultPath,
    `${TRANSACTION_DIRECTORY}/${transactionId}.json`
  );
}

function mirrorPath(vaultPath: string, transactionId: string): string {
  return resolveInsideRoot(
    vaultPath,
    `${TRANSACTION_DIRECTORY}/${transactionId}.mirror`
  );
}

export async function ensureTransactionDirectory(
  vaultPath: string
): Promise<string> {
  const directory = resolveInsideRoot(vaultPath, TRANSACTION_DIRECTORY);
  await assertRealPathInsideRoot(vaultPath, dirname(directory));
  await mkdir(directory, { recursive: true });
  await assertRealPathInsideRoot(vaultPath, directory);
  const information = await lstat(directory);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error("Transaction path must be a non-symlink directory");
  }
  return directory;
}

export async function ensureTransactionPayloadDirectory(
  vaultPath: string,
  transactionId: string
): Promise<string> {
  await ensureTransactionDirectory(vaultPath);
  const directory = resolveInsideRoot(
    vaultPath,
    `${TRANSACTION_DIRECTORY}/${transactionId}`
  );
  await assertRealPathInsideRoot(vaultPath, dirname(directory));
  await mkdir(directory);
  await assertRealPathInsideRoot(vaultPath, directory);
  const information = await lstat(directory);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error("Transaction payload path must be a non-symlink directory");
  }
  return directory;
}

function serializedJournal(journal: TransactionJournal): string {
  return `${JSON.stringify(transactionJournalSchema.parse(journal), null, 2)}\n`;
}

export async function persistJournal(
  vaultPath: string,
  journal: TransactionJournal
): Promise<void> {
  await ensureTransactionDirectory(vaultPath);
  const content = serializedJournal(journal);
  await atomicWriteText(mirrorPath(vaultPath, journal.transactionId), content, {
    root: vaultPath
  });
  await atomicWriteText(journalPath(vaultPath, journal.transactionId), content, {
    root: vaultPath
  });
}

async function parseJournalFile(
  vaultPath: string,
  path: string
): Promise<TransactionJournal | null> {
  const raw = await readTextIfPresent(
    vaultPath,
    path,
    MAX_JOURNAL_BYTES
  );
  if (raw === null) {
    return null;
  }
  return transactionJournalSchema.parse(JSON.parse(raw));
}

export async function loadJournal(
  vaultPath: string,
  transactionId: string
): Promise<TransactionJournal> {
  const [primary, mirror] = await Promise.all([
    parseJournalFile(vaultPath, journalPath(vaultPath, transactionId)).catch(
      () => null
    ),
    parseJournalFile(vaultPath, mirrorPath(vaultPath, transactionId)).catch(
      () => null
    )
  ]);
  const candidates = [primary, mirror].filter(
    (candidate): candidate is TransactionJournal => candidate !== null
  );
  const latest = candidates.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )[0];
  if (latest === undefined) {
    throw new Error(`Transaction journal ${transactionId} is unreadable`);
  }
  return latest;
}

export async function listTransactionIds(vaultPath: string): Promise<string[]> {
  const directory = await ensureTransactionDirectory(vaultPath);
  await assertRealPathInsideRoot(vaultPath, directory);
  const entries = await readdir(directory);
  return Array.from(
    new Set(
      entries
        .map((entry) =>
          entry.endsWith(".json")
            ? entry.slice(0, -".json".length)
            : entry.endsWith(".mirror")
              ? entry.slice(0, -".mirror".length)
              : null
        )
        .filter((entry): entry is string => entry !== null)
    )
  ).sort();
}

export async function cleanupJournal(
  vaultPath: string,
  transactionId: string
): Promise<void> {
  await Promise.all([
    rm(journalPath(vaultPath, transactionId), { force: true }),
    rm(mirrorPath(vaultPath, transactionId), { force: true }),
    rm(
      resolveInsideRoot(
        vaultPath,
        `${TRANSACTION_DIRECTORY}/${transactionId}`
      ),
      { force: true, recursive: true }
    )
  ]);
}

export async function writeTransactionPayload(
  vaultPath: string,
  relativePath: string,
  content: string
): Promise<void> {
  const absolutePath = resolveInsideRoot(vaultPath, relativePath);
  await assertRealPathInsideRoot(vaultPath, dirname(absolutePath));
  await atomicCreateText(absolutePath, content, { root: vaultPath });
}
