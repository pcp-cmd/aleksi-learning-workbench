// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import { MarkdownMath } from "../../src/components/MarkdownMath";
import {
  AuthenticatedReadingImage,
  readingImageUrl
} from "../../src/features/reader/ReaderPage";
import {
  readExcerptBasketItems,
  writeExcerptBasketItems
} from "../../src/features/reader/excerpt-basket";
import { readReadingImportDraft } from "../../src/features/reader/reading-import-draft-store";
import { setDesktopApiSession } from "../../src/lib/api-client";
import { hasUnsavedChanges } from "../../src/lib/unsaved-guard";

const READING_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_READING_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_READING_ID = "22222222-2222-4222-8222-222222222222";
const UPDATED_AT = "2026-06-22T03:14:15.926Z";
const SOURCE_PATH = "01-阅读材料/数列极限.md";

type FetchCall = {
  body: unknown;
  method: string;
  url: string;
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function readingMarkdown(title = "数列极限"): string {
  return [
    "---",
    `id: "${READING_ID}"`,
    'type: "reading"',
    `title: "${title}"`,
    'concept: "ε-N"',
    'source: "manual-paste"',
    `createdAt: "${UPDATED_AT}"`,
    "---",
    "",
    `# ${title}`,
    "",
    "对任意 ε > 0，存在 N。",
    "",
    "这是 ==关键高亮== 句。",
    "",
    "行内公式 $x_n \\to a$ 会渲染。",
    "",
    "$$",
    "\\lim_{n\\to\\infty} x_n = a",
    "$$",
    ""
  ].join("\n");
}

function setupFetch(
  options: {
    emptyReadings?: boolean;
    failReadings?: boolean;
    multipleReadings?: boolean;
  } = {}
) {
  const calls: FetchCall[] = [];
  let activeReadingId = READING_ID;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body));
    calls.push({ url, method, body });

    if (url.endsWith("/api/readings") && method === "GET") {
      if (options.failReadings === true) {
        throw new TypeError("Failed to fetch");
      }

      if (options.emptyReadings === true) {
        return response({ readings: [] });
      }

      const primaryReading = {
        id: activeReadingId,
        type: "reading",
        title: activeReadingId === CREATED_READING_ID ? "新材料" : "数列极限",
        concept: "ε-N",
        relativePath:
          activeReadingId === CREATED_READING_ID
            ? "01-阅读材料/新材料.md"
            : SOURCE_PATH,
        updatedAt: UPDATED_AT
      };

      return response({
        readings:
          options.multipleReadings === true
            ? [
                primaryReading,
                {
                  id: SECOND_READING_ID,
                  type: "reading",
                  title: "拓扑空间",
                  concept: "开集",
                  relativePath: "01-阅读材料/拓扑空间.md",
                  updatedAt: "2026-06-23T03:14:15.926Z"
                }
              ]
            : [primaryReading]
      });
    }

    if (url.endsWith(`/api/readings/${READING_ID}`)) {
      return response({
        reading: {
          id: READING_ID,
          type: "reading",
          title: "数列极限",
          concept: "ε-N",
          relativePath: SOURCE_PATH,
          updatedAt: UPDATED_AT,
          rawMarkdown: readingMarkdown()
        }
      });
    }

    if (url.endsWith(`/api/readings/${CREATED_READING_ID}`)) {
      return response({
        reading: {
          id: CREATED_READING_ID,
          type: "reading",
          title: "新材料",
          concept: "ε-N",
          relativePath: "01-阅读材料/新材料.md",
          updatedAt: UPDATED_AT,
          rawMarkdown: readingMarkdown("新材料")
        }
      });
    }

    if (url.endsWith(`/api/readings/${SECOND_READING_ID}`)) {
      return response({
        reading: {
          id: SECOND_READING_ID,
          type: "reading",
          title: "拓扑空间",
          concept: "开集",
          relativePath: "01-阅读材料/拓扑空间.md",
          updatedAt: "2026-06-23T03:14:15.926Z",
          rawMarkdown: readingMarkdown("拓扑空间")
        }
      });
    }

    if (url.endsWith("/api/readings") && method === "POST" && body !== null) {
      activeReadingId = CREATED_READING_ID;
      return response({
        reading: {
          id: CREATED_READING_ID,
          type: "reading",
          title: "新材料",
          concept: "ε-N",
          source: "manual-paste",
          createdAt: UPDATED_AT,
          relativePath: "01-阅读材料/新材料.md",
          modifiedAt: UPDATED_AT
        },
        saveReceipt: {
          relativePath: "01-阅读材料/新材料.md",
          modifiedAt: UPDATED_AT
        }
      });
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function findTextNode(root: Node, text: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node !== null) {
    if (node.textContent?.includes(text)) {
      return node as Text;
    }
    node = walker.nextNode();
  }

  throw new Error(`Text node not found: ${text}`);
}

function selectReaderText(
  text: string,
  rect: Partial<DOMRect> = {}
) {
  const reader = screen.getByTestId("reader-surface");
  const textNode = findTextNode(reader, text);
  const start = textNode.textContent?.indexOf(text) ?? -1;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + text.length);
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => ({
      bottom: rect.bottom ?? 104,
      height: rect.height ?? 20,
      left: rect.left ?? 80,
      right: rect.right ?? 280,
      top: rect.top ?? 84,
      width: rect.width ?? 200,
      x: rect.x ?? rect.left ?? 80,
      y: rect.y ?? rect.top ?? 84,
      toJSON: () => ({})
    }))
  });

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.mouseUp(reader);
}

afterEach(() => {
  queryClient.clear();
  setDesktopApiSession(null);
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
});

describe("Reader surface", () => {
  it("renders the active reading as the only warm paper manuscript surface", async () => {
    setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);

    const reader = await screen.findByTestId("reader-surface");
    expect(reader).toHaveClass("reader-paper");
    expect(reader).toHaveClass("reader-paper--reading-first");
    expect(reader).not.toHaveClass("claude-card");
    expect(document.querySelector(".reader-basket")).toBeNull();
    const materialsButton = screen.getByRole("button", { name: "材料" });
    expect(materialsButton).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "摘录篮 · 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 新材料" })).toBeInTheDocument();
    expect(screen.queryByLabelText("阅读材料列表")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "摘录篮" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("粘贴你要精读的内容")).not.toBeInTheDocument();

    fireEvent.click(materialsButton);
    const materialsDrawer = screen.getByRole("dialog", { name: "材料" });
    expect(within(materialsDrawer).getByLabelText("阅读材料列表")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "材料" })).not.toBeInTheDocument();
    expect(materialsButton).toHaveFocus();

    const readerCss = await readFile(join(process.cwd(), "src/features/reader/reader.css"), "utf8");
    expect(readerCss).toContain(".reader-tools-drawer");
    expect(readerCss).toContain(".reader-tools-triggerbar");
    expect(readerCss).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(readerCss).toContain(".reader-paper");
    expect(readerCss).toContain("max-width: 960px;");
    expect(readerCss).toContain("min-width: min(100%, 480px);");
    expect(readerCss).toContain("background: var(--paper);");
    expect(readerCss).toContain("color: var(--text-primary);");
    expect(readerCss).toContain("font-family: var(--font-serif);");
    expect(readerCss).toContain(".reader-paper .markdown-reader");
    expect(readerCss).not.toContain(".reader-paper:hover");
    expect(readerCss).toContain(".reading-import-receipt");
    expect(readerCss).toContain("overflow-wrap: anywhere;");

    const markdownTheme = await readFile(
      join(process.cwd(), "src/markdown/MarkdownTheme.css"),
      "utf8"
    );
    expect(markdownTheme).toContain(".markdown-reader h1");
    expect(markdownTheme).toContain("font-size: clamp(2.15rem, 3.4vw, 3.65rem);");
    expect(markdownTheme).toContain("font-family: var(--font-mono);");
    expect(markdownTheme).toContain(".markdown-reader table");
  });

  it("opens the reading requested by the Today continue link", async () => {
    setupFetch({ multipleReadings: true });
    window.history.pushState({}, "", `/reader?reading=${SECOND_READING_ID}`);
    render(<App />);

    const surface = await screen.findByTestId("reader-surface");

    await waitFor(() => expect(surface).toHaveTextContent("拓扑空间"));
    expect(surface).not.toHaveTextContent("数列极限");
    expect(surface).toHaveTextContent("阅读材料 · 当前打开");
  });

  it("reopens the last selected reading from the local Reader state", async () => {
    setupFetch({ multipleReadings: true });
    window.history.pushState({}, "", "/reader");
    const firstView = render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });
    fireEvent.click(screen.getByRole("button", { name: "材料" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "材料" })).getByRole("button", {
        name: /拓扑空间/u
      })
    );
    expect(await screen.findByRole("heading", { name: "拓扑空间" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("reading")).toBe(
      SECOND_READING_ID
    );

    firstView.unmount();
    queryClient.clear();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "拓扑空间" })).toBeInTheDocument();
  });

  it("renders inline and block formulas through KaTeX", async () => {
    setupFetch();
    window.history.pushState({}, "", "/reader");
    const { container } = render(<App />);

    expect(await screen.findByRole("heading", { name: "精读工作台" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "数列极限" })).toBeInTheDocument();
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector("mark")).toHaveTextContent("关键高亮");
    expect(screen.queryByText("==关键高亮==")).not.toBeInTheDocument();
    expect(screen.queryByText("$x_n \\to a$")).not.toBeInTheDocument();

    const reader = screen.getByTestId("reader-surface");
    expect(within(reader).getByText("阅读材料 · 当前打开")).toBeInTheDocument();
    expect(within(reader).queryByText(SOURCE_PATH)).not.toBeInTheDocument();
  });

  it("uses a three-action selection toolbar and two-level card menu", async () => {
    setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });

    selectReaderText("对任意 ε > 0，存在 N。");

    const toolbar = await screen.findByRole("toolbar", { name: "选区动作" });
    expect(within(toolbar).getAllByRole("button").map((item) => item.textContent)).toEqual([
      "摘录",
      "创建卡片",
      "记录困难"
    ]);

    fireEvent.click(within(toolbar).getByRole("button", { name: "创建卡片" }));
    const menu = screen.getByRole("menu", { name: "选择卡片类型" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "概念",
      "例子",
      "边界",
      "流程",
      "错误"
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "概念" }));

    expect(window.location.pathname).toBe("/cards");
    expect(sessionStorage.getItem("aleksi.readerSelection")).toBeNull();
    expect(await screen.findByText(SOURCE_PATH)).toBeInTheDocument();
    expect(screen.getByDisplayValue("对任意 ε > 0，存在 N。")).toBeInTheDocument();
  });

  it("adds a reader selection to the excerpt basket and converts it to a card", async () => {
    setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });

    selectReaderText("对任意 ε > 0，存在 N。");
    fireEvent.click(
      within(await screen.findByRole("toolbar", { name: "选区动作" })).getByRole("button", {
        name: "摘录"
      })
    );

    const basket = await screen.findByRole("region", { name: "摘录篮" });
    expect(within(basket).getByText("临时摘录篮")).toBeInTheDocument();
    expect(
      within(basket).getByText(
        "这里的摘录会安全保存在本机。做成卡片或卡点后，摘录会从篮中移除。"
      )
    ).toBeInTheDocument();
    expect(within(basket).getByText("对任意 ε > 0，存在 N。")).toBeInTheDocument();
    expect(within(basket).getByText(SOURCE_PATH)).toBeInTheDocument();
    expect(readExcerptBasketItems()).toEqual([
      expect.objectContaining({
        sourceReadingId: READING_ID,
        sourcePath: SOURCE_PATH,
        concept: "ε-N",
        excerptText: "对任意 ε > 0，存在 N。"
      })
    ]);

    expect(within(basket).getByRole("button", { name: "转成概念卡" })).toBeInTheDocument();
    expect(within(basket).getByRole("button", { name: "转成例子卡" })).toBeInTheDocument();
    expect(within(basket).getByRole("button", { name: "转成边界卡" })).toBeInTheDocument();
    expect(within(basket).getByRole("button", { name: "转成流程卡" })).toBeInTheDocument();
    expect(within(basket).getByRole("button", { name: "转成错误卡" })).toBeInTheDocument();

    fireEvent.click(within(basket).getByRole("button", { name: "转成例子卡" }));

    expect(window.location.pathname).toBe("/cards");
    expect(readExcerptBasketItems()).toEqual([]);
    expect(sessionStorage.getItem("aleksi.readerSelection")).toBeNull();
    expect(await screen.findByText(SOURCE_PATH)).toBeInTheDocument();
    expect(screen.getByDisplayValue("对任意 ε > 0，存在 N。")).toBeInTheDocument();
    expect(screen.getByText("例子卡草稿")).toBeInTheDocument();
    expect(screen.getByLabelText("例子内容")).toBeInTheDocument();
  });

  it("restores the excerpt basket from localStorage and lets the user clear it", async () => {
    setupFetch();
    writeExcerptBasketItems([
        {
          id: "excerpt-existing",
          sourceReadingId: READING_ID,
          sourcePath: SOURCE_PATH,
          concept: "ε-N",
          excerptText: "对任意 ε > 0，存在 N。",
          createdAt: UPDATED_AT
        }
      ]);
    window.history.pushState({}, "", "/reader");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /摘录篮/ }));
    const basket = await screen.findByRole("region", { name: "摘录篮" });
    expect(within(basket).getByText("对任意 ε > 0，存在 N。")).toBeInTheDocument();

    fireEvent.click(within(basket).getByRole("button", { name: "清空摘录篮" }));

    expect(within(basket).queryByText("对任意 ε > 0，存在 N。")).not.toBeInTheDocument();
    expect(readExcerptBasketItems()).toEqual([]);
  });

  it("converts an excerpt basket item to a diagnosis", async () => {
    setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });

    selectReaderText("对任意 ε > 0，存在 N。");
    fireEvent.click(
      within(await screen.findByRole("toolbar", { name: "选区动作" })).getByRole("button", {
        name: "摘录"
      })
    );

    const basket = await screen.findByRole("region", { name: "摘录篮" });
    fireEvent.click(within(basket).getByRole("button", { name: "转成卡点" }));

    expect(window.location.pathname).toBe("/diagnosis");
    expect(JSON.parse(sessionStorage.getItem("aleksi.readerSelection") ?? "{}")).toMatchObject({
      source: "reader-selection",
      target: "diagnosis",
      sourceReadingId: READING_ID,
      sourcePath: SOURCE_PATH,
      excerpt: "对任意 ε > 0，存在 N。"
    });
  });

  it("carries diagnosis context from a reader selection", async () => {
    setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });

    selectReaderText("对任意 ε > 0，存在 N。");
    fireEvent.click(
      within(await screen.findByRole("toolbar", { name: "选区动作" })).getByRole("button", {
        name: "记录困难"
      })
    );

    expect(window.location.pathname).toBe("/diagnosis");
    expect(JSON.parse(sessionStorage.getItem("aleksi.readerSelection") ?? "{}")).toMatchObject({
      source: "reader-selection",
      target: "diagnosis",
      sourceReadingId: READING_ID,
      sourcePath: SOURCE_PATH,
      excerpt: "对任意 ε > 0，存在 N。"
    });
  });

  it("creates a pasted reading and opens the saved receipt target", async () => {
    const { calls } = setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });

    expect(screen.queryByLabelText("标题")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("概念")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Markdown 正文")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));
    fireEvent.change(screen.getByLabelText("粘贴你要精读的内容"), {
      target: { value: "# 新材料\n\n新的阅读正文 $a_n$" }
    });
    fireEvent.click(screen.getByRole("button", { name: "开始精读" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/readings",
        method: "POST",
        body: {
          title: "新材料",
          concept: "新材料",
          body: "# 新材料\n\n新的阅读正文 $a_n$",
          source: "manual-paste"
        }
      })
    );
    expect(await screen.findByRole("heading", { name: "新材料" })).toBeInTheDocument();
    expect((await screen.findAllByText("01-阅读材料/新材料.md")).length).toBeGreaterThan(0);
  });

  it("restores an unfinished new-material draft after the app is reopened", async () => {
    setupFetch();
    window.history.pushState({}, "", "/reader");
    const firstView = render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });
    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));
    fireEvent.change(screen.getByLabelText("粘贴你要精读的内容"), {
      target: { value: "# 尚未保存的材料\n\n恢复正文" }
    });
    await waitFor(() =>
      expect(readReadingImportDraft()?.body).toBe("# 尚未保存的材料\n\n恢复正文")
    );

    firstView.unmount();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "+ 新材料" }));

    expect(screen.getByText("已恢复上次未保存的新材料草稿")).toBeInTheDocument();
    expect(screen.getByLabelText("粘贴你要精读的内容")).toHaveValue(
      "# 尚未保存的材料\n\n恢复正文"
    );
    await waitFor(() => expect(hasUnsavedChanges()).toBe(false));

    fireEvent.change(screen.getByLabelText("粘贴你要精读的内容"), {
      target: { value: "# 尚未保存的材料\n\n恢复正文，随后新增编辑" }
    });
    await waitFor(() => expect(hasUnsavedChanges()).toBe(true));
  });

  it("imports a UTF-8 Markdown file and posts it through the existing reading contract", async () => {
    const { calls } = setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });
    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));

    const bytes = new TextEncoder().encode("# 导入正文\n\n一个新的例子");
    const file = new File([bytes], "导入材料.md", { type: "text/markdown" });
    const readFileBytes = vi.fn(async () => bytes.buffer);
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: readFileBytes
    });
    fireEvent.change(screen.getByLabelText("选择 Markdown 或文本文件"), {
      target: { files: [file] }
    });

    await waitFor(() => expect(readFileBytes).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const alert = screen.queryByRole("alert");
      if (alert !== null) throw new Error(`Import failed: ${alert.textContent}`);
      const textarea = screen.getByLabelText("粘贴你要精读的内容") as HTMLTextAreaElement;
      expect(textarea).toHaveValue("# 导入正文\n\n一个新的例子");
    });
    expect(screen.getByDisplayValue("导入材料")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始精读" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/readings",
        method: "POST",
        body: {
          title: "导入材料",
          concept: "导入材料",
          body: "# 导入正文\n\n一个新的例子",
          source: "file-import",
          sourceFileName: "导入材料.md"
        }
      })
    );
  });

  it("requires an explicit create-new or replace choice for a duplicate import", async () => {
    const { calls } = setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });
    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));

    const bytes = new TextEncoder().encode("新的数列极限材料");
    const file = new File([bytes], "数列极限.md", { type: "text/markdown" });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => bytes.buffer
    });
    fireEvent.change(screen.getByLabelText("选择 Markdown 或文本文件"), {
      target: { files: [file] }
    });
    await screen.findByDisplayValue("数列极限");
    fireEvent.click(screen.getByRole("button", { name: "开始精读" }));

    const conflict = await screen.findByLabelText("同名材料处理");
    expect(within(conflict).getByRole("button", { name: "保留两份" })).toBeInTheDocument();
    fireEvent.click(within(conflict).getByRole("button", { name: "替换原材料" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/readings",
        method: "POST",
        body: {
          title: "数列极限",
          concept: "数列极限",
          body: "新的数列极限材料",
          source: "file-import",
          sourceFileName: "数列极限.md",
          conflictMode: "replace",
          replaceReadingId: READING_ID
        }
      })
    );
  });

  it("keeps the first-run Reader focused on paste-to-read only", async () => {
    setupFetch({ emptyReadings: true });
    window.history.pushState({}, "", "/reader");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "精读工作台" })).toBeInTheDocument();
    expect(screen.queryByLabelText("粘贴你要精读的内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 新材料" })).toBeInTheDocument();
    expect(screen.queryByLabelText("阅读材料列表")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "摘录篮" })).not.toBeInTheDocument();
    expect(screen.getByTestId("reader-surface")).toBeInTheDocument();
    expect(screen.queryByText("Vault 阅读材料")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));
    expect(screen.getByRole("dialog", { name: "新材料" })).toBeInTheDocument();
    expect(screen.getByLabelText("粘贴你要精读的内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始精读" })).toBeInTheDocument();
  });

  it("shows the local service recovery message when readings cannot be fetched", async () => {
    setupFetch({ failReadings: true });
    window.history.pushState({}, "", "/reader");
    render(<App />);

    expect(
      await screen.findByText(
        "无法连接本地服务。请确认 Aleksi Learning Workbench 后端已启动，或重新启动学习器。"
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });

  it("clamps the selection toolbar inside the viewport", async () => {
    setupFetch();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 360
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 240
    });
    window.history.pushState({}, "", "/reader");
    render(<App />);
    await screen.findByRole("heading", { name: "数列极限" });

    selectReaderText("对任意 ε > 0，存在 N。", {
      bottom: 500,
      height: 20,
      left: 900,
      right: 1100,
      top: 480,
      width: 200,
      x: 900,
      y: 480
    });

    const toolbar = await screen.findByRole("toolbar", { name: "选区动作" });
    expect(toolbar).toHaveClass("selection-actions--sheet");
    expect(toolbar).not.toHaveStyle({ left: "16px", top: "144px" });
  });
});

describe("MarkdownMath", () => {
  it("handles CRLF frontmatter and one-character highlights", () => {
    render(
      <MarkdownMath source={"\uFEFF---\r\ntitle: Note\r\n---\r\n\r\nValue: ==x=="} />
    );

    expect(screen.queryByText("title: Note")).not.toBeInTheDocument();
    expect(document.querySelector("mark")?.textContent).toBe("x");
  });

  it("renders and memoizes documents with more than 10,000 lines", () => {
    let paragraphRenders = 0;
    function CountingParagraph({ children }: ComponentProps<"p">) {
      paragraphRenders += 1;
      return <p>{children}</p>;
    }
    const components = { p: CountingParagraph };
    const source = Array.from(
      { length: 10_001 },
      (_, index) => `line-${index}`
    ).join("\n");

    const { container, rerender } = render(
      <MarkdownMath components={components} source={source} />
    );

    expect(container.textContent).toContain("line-0");
    expect(container.textContent).toContain("line-10000");
    expect(paragraphRenders).toBe(1);

    rerender(<MarkdownMath components={components} source={source} />);
    expect(paragraphRenders).toBe(1);
  });

  it("renders GFM tables, task lists, strikethrough, autolinks, and footnotes", async () => {
    render(
      <MarkdownMath
        source={[
          "# Obsidian Note",
          "",
          "| Concept | Description |",
          "| :--- | ---: |",
          "| Schema | Mental structure |",
          "",
          "- [ ] Learn Analysis",
          "- [x] Finish Statistics",
          "",
          "~~Deprecated~~",
          "",
          "https://openai.com",
          "",
          "Text[^1]",
          "",
          "[^1]: explanation"
        ].join("\n")}
      />
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Concept" })).toHaveStyle({
      textAlign: "left"
    });
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[1]).toBeDisabled();
    expect(screen.getByText("Learn Analysis")).toBeInTheDocument();
    expect(screen.getByText("Finish Statistics")).toBeInTheDocument();
    expect(document.querySelector("del")?.textContent).toBe("Deprecated");

    const link = screen.getByRole("link", { name: "https://openai.com" });
    expect(link).toHaveAttribute("href", "https://openai.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    expect(await screen.findByText("explanation")).toBeInTheDocument();
  });

  it("renders images with lazy loading and a zoom affordance", () => {
    const resolveImageUrl = vi.fn(
      (source: string) =>
        `/api/readings/11111111-1111-4111-8111-111111111111/media?path=${encodeURIComponent(source)}`
    );
    render(
      <MarkdownMath
        resolveImageUrl={resolveImageUrl}
        source="![Diagram](assets/diagram.png)"
      />
    );

    const button = screen.getByRole("button", { name: "放大图片：Diagram" });
    const image = screen.getByRole("img", { name: "Diagram" });
    expect(button).toContainElement(image);
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute(
      "src",
      "/api/readings/11111111-1111-4111-8111-111111111111/media?path=assets%2Fdiagram.png"
    );
    expect(resolveImageUrl).toHaveBeenCalledWith("assets/diagram.png");
  });

  it("keeps browser-development reading images on their relative lazy-loading path", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MarkdownMath
        components={{ img: AuthenticatedReadingImage }}
        resolveImageUrl={(source) =>
          `/api/readings/${READING_ID}/media?path=${encodeURIComponent(source)}`
        }
        source="![Diagram](assets/diagram.png)"
      />
    );

    expect(screen.getByRole("img", { name: "Diagram" })).toHaveAttribute(
      "src",
      `/api/readings/${READING_ID}/media?path=assets%2Fdiagram.png`
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects absolute loopback and external reading-image URLs", () => {
    expect(
      readingImageUrl(READING_ID, "http://127.0.0.1:43127/private")
    ).toBe("");
    expect(readingImageUrl(READING_ID, "https://example.com/image.png")).toBe(
      ""
    );
    expect(readingImageUrl(READING_ID, "//127.0.0.1/image.png")).toBe("");
    expect(readingImageUrl(READING_ID, "/api/private")).toBe("");
    expect(
      readingImageUrl(READING_ID, "data:image/png;base64,iVBORw0KGgo=")
    ).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("loads protected desktop reading images with authentication and revokes the object URL", async () => {
    const protocolSecret = "a".repeat(64);
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(imageBytes, {
        status: 200,
        headers: {
          "Content-Length": String(imageBytes.byteLength),
          "Content-Type": "image/png"
        }
      })
    );
    const createObjectURL = vi.fn(() => "blob:aleksi-reading-image");
    const revokeObjectURL = vi.fn();
    class ObjectUrlAwareUrl extends URL {}
    Object.defineProperties(ObjectUrlAwareUrl, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL }
    });
    vi.stubGlobal("URL", ObjectUrlAwareUrl);
    vi.stubGlobal("fetch", fetchMock);
    setDesktopApiSession({
      apiBaseUrl: "http://127.0.0.1:43127",
      protocolSecret
    });

    const { unmount } = render(
      <MarkdownMath
        components={{ img: AuthenticatedReadingImage }}
        resolveImageUrl={(source) =>
          `/api/readings/${READING_ID}/media?path=${encodeURIComponent(source)}`
        }
        source="![Diagram](assets/diagram.png)"
      />
    );

    const image = await screen.findByRole("img", { name: "Diagram" });
    await waitFor(() =>
      expect(image).toHaveAttribute("src", "blob:aleksi-reading-image")
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:43127/api/readings/${READING_ID}/media?path=assets%2Fdiagram.png`,
      expect.objectContaining({
        method: "GET",
        headers: { "X-Aleksi-Protocol-Secret": protocolSecret },
        signal: expect.any(AbortSignal)
      })
    );
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/png" })
    );

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:aleksi-reading-image");
  });

  it("renders fenced code blocks with a language badge and copy action", () => {
    render(<MarkdownMath source={"```ts\nconst value = 1;\n```"} />);

    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.getByText("const value = 1;")).toBeInTheDocument();
  });

  it("reports code-copy success and failure accessibly", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(
      new Error("clipboard denied")
    );
    vi.stubGlobal("navigator", {
      ...window.navigator,
      clipboard: { writeText }
    });
    render(<MarkdownMath source={"```ts\nconst value = 1;\n```"} />);

    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(await screen.findByRole("button", { name: "已复制" })).toHaveAttribute(
      "aria-live",
      "polite"
    );
    expect(writeText).toHaveBeenLastCalledWith("const value = 1;");

    fireEvent.click(screen.getByRole("button", { name: "已复制" }));
    expect(
      await screen.findByRole("button", { name: "复制失败" })
    ).toBeInTheDocument();
  });

  it("keeps unlabeled fenced code as a block with a fallback language badge", () => {
    render(<MarkdownMath source={"```\nplain block\n```"} />);

    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.getByText("plain block")).toBeInTheDocument();
  });

  it("shows raw Markdown when rendering fails", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    function ThrowingParagraph({ children: _children }: ComponentProps<"p">): ReactNode {
      throw new Error("render failed");
    }

    render(
      <MarkdownMath
        components={{ p: ThrowingParagraph }}
        source={`# 原始材料\n\nRaw **Markdown** with $x_n$.`}
      />
    );

    expect(screen.getByTestId("markdown-raw-fallback").textContent).toContain("# 原始材料");
    expect(screen.getByTestId("markdown-raw-fallback").textContent).toContain(
      "Raw **Markdown** with $x_n$."
    );
    consoleError.mockRestore();
  });
});
