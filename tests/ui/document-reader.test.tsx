// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningDocumentDescriptor } from "../../shared/document-contract";
import { LibraryIdentityContext } from "../../src/lib/library-identity";
import { DocumentReader } from "../../src/features/reader/DocumentReader";

vi.mock("../../src/features/reader/document-api", () => ({
  loadDocumentChunk: vi.fn(async (_documentId: string, chunkId: string) =>
    chunkId === "chunk-b"
      ? "## 第二节\n\n目标正文"
      : "## 第一节\n\n[进入实验](03-lab.md)\n\n[外部](https://example.com)"
  ),
  searchDocument: vi.fn(async () => ({ results: [] }))
}));

const descriptor: LearningDocumentDescriptor = {
  documentId: "doc-1",
  relativePath: "A/F00/01-lesson.md",
  sourceHash: "hash",
  sizeBytes: 100,
  lineCount: 10,
  complexity: {
    bytes: 100,
    lines: 10,
    headingCount: 2,
    estimatedTokens: 20,
    mode: "small",
    reasons: []
  },
  chunks: [
    {
      chunkId: "chunk-a",
      headingPath: ["第一节"],
      sourceStartOffset: 0,
      sourceEndOffset: 50,
      sourceStartLine: 1,
      sourceEndLine: 5,
      estimatedTokens: 10
    },
    {
      chunkId: "chunk-b",
      headingPath: ["第二节"],
      sourceStartOffset: 50,
      sourceEndOffset: 100,
      sourceStartLine: 6,
      sourceEndLine: 10,
      estimatedTokens: 10
    }
  ],
  outline: [
    {
      title: "第一节",
      depth: 2,
      chunkId: "chunk-a",
      sourceOffset: 0,
      children: []
    },
    {
      title: "第二节",
      depth: 2,
      chunkId: "chunk-b",
      sourceOffset: 50,
      children: []
    }
  ]
};

function renderReader(onDocumentLink?: (href: string) => boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <LibraryIdentityContext.Provider value={{ libraryId: "lib", revision: "1" }}>
      <QueryClientProvider client={client}>
        <DocumentReader
          descriptor={descriptor}
          onActiveChunkChange={() => undefined}
          onDocumentLink={onDocumentLink}
          resolveImageUrl={(source) => source}
        />
      </QueryClientProvider>
    </LibraryIdentityContext.Provider>
  );
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 300
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DocumentReader", () => {
  it("renders indexed chunks", async () => {
    renderReader();
    expect(await screen.findByText("第一节")).toBeTruthy();
  });

  it("passes local markdown links to the document link handler", async () => {
    const onDocumentLink = vi.fn(() => true);
    renderReader(onDocumentLink);

    const local = await screen.findByRole("link", { name: "进入实验" });
    fireEvent.click(local);
    expect(onDocumentLink).toHaveBeenCalledWith("03-lab.md");
  });

  it("leaves external links external", async () => {
    const onDocumentLink = vi.fn(() => true);
    renderReader(onDocumentLink);

    const external = await screen.findByRole("link", { name: "外部" });
    expect(external.getAttribute("target")).toBe("_blank");
    fireEvent.click(external);
    expect(onDocumentLink).not.toHaveBeenCalledWith("https://example.com");
  });

  it("can activate a neighboring chunk from the outline", async () => {
    renderReader();
    const summary = screen.getByText(/完整目录/);
    fireEvent.click(summary);
    const button = await screen.findByRole("button", { name: "第二节" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByText("目标正文")).toBeTruthy();
    });
  });

  it("does not crash when resize observer is unavailable", async () => {
    const previous = globalThis.ResizeObserver;
    // @ts-expect-error test removes browser API
    delete globalThis.ResizeObserver;
    try {
      renderReader();
      expect(await screen.findByText("第一节")).toBeTruthy();
    } finally {
      globalThis.ResizeObserver = previous;
    }
  });

  it("updates the active chunk after manual scroll", async () => {
    const onActiveChunkChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <LibraryIdentityContext.Provider value={{ libraryId: "lib", revision: "1" }}>
        <QueryClientProvider client={client}>
          <DocumentReader
            descriptor={descriptor}
            onActiveChunkChange={onActiveChunkChange}
            resolveImageUrl={(source) => source}
          />
        </QueryClientProvider>
      </LibraryIdentityContext.Provider>
    );
    await screen.findByText("第一节");
    await act(async () => {
      window.dispatchEvent(new Event("wheel"));
      window.dispatchEvent(new Event("scroll"));
    });
    expect(onActiveChunkChange).toHaveBeenCalled();
  });
});
