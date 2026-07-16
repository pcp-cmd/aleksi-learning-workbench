// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import { READER_SELECTION_STORAGE_KEY } from "../../src/features/reader/selection";

const NOW = "2026-06-29T03:04:05.006Z";
const READING_ID = "11111111-1111-4111-8111-111111111111";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_PATH = "01-阅读材料/数列极限.md";
const EXCERPT = "对任意 ε > 0，存在 N。";

type FetchCall = {
  body: unknown;
  method: string;
  url: string;
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function setupFetch() {
  const calls: FetchCall[] = [];
  let readingPostAttempts = 0;
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

    if (url.endsWith("/api/vault/status") || url.endsWith("/api/vault/auto-prepare")) {
      return response({
        status: {
          path: "C:\\Vault",
          initialized: true,
          writable: true,
          readOnlyReason: null,
          lastSaveAt: NOW
        }
      });
    }

    if (url.endsWith("/api/review/today") && method === "GET") {
      return response({
        generatedAt: NOW,
        items: [
          {
            cardId: CARD_ID,
            cardPath: "02-定义卡/ε-N-定义卡.md",
            cardType: "definition",
            concept: "ε-N",
            mastery: "learning",
            nextReview: "2026-06-29",
            lastReviewSequence: null,
            lastReviewed: null,
            due: true,
            prompt: "请闭卷写出 ε-N 定义的关键结构。"
          }
        ]
      });
    }

    if (url.endsWith(`/api/review/${CARD_ID}/attempt`) && method === "POST") {
      return response({
        attemptId: "review-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        attemptedAt: NOW,
        promptVersion: "recall-v1",
        replayed: false,
        revealedCard: {
          id: CARD_ID,
          type: "definition",
          title: "ε-N 定义卡",
          concept: "ε-N",
          relatedConcepts: ["数列极限"],
          excerpt: EXCERPT,
          understanding: "先给精度，再找统一阶段。",
          blockType: "definition",
          nextAction: "闭卷重写量词顺序。",
          formalDefinition: "∀ε>0, ∃N, n>N ⇒ |x_n-a|<ε。",
          plainExplanation: "后续项会进入任意小邻域。",
          quantifierStructure: "∀ε ∃N ∀n",
          commonMisunderstandings: "N 不能依赖 n。"
        }
      });
    }

    if (url.endsWith("/api/graph/state")) {
      return response({
        generatedAt: NOW,
        concepts: {
          "ε-N": {
            concept: "ε-N",
            rings: {
              concept: { count: 1, coverage: "established", learningStatus: "due-for-review", evidenceConfidence: "unverified" },
              example: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
              boundary: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
              process: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
              mistake: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" }
            },
            currentBlock: "proof-search",
            nextAction: "补 1 张例子卡",
            hasDueReview: true,
            relatedConcepts: [],
            suggestedNextActions: ["补 1 张例子卡", "补 1 张边界卡", "完成今日到期复习"]
          }
        }
      });
    }

    if (url.endsWith("/api/readings") && method === "GET") {
      return response({
        readings: [
          {
            id: READING_ID,
            type: "reading",
            title: "数列极限",
            concept: "ε-N",
            relativePath: SOURCE_PATH,
            updatedAt: NOW
          }
        ]
      });
    }

    if (url.endsWith("/api/cards/recent?limit=10") && method === "GET") {
      return response({ cards: [] });
    }

    if (url.endsWith(`/api/readings/${READING_ID}`)) {
      return response({
        reading: {
          id: READING_ID,
          type: "reading",
          title: "数列极限",
          concept: "ε-N",
          relativePath: SOURCE_PATH,
          updatedAt: NOW,
          rawMarkdown: `# 数列极限\n\n${EXCERPT}\n\n$x_n \\to a$`
        }
      });
    }

    if (url.endsWith("/api/readings") && method === "POST") {
      readingPostAttempts += 1;
      if (readingPostAttempts === 1) {
        return response(
          { error: { code: "SAVE_FAILED", message: "磁盘暂时不可写" } },
          500
        );
      }

      return response({
        reading: {
          id: "33333333-3333-4333-8333-333333333333",
          relativePath: "01-阅读材料/新材料.md"
        },
        saveReceipt: {
          modifiedAt: NOW,
          relativePath: "01-阅读材料/新材料.md"
        }
      });
    }

    if (url.endsWith("/api/cards") && method === "POST") {
      return response(
        { error: { code: "SAVE_FAILED", message: "卡片保存失败" } },
        500
      );
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function seedCardSelection() {
  sessionStorage.setItem(
    READER_SELECTION_STORAGE_KEY,
    JSON.stringify({
      source: "reader-selection",
      target: "cards",
      cardType: "definition",
      sourceReadingId: READING_ID,
      sourcePath: SOURCE_PATH,
      concept: "ε-N",
      excerpt: EXCERPT
    })
  );
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

function selectReaderText(text: string) {
  const reader = screen.getByTestId("reader-surface");
  const textNode = findTextNode(reader, text);
  const start = textNode.textContent?.indexOf(text) ?? -1;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + text.length);
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => ({
      bottom: 104,
      height: 20,
      left: 80,
      right: 280,
      top: 84,
      width: 200,
      x: 80,
      y: 84,
      toJSON: () => ({})
    }))
  });

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.mouseUp(reader);
}

function beforeUnloadEvent() {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  Object.defineProperty(event, "returnValue", {
    configurable: true,
    value: "",
    writable: true
  });
  return event;
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
});

describe("unsaved learning work safety", () => {
  it("blocks programmatic shortcut navigation while a draft is dirty", async () => {
    setupFetch();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    window.history.pushState({}, "", "/reader");
    render(<App />);

    await screen.findByRole("heading", { name: "数列极限" }, { timeout: 5_000 });
    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));
    fireEvent.change(screen.getByLabelText("粘贴你要精读的内容"), {
      target: { value: "# 不能被快捷键丢掉的草稿" }
    });
    const readerLocationBeforeShortcut = `${window.location.pathname}${window.location.search}`;
    fireEvent.keyDown(window, { ctrlKey: true, key: "o" });

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith("你有未保存的学习内容，确认要离开吗？")
    );
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      readerLocationBeforeShortcut
    );
    expect(screen.getByLabelText("粘贴你要精读的内容")).toHaveValue(
      "# 不能被快捷键丢掉的草稿"
    );
  });

  it("blocks dirty route navigation and marks beforeunload as unsafe", async () => {
    setupFetch();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    window.history.pushState({}, "", "/reader");
    render(<App />);

    await screen.findByRole("heading", { name: "数列极限" }, { timeout: 5_000 });
    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));
    fireEvent.change(screen.getByLabelText("粘贴你要精读的内容"), {
      target: { value: "# 还没保存的 ε-N 阅读\n\n对任意 ε > 0，存在 N。" }
    });

    const unload = beforeUnloadEvent();
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    expect(unload.returnValue).toBe("你有未保存的学习内容，确认要离开吗？");

    fireEvent.click(screen.getByRole("link", { name: "今日学习" }));
    expect(confirm).toHaveBeenCalledWith("你有未保存的学习内容，确认要离开吗？");
    expect(screen.getByRole("heading", { name: "精读工作台" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/reader");

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("link", { name: "今日学习" }));
    expect(await screen.findByRole("heading", { name: "今日学习" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/today");
  });

  it("retains failed save text, retries the same reading payload, and keeps clipboard copy available", async () => {
    const { calls } = setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);

    await screen.findByRole("heading", { name: "数列极限" }, { timeout: 5_000 });
    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));
    fireEvent.change(screen.getByLabelText("粘贴你要精读的内容"), {
      target: { value: "# 新材料\n\n新的阅读正文 $a_n$" }
    });
    fireEvent.click(screen.getByRole("button", { name: "开始精读" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("磁盘暂时不可写");
    expect(screen.getByLabelText("粘贴你要精读的内容")).toHaveValue(
      "# 新材料\n\n新的阅读正文 $a_n$"
    );

    fireEvent.click(screen.getByRole("button", { name: "开始精读" }));

    expect((await screen.findAllByText("01-阅读材料/新材料.md")).length).toBeGreaterThan(0);
    const readingPosts = calls.filter(
      (call) => call.url === "/api/readings" && call.method === "POST"
    );
    expect(readingPosts).toHaveLength(2);
    expect(readingPosts[1]?.body).toEqual(readingPosts[0]?.body);

    cleanup();
    queryClient.clear();
    seedCardSelection();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard
    });
    window.history.pushState({}, "", "/cards");
    render(<App />);
    await screen.findByRole("heading", { name: "卡片工作台" });

    fireEvent.change(screen.getByLabelText("候选内容"), {
      target: { value: "候选：先说明 N 可以依赖 ε。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("卡片保存失败");
    fireEvent.click(screen.getByRole("button", { name: "复制候选内容" }));

    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith("候选：先说明 N 可以依赖 ε。")
    );
    expect(screen.getByText("候选内容已复制到剪贴板。")).toBeInTheDocument();
  });
});

describe("keyboard and reduced-motion accessibility", () => {
  it("keeps navigation, selection actions, forms, review buttons, and deep-linked graph nodes focusable", async () => {
    setupFetch();
    window.history.pushState({}, "", "/reader");
    render(<App />);

    await screen.findByRole("heading", { name: "精读工作台" });
    const readerLink = screen.getByRole("link", { name: "精读工作台" });
    readerLink.focus();
    expect(readerLink).toHaveFocus();

    expect(screen.queryByLabelText("上下文状态")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上下文说明" })).not.toBeInTheDocument();

    await screen.findByRole("heading", { name: "数列极限" });
    fireEvent.click(screen.getByRole("button", { name: "+ 新材料" }));
    const pasteArea = screen.getByLabelText("粘贴你要精读的内容");
    pasteArea.focus();
    expect(pasteArea).toHaveFocus();

    selectReaderText(EXCERPT);
    const selectionToolbar = await screen.findByRole("toolbar", { name: "选区动作" });
    const createCardAction = within(selectionToolbar).getByRole("button", {
      name: "创建卡片"
    });
    createCardAction.focus();
    expect(createCardAction).toHaveFocus();
    fireEvent.keyDown(createCardAction, { key: "Enter" });
    const definitionAction = screen.getByRole("menuitem", { name: "概念" });
    definitionAction.focus();
    expect(definitionAction).toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "今日复习" }));
    fireEvent.change(await screen.findByLabelText("我的闭卷回答"), {
      target: { value: "先给精度，再找统一阶段。" }
    });
    fireEvent.click(screen.getByLabelText("3 · 比较有把握"));
    fireEvent.click(screen.getByRole("button", { name: "保存尝试并揭示答案" }));
    const forgot = await screen.findByRole("radio", { name: "忘了" });
    forgot.focus();
    expect(forgot).toHaveFocus();

    cleanup();
    queryClient.clear();
    window.history.pushState({}, "", "/graph");
    render(<App />);
    const graphNode = await screen.findByRole("button", {
      name: /^1\. 概念/u
    });
    graphNode.focus();
    expect(graphNode).toHaveFocus();
  });

  it("keeps reduced-motion CSS explicit for route and component transitions", async () => {
    const primitives = await readFile(
      join(process.cwd(), "src/styles/primitives.css"),
      "utf8"
    );
    const workbench = await readFile(
      join(process.cwd(), "src/styles/workbench.css"),
      "utf8"
    );

    expect(primitives).toContain("@media (prefers-reduced-motion: reduce)");
    expect(primitives).toContain("transition-duration: 1ms;");
    expect(primitives).toContain("animation-duration: 1ms;");
    expect(primitives).not.toContain("!important");
    expect(workbench).toContain("animation: route-enter");
  });
}
);
