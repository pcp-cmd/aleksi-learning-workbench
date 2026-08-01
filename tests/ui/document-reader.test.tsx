// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningDocumentDescriptor } from "../../shared/document-contract";
import { DocumentReader } from "../../src/features/reader/DocumentReader";

const DOCUMENT_ID = "99999999-9999-4999-8999-999999999999";

function descriptor(): LearningDocumentDescriptor {
  const chunks = Array.from({ length: 10 }, (_, index) => ({
    chunkId: `chunk-${index}`,
    documentId: DOCUMENT_ID,
    title: `第 ${index + 1} 章`,
    headingLevel: 1,
    headingPath: [`第 ${index + 1} 章`],
    sourceStartOffset: index * 100,
    sourceEndOffset: (index + 1) * 100,
    sourceStartLine: index * 5 + 1,
    sourceEndLine: (index + 1) * 5,
    contentHash: `${index}`.repeat(64).slice(0, 64),
    estimatedTokens: 100,
    oversized: false,
    ...(index === 0 ? {} : { previousChunkId: `chunk-${index - 1}` }),
    ...(index === 9 ? {} : { nextChunkId: `chunk-${index + 1}` })
  }));
  return {
    schemaVersion: 1,
    parserVersion: 1,
    documentId: DOCUMENT_ID,
    sourcePath: "01-阅读材料/大型材料.md",
    sourceHash: "a".repeat(64),
    sourceVersion: { byteSize: 1_000, modifiedNanoseconds: "1", inode: "2" },
    title: "大型材料",
    byteSize: 1_000,
    lineCount: 50,
    outline: chunks.map((chunk, index) => ({
      nodeId: `outline-${index}`,
      documentId: DOCUMENT_ID,
      chunkId: chunk.chunkId,
      title: chunk.title,
      level: 1,
      sourceStartOffset: chunk.sourceStartOffset,
      sourceStartLine: chunk.sourceStartLine,
      children: []
    })),
    chunks,
    complexity: {
      mode: "large",
      reasons: ["many-sections"],
      metrics: {
        byteSize: 1_000,
        lineCount: 50,
        astNodeCount: 100,
        headingCount: 10,
        paragraphCount: 10,
        mathBlockCount: 0,
        codeBlockCount: 0,
        tableCount: 0,
        estimatedRenderedNodeCount: 100,
        estimatedTokens: 1_000,
        maximumSingleBlockBytes: 100
      }
    },
    processingStatus: "ready",
    indexedAt: "2026-08-01T00:00:00.000Z",
    diagnostics: []
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("incremental document reader", () => {
  it("remeasures rendered chunks before replacing them with virtual spacers", async () => {
    const observations: Array<{
      callback: ResizeObserverCallback;
      element: Element;
    }> = [];
    class MockResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(element: Element) {
        observations.push({ callback: this.callback, element });
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const chunk = String(input).match(/\/chunks\/(chunk-\d+)\/content/u)?.[1] ?? "unknown";
      return new Response(`# ${chunk}\n\n${"rendered content ".repeat(40)}`, {
        status: 200,
        headers: { "Content-Type": "text/markdown" }
      });
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
    const documentDescriptor = descriptor();
    documentDescriptor.sourceHash = "b".repeat(64);
    render(
      <QueryClientProvider client={client}>
        <DocumentReader
          descriptor={documentDescriptor}
          initialChunkId="chunk-0"
          onActiveChunkChange={() => undefined}
          resolveImageUrl={(source) => source}
        />
      </QueryClientProvider>
    );

    await screen.findByRole("heading", { name: "chunk-0" });
    const firstChunk = document.querySelector<HTMLElement>('[data-chunk-id="chunk-0"]');
    expect(firstChunk).not.toBeNull();
    Object.defineProperty(firstChunk, "offsetHeight", {
      configurable: true,
      value: 777
    });
    for (const observation of observations.filter(({ element }) => element === firstChunk)) {
      observation.callback([], {} as ResizeObserver);
    }

    fireEvent.click(screen.getByRole("button", {
      name: documentDescriptor.outline[2]?.title
    }));
    await waitFor(() => expect(document.querySelector('[data-chunk-id="chunk-2"]'))
      .toBeInTheDocument());
    const topSpacer = document.querySelector<HTMLElement>(".document-window-spacer");
    expect(topSpacer).toHaveStyle({ height: "777px" });
  });

  it("loads only the active section and neighbors, then uses full-document metadata for navigation", async () => {
    const requestedChunks: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const chunk = url.match(/\/chunks\/(chunk-\d+)\/content/u)?.[1];
      if (chunk !== undefined) {
        requestedChunks.push(chunk);
        return new Response(`# ${chunk}`, {
          status: 200,
          headers: { "Content-Type": "text/markdown" }
        });
      }
      if (url.includes("/search?")) {
        return new Response(JSON.stringify({
          results: [{
            documentId: DOCUMENT_ID,
            chunkId: "chunk-9",
            headingPath: ["第 10 章"],
            preview: "最后一章的唯一标记",
            sourceStartOffset: 900,
            sourceEndOffset: 1_000,
            sourceStartLine: 46,
            sourceEndLine: 50
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
    const active = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <DocumentReader
          descriptor={descriptor()}
          initialChunkId="chunk-5"
          onActiveChunkChange={active}
          resolveImageUrl={(source) => source}
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(new Set(requestedChunks)).toEqual(
      new Set(["chunk-4", "chunk-5", "chunk-6"])
    ));
    expect(document.querySelectorAll(".document-chunk")).toHaveLength(3);
    expect(screen.getByText("完整目录 · 10 个主章节")).toBeInTheDocument();

    fireEvent.click(screen.getByText("完整目录 · 10 个主章节"));
    fireEvent.click(screen.getByRole("button", { name: "第 10 章" }));
    await waitFor(() => expect(document.querySelector('[data-chunk-id="chunk-9"]'))
      .toBeInTheDocument());
    expect(document.querySelectorAll(".document-chunk")).toHaveLength(2);
    expect(requestedChunks).toEqual(expect.arrayContaining(["chunk-8", "chunk-9"]));

    fireEvent.click(screen.getByText("全文搜索"));
    fireEvent.change(screen.getByLabelText("搜索完整材料"), {
      target: { value: "唯一标记" }
    });
    fireEvent.submit(screen.getByRole("search"));
    expect(await screen.findByText("最后一章的唯一标记")).toBeInTheDocument();
    fireEvent.click(screen.getByText("最后一章的唯一标记"));
    await waitFor(() => expect(active).toHaveBeenLastCalledWith("chunk-9"));
  });
});
