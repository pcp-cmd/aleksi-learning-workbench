import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { assertRealPathInsideRoot } from "../lib/path-safety";
import { IndexAssetParseError, type MarkdownCandidate } from "./index-contract";
import {
  acquireIndexResource,
  MAX_INDEX_MARKDOWN_BYTES,
  withinIndexScanBudget,
  type IndexTraversalBudget
} from "./index-scan-budget";

const INDEX_READ_CHUNK_BYTES = 64 * 1024;

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  if (left.ino === 0n || right.ino === 0n) return false;
  return process.platform === "win32"
    ? left.ino === right.ino
    : left.dev === right.dev && left.ino === right.ino;
}

function sameCandidateIdentity(information: BigIntStats, candidate: MarkdownCandidate) {
  if (information.ino === 0n || candidate.inode === 0n) return false;
  return process.platform === "win32"
    ? information.ino === candidate.inode
    : information.dev === candidate.device && information.ino === candidate.inode;
}

function changedCandidate(candidate: MarkdownCandidate) {
  return new IndexAssetParseError("ASSET_FILE_CHANGED",
    `${candidate.relativePath} changed during index validation`);
}

export function filesystemModifiedAt(information: BigIntStats): string {
  return new Date(Number((information.mtimeNs + 500_000n) / 1_000_000n)).toISOString();
}

export async function assertStableDirectory(vaultPath: string, directoryPath: string,
  initialInformation: BigIntStats, budget: IndexTraversalBudget, relativePath: string) {
  await withinIndexScanBudget(budget, () => assertRealPathInsideRoot(vaultPath, directoryPath));
  const current = await withinIndexScanBudget(budget, () => lstat(directoryPath, { bigint: true }));
  if (!current.isDirectory() || current.isSymbolicLink() ||
      !sameFileIdentity(initialInformation, current) ||
      initialInformation.mtimeNs !== current.mtimeNs ||
      initialInformation.ctimeNs !== current.ctimeNs) {
    throw new IndexAssetParseError("INVALID_FILESYSTEM_ENTRY",
      `${relativePath} changed during directory validation`);
  }
}

export async function readMarkdownCandidateBounded(vaultPath: string,
  candidate: MarkdownCandidate, budget: IndexTraversalBudget): Promise<string> {
  const tooLarge = () => new IndexAssetParseError("ASSET_FILE_TOO_LARGE",
    `${candidate.relativePath} exceeds the ${MAX_INDEX_MARKDOWN_BYTES} byte file limit`);
  if (candidate.size > BigInt(MAX_INDEX_MARKDOWN_BYTES)) throw tooLarge();
  const handle = await acquireIndexResource(budget, () =>
    open(candidate.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)));
  try {
    const opened = await withinIndexScanBudget(budget, () => handle.stat({ bigint: true }));
    await withinIndexScanBudget(budget, () => assertRealPathInsideRoot(vaultPath, candidate.absolutePath));
    const current = await withinIndexScanBudget(budget, () => lstat(candidate.absolutePath, { bigint: true }));
    if (!opened.isFile() || !current.isFile() || current.isSymbolicLink() ||
        !sameFileIdentity(opened, current) || !sameCandidateIdentity(opened, candidate) ||
        opened.size !== candidate.size || opened.mtimeNs !== candidate.modifiedNanoseconds ||
        opened.ctimeNs !== candidate.changedNanoseconds) throw changedCandidate(candidate);
    if (opened.size > BigInt(MAX_INDEX_MARKDOWN_BYTES)) throw tooLarge();
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_INDEX_MARKDOWN_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(INDEX_READ_CHUNK_BYTES,
        MAX_INDEX_MARKDOWN_BYTES + 1 - total));
      const { bytesRead } = await withinIndexScanBudget(budget,
        () => handle.read(chunk, 0, chunk.length, null));
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > MAX_INDEX_MARKDOWN_BYTES) throw tooLarge();
    const finalOpened = await withinIndexScanBudget(budget, () => handle.stat({ bigint: true }));
    const finalPath = await withinIndexScanBudget(budget, () => lstat(candidate.absolutePath, { bigint: true }));
    if (!sameFileIdentity(finalOpened, finalPath) || finalOpened.size !== opened.size ||
        finalOpened.mtimeNs !== opened.mtimeNs || finalOpened.ctimeNs !== opened.ctimeNs ||
        finalPath.size !== opened.size || finalPath.mtimeNs !== opened.mtimeNs ||
        finalPath.ctimeNs !== opened.ctimeNs || BigInt(total) !== opened.size) {
      throw changedCandidate(candidate);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally { await handle.close(); }
}
