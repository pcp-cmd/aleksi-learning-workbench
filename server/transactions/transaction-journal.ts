import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import { resolveInsideRoot } from "../lib/path-safety";
import {
  transactionJournalSchema,
  type TransactionJournal
} from "./transaction-types";

export const TRANSACTION_DIRECTORY = ".aleksi/transactions";

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function readTextIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
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
  await mkdir(directory, { recursive: true });
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

async function parseJournalFile(path: string): Promise<TransactionJournal | null> {
  const raw = await readTextIfPresent(path);
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
    parseJournalFile(journalPath(vaultPath, transactionId)).catch(() => null),
    parseJournalFile(mirrorPath(vaultPath, transactionId)).catch(() => null)
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
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
}
