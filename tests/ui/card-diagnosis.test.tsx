// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import { READER_SELECTION_STORAGE_KEY } from "../../src/features/reader/selection";
import {
  cardDraftToUpdateRequest,
  createCardDraftFromReaderSelection,
  type CardType
} from "../../src/features/cards/card-draft";
import { cardSaveState } from "../../src/features/cards/card-save-state";
import {
  readCardDraft,
  writeCardDraft
} from "../../src/features/cards/card-draft-store";
import { CARD_LABELS } from "../../shared/card-labels";
import { CARD_DIRECTORIES } from "../../shared/vault-map";
import {
  readDiagnosisDraft,
  writeDiagnosisDraft
} from "../../src/features/diagnosis/diagnosis-draft-store";

const NOW = "2026-06-29T03:04:05.006Z";
const SOURCE_READING_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_PATH = "01-阅读材料/数列极限.md";
const EXCERPT = "对任意 ε > 0，存在 N。";

type FetchCall = {
  body: unknown;
  method: string;
  url: string;
};

const readerSelection = {
  source: "reader-selection",
  target: "cards",
  cardType: "definition",
  sourceReadingId: SOURCE_READING_ID,
  sourcePath: SOURCE_PATH,
  concept: "ε-N",
  excerpt: EXCERPT
} as const;

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function valueFromBody(body: unknown, key: string): unknown {
  return body !== null && typeof body === "object" && key in body
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

function stringFromBody(body: unknown, key: string, fallback: string): string {
  const value = valueFromBody(body, key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function cardTypeFromBody(body: unknown): CardType {
  const value = valueFromBody(body, "type");
  return typeof value === "string" && value in CARD_LABELS
    ? (value as CardType)
    : "definition";
}

function cardPath(type: CardType, title: string): string {
  return `${CARD_DIRECTORIES[type]}/${title.replace(/\s+/g, "-")}.md`;
}

function previewContent(type: CardType, body: unknown): string {
  if (type === "concept") {
    return stringFromBody(
      body,
      "myUnderstanding",
      stringFromBody(body, "formalExplanation", "把定义翻译成可迁移的判断。")
    );
  }

  if (type === "definition") {
    return stringFromBody(body, "formalDefinition", "∀ε>0，∃N，n>N ⇒ |x_n-a|<ε。");
  }

  if (type === "example") {
    return stringFromBody(body, "exampleContent", "x_n = 1/n 收敛到 0。");
  }

  return stringFromBody(body, "understanding", "这张卡片等待复查。");
}

function setupFetch(options: { failCards?: boolean; nextReview?: string } = {}) {
  const calls: FetchCall[] = [];
  const recentCards: unknown[] = [];
  const savedNextReview = options.nextReview ?? "2099-01-02";
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

    if (url.endsWith("/api/cards/recent?limit=10") && method === "GET") {
      return response({ cards: recentCards });
    }

    if (url.endsWith("/api/cards/22222222-2222-4222-8222-222222222222") && method === "GET") {
      const latestCard = recentCards[0] as
        | {
            concept?: string;
            id?: string;
            modifiedAt?: string;
            preview?: { content?: string; sourceReading?: string };
            relativePath?: string;
            title?: string;
            type?: string;
          }
        | undefined;

      if (latestCard?.type === "concept") {
        return response({
          card: {
            id: latestCard.id ?? "22222222-2222-4222-8222-222222222222",
            type: "concept",
            title: latestCard.title ?? "ε-N 概念卡",
            concept: latestCard.concept ?? "ε-N",
            sourceReading: latestCard.preview?.sourceReading ?? SOURCE_PATH,
            relativePath: latestCard.relativePath ?? "02-概念卡/ε-N-概念卡.md",
            modifiedAt: latestCard.modifiedAt ?? NOW,
            myUnderstanding: latestCard.preview?.content ?? "先选精度 ε，再找到足够靠后的起点 N。"
          }
        });
      }

      return response({
        card: {
          id: "22222222-2222-4222-8222-222222222222",
          type: "definition",
          title: "ε-N 定义卡",
          concept: "ε-N",
          sourceReading: SOURCE_PATH,
          relativePath: "02-定义卡/ε-N-定义卡.md",
          modifiedAt: NOW,
          formalDefinition: "详情接口：∀ε>0，∃N，n>N => |x_n-a|<ε。",
          plainExplanation: "详情接口：尾部项进入任意小邻域。"
        }
      });
    }

    if (url.endsWith("/api/cards/22222222-2222-4222-8222-222222222222") && method === "PUT") {
      const type = cardTypeFromBody(body);
      const title = stringFromBody(body, "title", `ε-N ${CARD_LABELS[type].label}`);
      const concept = stringFromBody(body, "concept", "ε-N");
      const relativePath = cardPath(type, title);
      const updatedCard = {
        id: "22222222-2222-4222-8222-222222222222",
        type,
        title,
        concept,
        mastery: "learning",
        nextReview: savedNextReview,
        relativePath,
        modifiedAt: NOW
      };
      return response({
        card: updatedCard,
        saveReceipt: {
          relativePath,
          absolutePath: `C:\\Vault\\${relativePath.replaceAll("/", "\\")}`,
          modifiedAt: NOW
        }
      });
    }

    if (url.endsWith("/api/cards") && method === "POST") {
      if (options.failCards === true) {
        throw new TypeError("Failed to fetch");
      }

      const type = cardTypeFromBody(body);
      const title = stringFromBody(body, "title", `ε-N ${CARD_LABELS[type].label}`);
      const concept = stringFromBody(body, "concept", "ε-N");
      const relativePath = cardPath(type, title);
      const createdCard = {
        id: "22222222-2222-4222-8222-222222222222",
        type,
        title,
        concept,
        mastery: "learning",
        nextReview: savedNextReview,
        relativePath,
        modifiedAt: NOW
      };
      recentCards.unshift({
        ...createdCard,
        typeLabel: CARD_LABELS[type].label,
        preview: {
          concept,
          content: previewContent(type, body),
          sourceReading: SOURCE_PATH
        }
      });

      return response({
        card: {
          ...createdCard
        },
        saveReceipt: {
          relativePath,
          absolutePath: `C:\\Vault\\${relativePath.replaceAll("/", "\\")}`,
          modifiedAt: NOW
        }
      });
    }

    if (url.endsWith("/api/diagnoses") && method === "POST") {
      return response({
        diagnosis: {
          id: "33333333-3333-4333-8333-333333333333",
          title: "卡点诊断：ε-N",
          concept: "ε-N",
          blockType: "proof-search",
          targetCardType: "process",
          relativePath: "07-卡点诊断/卡点诊断-ε-N.md",
          modifiedAt: NOW
        },
        saveReceipt: {
          relativePath: "07-卡点诊断/卡点诊断-ε-N.md",
          absolutePath: "C:\\Vault\\07-卡点诊断\\卡点诊断-ε-N.md",
          modifiedAt: NOW
        }
      });
    }

    if (url.endsWith("/api/codex/tasks") && method === "POST") {
      return response({
        codexTask: {
          id: "44444444-4444-4444-8444-444444444444",
          title: "Codex 任务：ε-N卡点诊断",
          relativePath: "10-Codex任务/20260629-codex-任务.md",
          modifiedAt: NOW
        },
        saveReceipt: {
          relativePath: "10-Codex任务/20260629-codex-任务.md",
          absolutePath: "C:\\Vault\\10-Codex任务\\20260629-codex-任务.md",
          modifiedAt: NOW
        }
      });
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function seedSelection(
  target: "cards" | "diagnosis",
  cardType: CardType = "definition"
) {
  sessionStorage.setItem(
    READER_SELECTION_STORAGE_KEY,
    JSON.stringify({
      ...readerSelection,
      target,
      cardType
    })
  );
}

afterEach(() => {
  queryClient.clear();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
});

describe("card draft creation", () => {
  it("creates type-specific blank fields from every reader card action", () => {
    vi.setSystemTime(new Date(NOW));
    const expectations = {
      concept: ["formalExplanation", "myUnderstanding", "commonMisunderstanding", "usageContext"],
      definition: ["formalDefinition", "plainExplanation", "quantifierStructure", "commonMisunderstandings"],
      example: ["exampleContent", "whyItFits", "trainingPurpose"],
      boundary: ["confusingObjects", "similarity", "keyDifference", "judgementRule"],
      counterexample: ["counterexampleContent", "brokenCondition", "whyItIsNot"],
      process: ["task", "steps", "keyTurn", "pitfall", "usageContext"],
      mistake: ["mistake", "originalThinking", "realCause", "correctMethod", "recognitionSignal"],
      proof: ["proposition", "firstAttempt", "keyMove", "proofOutline", "failureReason"]
    } as const;

    for (const cardType of Object.keys(expectations) as CardType[]) {
      const draft = createCardDraftFromReaderSelection({
        ...readerSelection,
        cardType
      });

      expect(draft.type).toBe(cardType);
      expect(draft.concept).toBe("ε-N");
      expect(draft.sourceReadingId).toBe(SOURCE_READING_ID);
      expect(draft.sourcePath).toBe(SOURCE_PATH);
      expect(draft.excerpt).toBe(EXCERPT);
      expect(draft.createdAt).toBe(NOW);
      expect(draft.nextReview).toBe("2026-06-29");
      for (const field of expectations[cardType]) {
        expect((draft as Record<string, unknown>)[field]).toBe("");
      }
    }
  });

  it("derives every durable save state without conflating saved and modified", () => {
    const receipt = { relativePath: "02-概念卡/epsilon-n.md" };

    expect(cardSaveState({ dirty: true, error: null, receipt: null, saving: false })).toBe("unsaved");
    expect(cardSaveState({ dirty: true, error: null, receipt: null, saving: true })).toBe("saving");
    expect(cardSaveState({ dirty: false, error: null, receipt, saving: false })).toBe("saved");
    expect(cardSaveState({ dirty: true, error: null, receipt, saving: false })).toBe("modified-after-save");
    expect(cardSaveState({ dirty: true, error: "disk full", receipt, saving: false })).toBe("save-failed");
  });

  it("adds the current mastery only for an update request", () => {
    const draft = createCardDraftFromReaderSelection(readerSelection, new Date(NOW));
    const request = cardDraftToUpdateRequest(draft, "learning");

    expect(request.mastery).toBe("learning");
    expect(JSON.stringify(request)).not.toContain("createdAt");
    expect(JSON.stringify(request)).not.toContain("nextReview");
    expect(JSON.stringify(request)).not.toContain("sourcePath");
  });
});

describe("Card Studio", () => {
  it("restores an unsaved card draft after the app is reopened", async () => {
    setupFetch();
    const draft = createCardDraftFromReaderSelection(readerSelection, new Date(NOW));
    if (draft.type !== "definition") {
      throw new Error("expected a definition draft");
    }
    writeCardDraft({ ...draft, formalDefinition: "尚未保存的本地定义" });
    window.history.pushState({}, "", "/cards");

    render(<App />);

    expect(await screen.findByText("已恢复本地草稿")).toBeInTheDocument();
    expect(screen.getByDisplayValue("尚未保存的本地定义")).toBeInTheDocument();
    expect(readCardDraft()).not.toBeNull();
  });

  it("does not present a save-ready card editor when opened without a Reader selection", async () => {
    setupFetch();
    window.history.pushState({}, "", "/cards");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "卡片工作台" })).toBeInTheDocument();
    expect(screen.getByText(/从精读工作台选中一段原文/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存卡片" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("标题")).not.toBeInTheDocument();
  });

  it("presents card editing as a four-step learning flow", async () => {
    setupFetch();
    seedSelection("cards", "definition");
    window.history.pushState({}, "", "/cards");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "卡片工作台" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "① 原文" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "② 我的重述" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "③ 结构化卡片" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "④ 下一步行动" })).toBeInTheDocument();
    const sectionNav = screen.getByRole("navigation", { name: "卡片制作分区" });
    expect(within(sectionNav).getAllByRole("link")).toHaveLength(4);
    expect(within(sectionNav).getByRole("link", { name: /原文/ })).toHaveAttribute(
      "href",
      "#card-source"
    );
    expect(screen.getByRole("status", { name: "卡片保存状态" })).toHaveTextContent(
      "尚未保存"
    );

    const editor = document.querySelector(".card-editor");
    expect(editor).toHaveClass("card-editor--learning-flow");
    expect(document.querySelectorAll(".card-editor__save-button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "保存卡片" })).toHaveClass(
      "card-editor__save-button"
    );

    const cardsCss = await readFile(join(process.cwd(), "src/features/cards/cards.css"), "utf8");
    expect(cardsCss).toContain(".card-editor__step--source");
    expect(cardsCss).toContain(".card-editor__step--restatement");
    expect(cardsCss).toContain(".card-editor__step--structured");
    expect(cardsCss).toContain(".card-editor__step--next-action");
  });

  it("edits an explicit definition card draft, applies candidate content, and saves without server-owned fields", async () => {
    const { calls } = setupFetch();
    seedSelection("cards", "definition");
    window.history.pushState({}, "", "/cards");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "卡片工作台" })).toBeInTheDocument();
    expect(screen.getByText(SOURCE_PATH)).toBeInTheDocument();
    expect(screen.getByDisplayValue(EXCERPT)).toBeInTheDocument();
    expect(screen.getByLabelText("正式定义")).toBeInTheDocument();
    expect(screen.getByLabelText("大白话解释")).toBeInTheDocument();
    expect(screen.getByLabelText("量词结构")).toBeInTheDocument();
    expect(screen.getByLabelText("常见误解")).toBeInTheDocument();

    const candidate = screen.getByLabelText("候选内容");
    fireEvent.change(candidate, {
      target: { value: "候选：先说明 N 可以依赖 ε。" }
    });
    expect(screen.queryByRole("button", { name: "保存为参考材料" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制到“重述理解”" }));
    expect(screen.getByLabelText("我的理解")).toHaveValue("候选：先说明 N 可以依赖 ε。");
    fireEvent.click(screen.getByRole("button", { name: "复制到“下一步行动”" }));
    expect(screen.getByLabelText("下一步行动")).toHaveValue("候选：先说明 N 可以依赖 ε。");
    expect(screen.queryByRole("button", { name: "复制到“例子内容”" })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前定义卡不使用/u)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "ε-N 定义卡" }
    });
    fireEvent.change(screen.getByLabelText("正式定义"), {
      target: { value: "∀ε>0，∃N，n>N ⇒ |x_n-a|<ε。" }
    });
    fireEvent.change(screen.getByLabelText("大白话解释"), {
      target: { value: "尾部项进入任意小邻域。" }
    });
    fireEvent.change(screen.getByLabelText("量词结构"), {
      target: { value: "∀ε ∃N ∀n" }
    });
    fireEvent.change(screen.getByLabelText("常见误解"), {
      target: { value: "N 不能依赖 n。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/cards",
        method: "POST",
        body: {
          type: "definition",
          title: "ε-N 定义卡",
          concept: "ε-N",
          relatedConcepts: [],
          sourceReadingId: SOURCE_READING_ID,
          excerpt: EXCERPT,
          understanding: "候选：先说明 N 可以依赖 ε。",
          blockType: null,
          nextAction: "候选：先说明 N 可以依赖 ε。",
          formalDefinition: "∀ε>0，∃N，n>N ⇒ |x_n-a|<ε。",
          plainExplanation: "尾部项进入任意小邻域。",
          quantifierStructure: "∀ε ∃N ∀n",
          commonMisunderstandings: "N 不能依赖 n。"
        }
      })
    );
    expect(screen.getAllByText("02-定义卡/ε-N-定义卡.md").length).toBeGreaterThan(0);
    expect(screen.queryByText("C:\\Vault\\02-定义卡\\ε-N-定义卡.md")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看这张卡片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建下一张" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "去复习" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始今日复习" })).not.toBeInTheDocument();
    expect(screen.getByText("2099-01-02")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "预览复习格式" }));
    expect(screen.getByRole("region", { name: "卡片复习预览" })).toHaveTextContent(
      "闭卷解释：ε-N"
    );

    const recent = await screen.findByRole("region", { name: "最近卡片" });
    expect(within(recent).getByText("ε-N 定义卡")).toBeInTheDocument();
    expect(within(recent).getByText("定义卡")).toBeInTheDocument();
    expect(within(recent).getByText("02-定义卡/ε-N-定义卡.md")).toBeInTheDocument();
    expect(within(recent).queryByText("C:\\Vault\\02-定义卡\\ε-N-定义卡.md")).not.toBeInTheDocument();

    fireEvent.click(within(recent).getByRole("button", { name: "查看 ε-N 定义卡" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/cards/22222222-2222-4222-8222-222222222222",
        method: "GET",
        body: null
      })
    );
    expect(await screen.findByRole("region", { name: "卡片预览" })).toHaveTextContent(
      "详情接口：∀ε>0，∃N，n>N => |x_n-a|<ε。"
    );
    expect(screen.getByRole("button", {
      name: "为这张卡片提交或查看证据"
    })).toBeInTheDocument();
    expect(JSON.stringify(calls.at(-1)?.body)).not.toContain("createdAt");
    expect(JSON.stringify(calls.at(-1)?.body)).not.toContain("nextReview");
    expect(JSON.stringify(calls.at(-1)?.body)).not.toContain("sourcePath");

    fireEvent.change(screen.getByLabelText("大白话解释"), {
      target: { value: "保存后仍然可以继续校正表述。" }
    });
    expect(screen.getByRole("status", { name: "卡片保存状态" })).toHaveTextContent(
      "保存后有修改"
    );
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          url: "/api/cards/22222222-2222-4222-8222-222222222222",
          method: "PUT",
          body: expect.objectContaining({
            mastery: "learning",
            plainExplanation: "保存后仍然可以继续校正表述。"
          })
        })
      )
    );
    expect(screen.getByRole("button", { name: "已保存" })).toBeDisabled();
  });

  it("makes a saved concept card visible in the cards workspace, previewable, and durable after refresh", async () => {
    const { calls } = setupFetch();
    seedSelection("cards", "concept");
    window.history.pushState({}, "", "/cards");
    const view = render(<App />);

    expect(await screen.findByRole("heading", { name: "卡片工作台" })).toBeInTheDocument();
    expect(screen.getByLabelText("正式解释")).toBeInTheDocument();
    expect(screen.getByLabelText("我自己的理解")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制到“重述理解”" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制到“我自己的理解”" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制到“下一步行动”" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制到“例子内容”" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制到“反例内容”" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制到“证明骨架”" })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前概念卡不使用/u)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "ε-N 概念卡" }
    });
    fireEvent.change(screen.getByLabelText("正式解释"), {
      target: { value: "ε-N 用来表达序列最终进入任意小邻域。" }
    });
    fireEvent.change(screen.getByLabelText("我自己的理解"), {
      target: { value: "先选精度 ε，再找到足够靠后的起点 N。" }
    });
    fireEvent.change(screen.getByLabelText("常见误解"), {
      target: { value: "把 N 当成固定常数。" }
    });
    fireEvent.change(screen.getByLabelText("使用场景"), {
      target: { value: "证明数列极限。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));

    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          url: "/api/cards",
          method: "POST",
          body: expect.objectContaining({
            type: "concept",
            title: "ε-N 概念卡",
            formalExplanation: "ε-N 用来表达序列最终进入任意小邻域。",
            myUnderstanding: "先选精度 ε，再找到足够靠后的起点 N。"
          })
        })
      )
    );

    let recent = await screen.findByRole("region", { name: "最近卡片" });
    expect(within(recent).getByText("ε-N 概念卡")).toBeInTheDocument();
    expect(within(recent).getByText("概念卡")).toBeInTheDocument();
    expect(within(recent).getByText("02-概念卡/ε-N-概念卡.md")).toBeInTheDocument();
    expect(within(recent).queryByText("C:\\Vault\\02-概念卡\\ε-N-概念卡.md")).not.toBeInTheDocument();

    fireEvent.click(within(recent).getByRole("button", { name: "查看 ε-N 概念卡" }));
    expect(await screen.findByRole("region", { name: "卡片预览" })).toHaveTextContent(
      "先选精度 ε，再找到足够靠后的起点 N。"
    );

    view.unmount();
    queryClient.clear();
    render(<App />);

    recent = await screen.findByRole("region", { name: "最近卡片" });
    expect(await within(recent).findByText("ε-N 概念卡")).toBeInTheDocument();
    expect(within(recent).queryByText("C:\\Vault\\02-概念卡\\ε-N-概念卡.md")).not.toBeInTheDocument();
  });

  it("opens a card-specific review only when the saved card is already due", async () => {
    setupFetch({ nextReview: "2000-01-01" });
    seedSelection("cards", "concept");
    window.history.pushState({}, "", "/cards");
    render(<App />);

    await screen.findByRole("heading", { name: "卡片工作台" });
    fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));

    const reviewButton = await screen.findByRole("button", {
      name: "开始今日复习"
    });
    expect(screen.queryByRole("button", { name: "预览复习格式" })).not.toBeInTheDocument();
    fireEvent.click(reviewButton);
    expect(window.location.pathname).toBe("/review");
    expect(window.location.search).toBe(
      "?cardId=22222222-2222-4222-8222-222222222222"
    );
  });

  it("saves an example card with the shared frontend and API field contract", async () => {
    const { calls } = setupFetch();
    seedSelection("cards", "example");
    window.history.pushState({}, "", "/cards");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "卡片工作台" })).toBeInTheDocument();
    expect(screen.getByLabelText("例子内容")).toBeInTheDocument();
    expect(screen.getByLabelText("为什么它符合")).toBeInTheDocument();
    expect(screen.getByLabelText("它训练我什么")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "ε-N 例子卡" }
    });
    fireEvent.change(screen.getByLabelText("我的理解"), {
      target: { value: "这个例子展示 N 如何跟着 ε 变。" }
    });
    fireEvent.change(screen.getByLabelText("下一步行动"), {
      target: { value: "再补一个边界例子。" }
    });
    fireEvent.change(screen.getByLabelText("例子内容"), {
      target: { value: "x_n = 1/n 收敛到 0。" }
    });
    fireEvent.change(screen.getByLabelText("为什么它符合"), {
      target: { value: "给定 ε，取 N > 1/ε 即可。" }
    });
    fireEvent.change(screen.getByLabelText("它训练我什么"), {
      target: { value: "训练我从 ε 反推 N。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/cards",
        method: "POST",
        body: {
          type: "example",
          title: "ε-N 例子卡",
          concept: "ε-N",
          relatedConcepts: [],
          sourceReadingId: SOURCE_READING_ID,
          excerpt: EXCERPT,
          understanding: "这个例子展示 N 如何跟着 ε 变。",
          blockType: null,
          nextAction: "再补一个边界例子。",
          exampleContent: "x_n = 1/n 收敛到 0。",
          whyItFits: "给定 ε，取 N > 1/ε 即可。",
          trainingPurpose: "训练我从 ε 反推 N。"
        }
      })
    );
    expect(JSON.stringify(calls.at(-1)?.body)).not.toContain("whyItFitsDefinition");
    expect(JSON.stringify(calls.at(-1)?.body)).not.toContain("trainsWhat");
  });

  it("edits and saves a V0.2 mistake card with generic learning fields", async () => {
    const { calls } = setupFetch();
    seedSelection("cards", "mistake");
    window.history.pushState({}, "", "/cards");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "卡片工作台" })).toBeInTheDocument();
    expect(screen.getByLabelText("错误表现")).toBeInTheDocument();
    expect(screen.getByLabelText("原来怎么想")).toBeInTheDocument();
    expect(screen.getByLabelText("真正原因")).toBeInTheDocument();
    expect(screen.getByLabelText("正确方法")).toBeInTheDocument();
    expect(screen.getByLabelText("识别信号")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "被动重读 错误卡" }
    });
    fireEvent.change(screen.getByLabelText("概念"), {
      target: { value: "学习闭环" }
    });
    fireEvent.change(screen.getByLabelText("我的理解"), {
      target: { value: "看着会不等于能回忆。" }
    });
    fireEvent.change(screen.getByLabelText("下一步行动"), {
      target: { value: "合上材料回答一个具体问题。" }
    });
    fireEvent.change(screen.getByLabelText("错误表现"), {
      target: { value: "我一直重读笔记，没有做主动回忆。" }
    });
    fireEvent.change(screen.getByLabelText("原来怎么想"), {
      target: { value: "多看几遍自然就会理解。" }
    });
    fireEvent.change(screen.getByLabelText("真正原因"), {
      target: { value: "没有检索动作暴露缺口。" }
    });
    fireEvent.change(screen.getByLabelText("正确方法"), {
      target: { value: "先闭卷回答，再回看材料修正。" }
    });
    fireEvent.change(screen.getByLabelText("识别信号"), {
      target: { value: "打开材料很顺，关上材料卡住。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/cards",
        method: "POST",
        body: {
          type: "mistake",
          title: "被动重读 错误卡",
          concept: "学习闭环",
          relatedConcepts: [],
          sourceReadingId: SOURCE_READING_ID,
          excerpt: EXCERPT,
          understanding: "看着会不等于能回忆。",
          blockType: null,
          nextAction: "合上材料回答一个具体问题。",
          mistake: "我一直重读笔记，没有做主动回忆。",
          originalThinking: "多看几遍自然就会理解。",
          realCause: "没有检索动作暴露缺口。",
          correctMethod: "先闭卷回答，再回看材料修正。",
          recognitionSignal: "打开材料很顺，关上材料卡住。"
        }
      })
    );
  });

  it("shows the local service recovery message when saving a card cannot reach the backend", async () => {
    setupFetch({ failCards: true });
    seedSelection("cards", "concept");
    window.history.pushState({}, "", "/cards");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "卡片工作台" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));

    expect(
      await screen.findByText(
        "无法连接本地服务。请确认 Aleksi Learning Workbench 后端已启动，或重新启动学习器。"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "卡片保存状态" })).toHaveTextContent(
      "保存失败，草稿仍在"
    );
    expect(screen.getByDisplayValue(EXCERPT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试保存" })).toBeEnabled();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });
});

describe("Diagnosis page", () => {
  it("restores an unsaved diagnosis draft after the app is reopened", async () => {
    setupFetch();
    writeDiagnosisDraft({
      concept: "ε-N",
      relatedCardId: "",
      blockType: "proof-search",
      manifestation: "上次写到这里",
      assumedProblem: "以为是计算问题",
      actualCause: "量词关系没有拆开",
      nextMinimumAction: "画依赖表",
      targetCardType: "process"
    });
    window.history.pushState({}, "", "/diagnosis");

    render(<App />);

    expect(await screen.findByText("已恢复本地诊断草稿")).toBeInTheDocument();
    expect(screen.getByDisplayValue("上次写到这里")).toBeInTheDocument();
    expect(screen.getByDisplayValue("量词关系没有拆开")).toBeInTheDocument();
    expect(readDiagnosisDraft()).not.toBeNull();
  });

  it("saves one of eight block types and then generates a Codex task Markdown file", async () => {
    const { calls } = setupFetch();
    seedSelection("diagnosis", "process");
    window.history.pushState({}, "", "/diagnosis");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "卡点诊断" })).toBeInTheDocument();
    const blockType = screen.getByLabelText("卡点类型");
    expect(within(blockType).getAllByRole("option")).toHaveLength(8);
    const targetCardType = screen.getByLabelText("要沉淀成哪类卡片");
    expect(within(targetCardType).getAllByRole("option")).toHaveLength(5);

    fireEvent.change(blockType, { target: { value: "proof-search" } });
    fireEvent.change(screen.getByLabelText("具体表现"), {
      target: { value: "我不知道证明里先选 ε 还是先选 N。" }
    });
    fireEvent.change(screen.getByLabelText("我一开始以为的问题"), {
      target: { value: "我以为是计算不熟。" }
    });
    fireEvent.change(screen.getByLabelText(/当前原因假设/u), {
      target: { value: "量词依赖关系还没有拆开。" }
    });
    fireEvent.change(screen.getByLabelText("下一步最小行动"), {
      target: { value: "写出 ε、N、n 的依赖表。" }
    });
    fireEvent.change(targetCardType, {
      target: { value: "process" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存诊断" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/diagnoses",
        method: "POST",
        body: {
          concept: "ε-N",
          blockType: "proof-search",
          manifestation: "我不知道证明里先选 ε 还是先选 N。",
          assumedProblem: "我以为是计算不熟。",
          actualCause: "量词依赖关系还没有拆开。",
          nextMinimumAction: "写出 ε、N、n 的依赖表。",
          targetCardType: "process"
        }
      })
    );
    expect(screen.getByText("07-卡点诊断/卡点诊断-ε-N.md")).toBeInTheDocument();
    expect(screen.queryByText("C:\\Vault\\07-卡点诊断\\卡点诊断-ε-N.md")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成 Codex 任务 Markdown" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/codex/tasks",
        method: "POST",
        body: {
          concept: "ε-N",
          sourceReadingId: SOURCE_READING_ID,
          currentMaterial: EXCERPT,
          understanding: "量词依赖关系还没有拆开。",
          blockType: "proof-search"
        }
      })
    );
    expect(screen.getByText("10-Codex任务/20260629-codex-任务.md")).toBeInTheDocument();
    expect(screen.queryByText("C:\\Vault\\10-Codex任务\\20260629-codex-任务.md")).not.toBeInTheDocument();
  });
});
