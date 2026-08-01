import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { planAIContextChunks } from "../server/documents/ai-context-builder";
import { segmentMarkdownDocument } from "../server/documents/document-segmenter";
import { parseMarkdownDocument } from "../server/documents/markdown-document-parser";
import { searchStoredDocument } from "../server/documents/document-search";
import { buildDocumentSummaryPlan } from "../server/documents/document-summary-plan";
import type { StoredDocumentIndex } from "../shared/document-contract";
import { createDocumentProfileFixtures } from "./document-profile-fixtures";

const outputPath = resolve(process.argv[2] ?? "artifacts/performance/large-document-profile.json");
const fixtureFilter = process.argv[3];
const temporary = await mkdtemp(join(tmpdir(), "aleksi-document-profile-"));
const profiles = [] as Array<Record<string, unknown>>;

try {
  for (const [ordinal, fixture] of createDocumentProfileFixtures()
    .filter((fixture) => fixtureFilter === undefined || fixture.name === fixtureFilter)
    .entries()) {
    console.log(`Profiling ${fixture.name}...`);
    const path = join(temporary, `${fixture.name}.md`);
    await writeFile(path, fixture.source, "utf8");
    const memoryBefore = process.memoryUsage();
    let started = performance.now();
    const source = await readFile(path, "utf8");
    const fileReadMs = performance.now() - started;

    started = performance.now();
    const parsed = parseMarkdownDocument(source);
    const parseMs = performance.now() - started;
    started = performance.now();
    const segmented = segmentMarkdownDocument(
      `00000000-0000-4000-8000-${String(ordinal + 1).padStart(12, "0")}`,
      parsed
    );
    const segmentationMs = performance.now() - started;
    const index: StoredDocumentIndex = {
      schemaVersion: 1,
      parserVersion: 1,
      documentId: `00000000-0000-4000-8000-${String(ordinal + 1).padStart(12, "0")}`,
      sourcePath: `01-阅读材料/${fixture.name}.md`,
      sourceHash: "0".repeat(64),
      sourceVersion: {
        byteSize: Buffer.byteLength(source, "utf8"),
        modifiedNanoseconds: "0",
        inode: "0"
      },
      title: fixture.name,
      byteSize: Buffer.byteLength(source, "utf8"),
      lineCount: segmented.lineCount,
      outline: segmented.outline,
      chunks: segmented.chunks,
      definitionMarkdown: segmented.definitionMarkdown,
      complexity: segmented.complexity,
      processingStatus: "ready",
      indexedAt: "2026-08-01T00:00:00.000Z",
      diagnostics: parsed.diagnostics
    };
    started = performance.now();
    const serializedIndex = JSON.stringify(index);
    const indexingMs = performance.now() - started;
    started = performance.now();
    const initialChunks = index.chunks.slice(0, 2).map((chunk) =>
      Buffer.from(source, "utf8").subarray(chunk.sourceStartOffset, chunk.sourceEndOffset)
    );
    const initialOpenMs = performance.now() - started;
    const last = index.chunks.at(-1)!;
    started = performance.now();
    Buffer.from(source, "utf8").subarray(last.sourceStartOffset, last.sourceEndOffset);
    const sectionNavigationMs = performance.now() - started;
    started = performance.now();
    const search = searchStoredDocument(index, fixture.searchMarker, 10);
    const searchMs = performance.now() - started;
    started = performance.now();
    const aiPlan = planAIContextChunks(index, {
      documentId: index.documentId,
      activeChunkId: last.chunkId,
      query: fixture.searchMarker,
      mode: "question-answering",
      budgetTokens: 16_000
    });
    const aiContextPlanMs = performance.now() - started;
    started = performance.now();
    const summaryPlan = buildDocumentSummaryPlan(index, 16_000);
    const summaryPlanMs = performance.now() - started;
    const memoryAfter = process.memoryUsage();
    profiles.push({
      name: fixture.name,
      description: fixture.description,
      sourceBytes: Buffer.byteLength(source, "utf8"),
      chunkCount: index.chunks.length,
      outlineRootCount: index.outline.length,
      diagnostics: index.diagnostics,
      oversizedChunkCount: index.chunks.filter((chunk) => chunk.oversized).length,
      searchResultCount: search.length,
      summaryBatchCount: summaryPlan.batches.length,
      aiSelectedChunkCount: aiPlan.selected.length,
      aiEstimatedTokens: aiPlan.totalEstimatedTokens,
      timingsMs: {
        fileRead: Number(fileReadMs.toFixed(3)),
        parse: Number(parseMs.toFixed(3)),
        segmentation: Number(segmentationMs.toFixed(3)),
        indexSerialization: Number(indexingMs.toFixed(3)),
        initialTwoChunkRead: Number(initialOpenMs.toFixed(3)),
        lastSectionNavigation: Number(sectionNavigationMs.toFixed(3)),
        fullDocumentSearch: Number(searchMs.toFixed(3)),
        aiContextPlanning: Number(aiContextPlanMs.toFixed(3)),
        summaryPlanning: Number(summaryPlanMs.toFixed(3))
      },
      memoryBytes: {
        heapBefore: memoryBefore.heapUsed,
        heapAfter: memoryAfter.heapUsed,
        heapDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
        rssBefore: memoryBefore.rss,
        rssAfter: memoryAfter.rss
      },
      serializedIndexBytes: Buffer.byteLength(serializedIndex, "utf8"),
      initialChunkBytes: initialChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    release: process.release.name,
    node: process.version,
    architecture: process.arch
  },
  baseline: {
    status: "hard-limit-failure",
    nativeWholeFileLimitBytes: 1_900_000,
    readingJsonLimitBytes: 2 * 1024 * 1024,
    behavior: "The former file-selection and JSON path rejected book-like fixtures before the Reader could open them."
  },
  finalArchitecture: {
    sourceSafetyCeilingBytes: 128 * 1024 * 1024,
    importPartBytes: 512 * 1024,
    maximumMountedReaderChunks: 3,
    note: "Node timings cover deterministic document-core work. Browser DOM bounds and navigation are verified separately by UI and Playwright tests."
  },
  profiles
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Document performance profile written to ${outputPath}`);
