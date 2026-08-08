// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import {
  readReviewDraft,
  writeReviewDraft
} from "../../src/features/review/review-draft-store";
import { hasUnsavedChanges } from "../../src/lib/unsaved-guard";

const NOW = "2026-06-29T03:04:05.006Z";

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

function setupFetch() {
  const calls: FetchCall[] = [];
  let completedCardId: string | null = null;
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

    if (url.endsWith("/api/review/today")) {
      return response({
        generatedAt: NOW,
        items: [
          {
            cardId: "11111111-1111-4111-8111-111111111111",
            cardPath: "02-定义卡/ε-N-定义卡.md",
            cardType: "definition",
            concept: "ε-N",
            mastery: "learning",
            nextReview: "2026-06-29",
            lastReviewSequence: null,
            lastReviewed: null,
            due: true,
            prompt: "请闭卷写出 ε-N 定义的关键结构。",
            card: {
              id: "11111111-1111-4111-8111-111111111111",
              type: "definition",
              title: "Epsilon-N definition",
              concept: "ε-N",
              relatedConcepts: ["sequence limit"],
              sourceReadingId: "reading-1",
              excerpt: "For every epsilon there is an N.",
              understanding: "The tail of the sequence stays inside any requested neighborhood.",
              blockType: "definition",
              nextAction: "Test the quantifier order without looking.",
              formalDefinition: "For every epsilon greater than zero, there exists N such that n>N implies distance is less than epsilon.",
              plainExplanation: "Eventually the sequence is as close as the chosen precision asks.",
              quantifierStructure: "forall epsilon exists N forall n",
              commonMisunderstandings: "N may depend on epsilon, but not on n."
            }
          },
          {
            cardId: "22222222-2222-4222-8222-222222222222",
            cardPath: "03-例子卡/紧致性例子.md",
            cardType: "example",
            concept: "紧致性",
            mastery: "learning",
            nextReview: "2026-06-29",
            lastReviewSequence: 1,
            lastReviewed: "2026-06-28T03:04:05.006Z",
            due: true,
            prompt: "请闭卷说明一个紧致性例子。",
            card: {
              id: "22222222-2222-4222-8222-222222222222",
              type: "example",
              title: "Compactness example",
              concept: "紧致性",
              relatedConcepts: ["cover"],
              sourceReadingId: "reading-2",
              excerpt: "Every open cover has a finite subcover.",
              understanding: "This is the object-side example for compactness.",
              blockType: "example",
              nextAction: "Compare with a non-compact space.",
              exampleContent: "Closed intervals in R are compact.",
              whyItFits: "Heine-Borel supplies the finite subcover.",
              trainingPurpose: "Recognize the finite-subcover pattern."
            }
          }
        ].filter((item) => item.cardId !== completedCardId)
      });
    }

    if (url.endsWith("/api/review/11111111-1111-4111-8111-111111111111/attempt")) {
      return response({
        attemptId: "review-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        attemptedAt: NOW,
        promptVersion: "recall-v1",
        replayed: false,
        revealedCard: {
          id: "11111111-1111-4111-8111-111111111111",
          type: "definition",
          title: "Epsilon-N definition",
          concept: "ε-N",
          relatedConcepts: ["sequence limit"],
          excerpt: "For every epsilon there is an N.",
          understanding: "The tail of the sequence stays inside any requested neighborhood.",
          blockType: "definition",
          nextAction: "Test the quantifier order without looking.",
          formalDefinition: "For every epsilon greater than zero, there exists N such that n>N implies distance is less than epsilon.",
          plainExplanation: "Eventually the sequence is as close as the chosen precision asks.",
          quantifierStructure: "forall epsilon exists N forall n",
          commonMisunderstandings: "N may depend on epsilon, but not on n."
        }
      });
    }

    if (url.endsWith("/api/review/11111111-1111-4111-8111-111111111111/result")) {
      completedCardId = "11111111-1111-4111-8111-111111111111";
      return response({
        result: {
          reviewId: "review-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          cardId: "11111111-1111-4111-8111-111111111111",
          feedback: "known",
          blockType: "proof-search",
          reviewSequence: 1,
          reviewedAt: NOW,
          intervalDays: 7,
          nextReview: "2026-07-06",
          nextMastery: "learning"
        },
        replayed: false,
        projectionStatus: "fresh"
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
            relatedConcepts: ["紧致性"],
            suggestedNextActions: [
              "补 1 张例子卡",
              "补 1 张边界卡",
              "补 1 张流程卡",
              "补 1 张错误卡",
              "完成今日到期复习"
            ]
          },
          "紧致性": {
            concept: "紧致性",
            rings: {
              concept: { count: 1, coverage: "established", learningStatus: "due-for-review", evidenceConfidence: "unverified" },
              example: { count: 1, coverage: "established", learningStatus: "learning", evidenceConfidence: "unverified" },
              boundary: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" },
              process: { count: 1, coverage: "established", learningStatus: "learning", evidenceConfidence: "unverified" },
              mistake: { count: 0, coverage: "missing", learningStatus: "not-started", evidenceConfidence: "unverified" }
            },
            currentBlock: null,
            nextAction: "完成今日到期复习",
            hasDueReview: true,
            relatedConcepts: ["ε-N"],
            suggestedNextActions: ["补 1 张边界卡", "补 1 张错误卡", "完成今日到期复习"]
          }
        }
      });
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function setupLegacyReviewFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/api/review/today")) {
      return response({
        generatedAt: NOW,
        items: [
          {
            cardId: "33333333-3333-4333-8333-333333333333",
            cardPath: "04-反例卡/紧致性反例.md",
            cardType: "counterexample",
            concept: "紧致性",
            mastery: "learning",
            nextReview: "2026-06-29",
            lastReviewSequence: null,
            lastReviewed: null,
            due: true,
            prompt: "请闭卷写出紧致性的反例。",
            card: {
              id: "33333333-3333-4333-8333-333333333333",
              type: "counterexample",
              title: "Compactness counterexample",
              concept: "紧致性",
              relatedConcepts: ["open cover"],
              sourceReadingId: "reading-3",
              excerpt: "The real line is not compact.",
              understanding: "It has an open cover without a finite subcover.",
              blockType: "counterexample",
              nextAction: "Name the broken condition first.",
              counterexampleContent: "Use the cover (-n, n) of R.",
              brokenCondition: "No finite subcover exists.",
              whyItIsNot: "Any finite subcollection only covers a bounded interval."
            }
          },
          {
            cardId: "44444444-4444-4444-8444-444444444444",
            cardPath: "05-证明卡/紧致性证明.md",
            cardType: "proof",
            concept: "紧致性",
            mastery: "learning",
            nextReview: "2026-06-29",
            lastReviewSequence: null,
            lastReviewed: null,
            due: true,
            prompt: "请闭卷回忆紧致性证明的关键动作。",
            card: {
              id: "44444444-4444-4444-8444-444444444444",
              type: "proof",
              title: "Compactness proof",
              concept: "紧致性",
              relatedConcepts: ["finite subcover"],
              sourceReadingId: "reading-4",
              excerpt: "Every sequence has a convergent subsequence.",
              understanding: "Compactness proof needs the right key move.",
              blockType: "proof-search",
              nextAction: "Recover the key move.",
              proposition: "Closed intervals are compact.",
              firstAttempt: "Try to choose one interval from the cover greedily.",
              keyMove: "Use nested intervals to force a contradiction.",
              proofOutline: "Assume no finite subcover, bisect repeatedly, then use convergence.",
              failureReason: "The greedy attempt ignores global cover structure."
            }
          }
        ]
      });
    }

    if (url.endsWith("/api/review/33333333-3333-4333-8333-333333333333/attempt")) {
      return response({
        attemptId: "review-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        attemptedAt: NOW,
        promptVersion: "recall-v1",
        replayed: false,
        revealedCard: {
          id: "33333333-3333-4333-8333-333333333333",
          type: "counterexample",
          title: "Compactness counterexample",
          concept: "紧致性",
          relatedConcepts: ["open cover"],
          excerpt: "The real line is not compact.",
          understanding: "It has an open cover without a finite subcover.",
          blockType: "counterexample",
          nextAction: "Name the broken condition first.",
          counterexampleContent: "Use the cover (-n, n) of R.",
          brokenCondition: "No finite subcover exists.",
          whyItIsNot: "Any finite subcollection only covers a bounded interval."
        }
      });
    }

    if (url.endsWith("/api/review/44444444-4444-4444-8444-444444444444/attempt")) {
      return response({
        attemptId: "review-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        attemptedAt: NOW,
        promptVersion: "recall-v1",
        replayed: false,
        revealedCard: {
          id: "44444444-4444-4444-8444-444444444444",
          type: "proof",
          title: "Compactness proof",
          concept: "紧致性",
          relatedConcepts: ["finite subcover"],
          excerpt: "Every sequence has a convergent subsequence.",
          understanding: "Compactness proof needs the right key move.",
          blockType: "proof-search",
          nextAction: "Recover the key move.",
          proposition: "Closed intervals are compact.",
          firstAttempt: "Try to choose one interval from the cover greedily.",
          keyMove: "Use nested intervals to force a contradiction.",
          proofOutline: "Assume no finite subcover, bisect repeatedly, then use convergence.",
          failureReason: "The greedy attempt ignores global cover structure."
        }
      });
    }

    if (url.endsWith("/api/review/33333333-3333-4333-8333-333333333333/result")) {
      return response({
        result: {
          reviewId: "review-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          cardId: "33333333-3333-4333-8333-333333333333",
          feedback: "known",
          blockType: "counterexample",
          reviewSequence: 1,
          reviewedAt: NOW,
          intervalDays: 7,
          nextReview: "2026-07-06",
          nextMastery: "learning"
        },
        replayed: false,
        projectionStatus: "fresh"
      });
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}

afterEach(() => {
  queryClient.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
});

describe("Review page", () => {
  it("restores the review card requested by the stable URL context", async () => {
    setupFetch();
    window.history.pushState(
      {},
      "",
      "/review?cardId=22222222-2222-4222-8222-222222222222"
    );

    render(<App />);

    expect(await screen.findByText("紧致性")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("concept")).toBe(
      "紧致性"
    );
  });

  it("restores an unfinished closed-note answer for the matching due card", async () => {
    setupFetch();
    writeReviewDraft({
      cardId: "11111111-1111-4111-8111-111111111111",
      stage: "answering",
      answer: "上次尚未提交的闭卷回答",
      declaredDontKnow: false,
      confidence: 3,
      assistanceLevel: "none",
      attemptStartedAt: Date.now(),
      attemptIdempotencyKey: "10000000-1000-4000-8000-100000000000",
      attemptId: null,
      revealedCard: null,
      feedback: null,
      blockType: "",
      selfCorrection: "",
      assumedProblem: "",
      causeHypothesis: "",
      nextMinimumAction: "",
      targetCardType: "concept"
    });
    window.history.pushState({}, "", "/review");

    render(<App />);

    expect(await screen.findByText("已恢复本地复习草稿")).toBeInTheDocument();
    expect(screen.getByDisplayValue("上次尚未提交的闭卷回答")).toBeInTheDocument();
    expect(screen.getByLabelText("3 · 比较有把握")).toBeChecked();
    expect(readReviewDraft()).not.toBeNull();
    await waitFor(() => expect(hasUnsavedChanges()).toBe(false));

    fireEvent.change(screen.getByLabelText("我的闭卷回答"), {
      target: { value: "恢复后继续补充的闭卷回答" }
    });
    await waitFor(() => expect(hasUnsavedChanges()).toBe(true));
  });

  it("persists a closed-note attempt before reveal, then saves evidence and advances", async () => {
    const { calls } = setupFetch();
    window.history.pushState({}, "", "/review");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "今日复习" })).toBeInTheDocument();
    expect(await screen.findByText("ε-N")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "For every epsilon greater than zero, there exists N such that n>N implies distance is less than epsilon."
      )
    ).not.toBeInTheDocument();
    expect(screen.queryByText("答案面")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("我的闭卷回答"), {
      target: { value: "先给任意精度，再找到统一控制后续项的阶段。" }
    });
    fireEvent.click(screen.getByLabelText("3 · 比较有把握"));
    fireEvent.click(screen.getByRole("button", { name: "保存尝试并揭示答案" }));

    expect(
      await screen.findByText(
        "For every epsilon greater than zero, there exists N such that n>N implies distance is less than epsilon."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("N may depend on epsilon, but not on n.")).toBeInTheDocument();

    for (const label of ["忘了", "模糊", "会了", "很熟"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByLabelText("会了"));
    fireEvent.click(screen.getByRole("button", { name: "保存复习结果" }));

    await waitFor(() =>
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: "/api/review/11111111-1111-4111-8111-111111111111/result",
            method: "POST",
            body: expect.objectContaining({
              attemptId: "review-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              feedback: "known",
              diagnosisDraft: null
            })
          })
        ])
      )
    );
    const attemptCall = calls.find((call) => call.url.endsWith("/attempt"));
    expect(JSON.stringify(attemptCall?.body)).toMatch(
      /"idempotencyKey":"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/u
    );
    expect(calls.findIndex((call) => call.url.endsWith("/attempt"))).toBeLessThan(
      calls.findIndex((call) => call.url.endsWith("/result"))
    );
    expect(await screen.findByRole("link", {
      name: "为本卡提交或查看证据"
    })).toHaveAttribute("href", "/verification?cardId=11111111-1111-4111-8111-111111111111");
    fireEvent.click(await screen.findByRole("button", { name: "下一张" }));
    expect(await screen.findByText("紧致性")).toBeInTheDocument();
  });

  it("renders legacy counterexample and proof cards from the actual schema fields", async () => {
    setupLegacyReviewFetch();
    window.history.pushState({}, "", "/review");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "今日复习" })).toBeInTheDocument();
    expect(await screen.findByText("紧致性")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("我的闭卷回答"), {
      target: { value: "实数直线存在没有有限子覆盖的开覆盖。" }
    });
    fireEvent.click(screen.getByLabelText("3 · 比较有把握"));
    fireEvent.click(screen.getByRole("button", { name: "保存尝试并揭示答案" }));

    expect(await screen.findByText("反例内容")).toBeInTheDocument();
    expect(screen.getByText("Use the cover (-n, n) of R.")).toBeInTheDocument();
    expect(screen.getByText("打破条件")).toBeInTheDocument();
    expect(screen.getByText("No finite subcover exists.")).toBeInTheDocument();
    expect(screen.getByText("为什么不是")).toBeInTheDocument();
    expect(screen.getByText("Any finite subcollection only covers a bounded interval.")).toBeInTheDocument();
    expect(screen.queryByText("打破的说法")).not.toBeInTheDocument();
    expect(screen.queryByText("修正提示")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("会了"));
    fireEvent.click(screen.getByRole("button", { name: "保存复习结果" }));
    fireEvent.click(await screen.findByRole("button", { name: "下一张" }));

    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("我的闭卷回答"), {
      target: { value: "反设没有有限子覆盖，再用嵌套区间制造矛盾。" }
    });
    fireEvent.click(screen.getByLabelText("3 · 比较有把握"));
    fireEvent.click(screen.getByRole("button", { name: "保存尝试并揭示答案" }));

    expect(await screen.findByText("第一次尝试")).toBeInTheDocument();
    expect(screen.getByText("Try to choose one interval from the cover greedily.")).toBeInTheDocument();
    expect(screen.getByText("关键动作")).toBeInTheDocument();
    expect(screen.getByText("Use nested intervals to force a contradiction.")).toBeInTheDocument();
    expect(screen.getByText("证明骨架")).toBeInTheDocument();
    expect(screen.getByText("Assume no finite subcover, bisect repeatedly, then use convergence.")).toBeInTheDocument();
    expect(screen.getByText("失败原因")).toBeInTheDocument();
    expect(screen.getByText("The greedy attempt ignores global cover structure.")).toBeInTheDocument();
    expect(screen.queryByText("证明策略")).not.toBeInTheDocument();
    expect(screen.queryByText("关键引理")).not.toBeInTheDocument();
  });
});

describe("Flywheel graph page", () => {
  it("restores the selected concept and stage from the stable URL context", async () => {
    setupFetch();
    window.history.pushState(
      {},
      "",
      `/graph?concept=${encodeURIComponent("紧致性")}&stage=example`
    );

    render(<App />);

    const details = await screen.findByRole("complementary", { name: "概念详情" });
    expect(within(details).getByRole("heading", { name: "例子" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("concept")).toBe(
      "紧致性"
    );
    expect(new URLSearchParams(window.location.search).get("stage")).toBe("example");
  });

  it("renders the five-stage 3+2 flywheel and opens stage details without edit controls", async () => {
    setupFetch();
    window.history.pushState({}, "", "/graph");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "主题飞轮" })).toBeInTheDocument();
    const graph = await screen.findByLabelText("ε-N 主题飞轮");
    const stageButtons = within(graph).getAllByRole("button");
    expect(stageButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "1. 概念，覆盖已建立，今日待复习，1 张卡片",
      "2. 例子，覆盖未建立，未开始，0 张卡片",
      "3. 边界，覆盖未建立，未开始，0 张卡片",
      "4. 流程，覆盖未建立，未开始，0 张卡片",
      "5. 错误，覆盖未建立，未开始，0 张卡片"
    ]);
    expect(screen.getByText(/覆盖：/u).parentElement).toHaveTextContent(
      "覆盖：1 / 5 个维度已建立"
    );
    expect(screen.queryByText(/\d+%/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("五类覆盖度")).not.toBeInTheDocument();
    expect(stageButtons[1]).toHaveAttribute("aria-pressed", "true");
    expect(stageButtons[1]).not.toHaveAttribute("draggable");
    fireEvent.click(stageButtons[2]);

    const detail = await screen.findByRole("complementary", { name: "概念详情" });
    expect(within(detail).getByRole("heading", { name: "边界" })).toBeInTheDocument();
    expect(within(detail).getByText("未建立")).toBeInTheDocument();
    expect(within(detail).getByText("未开始")).toBeInTheDocument();
    expect(within(detail).getByText("证据待验证")).toBeInTheDocument();
    expect(within(detail).getByText("proof-search")).toBeInTheDocument();
    expect(within(detail).getByText("补 1 张例子卡", { selector: "strong" })).toBeInTheDocument();
    fireEvent.click(within(detail).getByText("查看缺口与关联"));
    expect(within(detail).getAllByText("补 1 张例子卡")).toHaveLength(2);
    expect(within(detail).getByText("补 1 张边界卡")).toBeInTheDocument();
    expect(within(detail).getByText("完成今日到期复习")).toBeInTheDocument();
    const gapTags = within(detail).getByRole("list", { name: "缺口标签" });
    expect(gapTags).toHaveClass("graph-gap-tags");
    expect(within(gapTags).getAllByRole("listitem")[0]).toHaveClass("graph-gap-tag");
    const flywheelCss = await readFile(join(process.cwd(), "src/features/graph/flywheel.css"), "utf8");
    expect(flywheelCss).toContain("grid-template-columns: repeat(6, minmax(0, 1fr));");
    expect(flywheelCss).toContain(".flywheel-stage-position--concept");
    expect(flywheelCss).toContain("@media (max-width: 768px)");
    expect(flywheelCss).toContain(".graph-gap-tags");
    expect(flywheelCss).toContain(".graph-gap-tag");
    expect(screen.queryByRole("button", { name: /创建边|新增边|保存布局/u })).not.toBeInTheDocument();
    expect(screen.queryByText(/拖拽|缩放布局|手动连线/u)).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "在 Reader 补边界卡" }));
    expect(window.location.pathname).toBe("/reader");
    expect(window.location.search).toBe("?concept=%CE%B5-N&stage=boundary");
    expect(
      await screen.findByRole("button", { name: "← 返回主题飞轮" })
    ).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "飞轮工作上下文" })).toHaveTextContent(
      "围绕「ε-N」补一张边界卡"
    );
  });

  it("distinguishes a Graph load failure from an empty graph and recovers on Retry", async () => {
    const { fetchMock } = setupFetch();
    let failGraph = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/graph/state") && failGraph) {
          failGraph = false;
          return new Response(
            JSON.stringify({ error: { code: "GRAPH_UNAVAILABLE", message: "图谱暂时不可用" } }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
        return fetchMock(input, init);
      })
    );
    window.history.pushState({}, "", "/graph");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("图谱暂时不可用");
    expect(screen.queryByText("还没有可显示的概念。先从阅读摘录生成第一张卡片。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
    expect(await screen.findByLabelText("ε-N 主题飞轮")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
