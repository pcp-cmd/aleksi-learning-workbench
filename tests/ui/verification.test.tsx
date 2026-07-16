// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";

const CARD_ID = "11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = `evidence-${"a".repeat(64)}`;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("verification workbench", () => {
  it("freezes a learner attempt, copies the verifier prompt, and records repair evidence", async () => {
    let candidate: Record<string, unknown> | null = null;
    const prompt = "Independent verifier prompt: not a formal proof certificate";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/cards/recent?limit=10")) {
        return json({
          cards: [{ id: CARD_ID, title: "归纳法结构", concept: "数学归纳法", type: "concept" }]
        });
      }
      if (url.endsWith("/api/verification/candidates") && method === "GET") {
        return json({ candidates: candidate === null ? [] : [candidate] });
      }
      if (url.endsWith("/api/verification/candidates") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        candidate = {
          id: EVIDENCE_ID,
          title: "候选证据：归纳法结构",
          concept: "数学归纳法",
          cardId: CARD_ID,
          cardPath: "02-概念卡/归纳法结构.md",
          statement: body.statement,
          proofAttempt: body.proofAttempt,
          predecessorIds: [],
          relations: [],
          assistanceLevel: body.assistanceLevel,
          evidenceQuality: "independent",
          createdAt: "2026-07-13T02:00:00.000Z",
          status: "awaiting-verification",
          qualifiesForMastery: false,
          verdict: null,
          contextSnapshot: {
            cardRevision: 1,
            cardSnapshotSha256: "c".repeat(64),
            sourceSnapshots: []
          },
          revocationImpacts: [],
          relativePath: `10-Codex任务/验证证据/${EVIDENCE_ID}.md`,
          verificationPrompt: prompt
        };
        return json({ candidate, replayed: false }, 201);
      }
      if (url.endsWith(`/api/verification/candidates/${EVIDENCE_ID}`) && method === "GET") {
        return json({ candidate });
      }
      if (url.endsWith(`/api/verification/candidates/${EVIDENCE_ID}/verdict`) && method === "POST") {
        const body = JSON.parse(String(init?.body));
        candidate = {
          ...candidate,
          status: "repair-needed",
          qualifiesForMastery: false,
          verdict: {
            id: `verdict-${"b".repeat(64)}`,
            ...body,
            verifiedAt: "2026-07-13T02:05:00.000Z"
          }
        };
        return json({ candidate, replayed: false }, 201);
      }
      return json({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetchMock);
    Object.assign(navigator, { clipboard: { writeText } });

    window.history.pushState({}, "", "/verification");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "证据验证" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("我主张的结论"), {
      target: { value: "三角形数公式对所有正整数成立。" }
    });
    fireEvent.change(screen.getByLabelText("我的证明或论证"), {
      target: { value: "先验基例，再由 n 推到 n+1。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存不可覆盖的候选证据" }));

    expect(await screen.findByText("等待审查")).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "复制审查提示词" })
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt));

    fireEvent.change(screen.getByLabelText("审查摘要"), {
      target: { value: "归纳步骤缺少代数展开。" }
    });
    fireEvent.change(screen.getByLabelText("论证缺口 1 位置"), {
      target: { value: "归纳步骤" }
    });
    fireEvent.change(screen.getByLabelText("论证缺口 1 问题"), {
      target: { value: "没有展示从假设到 n+1 的等式化简。" }
    });
    fireEvent.change(screen.getByLabelText("修复提示"), {
      target: { value: "补齐加上 n+1 后的逐行化简。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存不可覆盖的审查结论" }));

    expect(await screen.findByText("需要修复")).toBeInTheDocument();
    expect(screen.getByText(/请保留这份旧稿/u)).toBeInTheDocument();
    expect(screen.getByText(/补齐加上 n\+1 后的逐行化简/u)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/verification/candidates/${EVIDENCE_ID}/verdict`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("imports GPT Plus JSON as an editable preview and requires confirmation", async () => {
    let submittedVerdict: Record<string, unknown> | null = null;
    let candidate: Record<string, unknown> = {
      id: EVIDENCE_ID,
      title: "候选证据：归纳法结构",
      concept: "数学归纳法",
      cardId: CARD_ID,
      cardPath: "02-概念卡/归纳法结构.md",
      statement: "三角形数公式对所有正整数成立。",
      proofAttempt: "先验基例，再由 n 推到 n+1。",
      predecessorIds: [],
      relations: [],
      assistanceLevel: "none",
      evidenceQuality: "independent",
      createdAt: "2026-07-13T02:00:00.000Z",
      status: "awaiting-verification",
      qualifiesForMastery: false,
      verdict: null,
      contextSnapshot: {
        cardRevision: 1,
        cardSnapshotSha256: "c".repeat(64),
        sourceSnapshots: []
      },
      revocationImpacts: [],
      relativePath: `10-Codex任务/验证证据/${EVIDENCE_ID}.md`,
      verificationPrompt: "Independent verifier prompt"
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/cards/recent?limit=10")) {
        return json({ cards: [{ id: CARD_ID, title: "归纳法结构", concept: "数学归纳法", type: "concept" }] });
      }
      if (url.endsWith("/api/verification/candidates") && method === "GET") {
        return json({ candidates: [candidate] });
      }
      if (url.endsWith(`/api/verification/candidates/${EVIDENCE_ID}`) && method === "GET") {
        return json({ candidate });
      }
      if (url.endsWith(`/api/verification/candidates/${EVIDENCE_ID}/verdict`) && method === "POST") {
        submittedVerdict = JSON.parse(String(init?.body));
        candidate = {
          ...candidate,
          status: "accepted",
          verdict: {
            id: `verdict-${"b".repeat(64)}`,
            ...submittedVerdict,
            confirmedByUser: true,
            formalProof: false,
            verifiedAt: "2026-07-13T02:05:00.000Z"
          }
        };
        return json({
          candidate,
          replayed: false
        }, 201);
      }
      return json({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", `/verification?cardId=${CARD_ID}`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /三角形数公式对所有正整数成立/u }));
    fireEvent.click(await screen.findByText("从 ChatGPT Plus 粘贴结构化审查 JSON"));
    fireEvent.change(screen.getByLabelText("粘贴 GPT Plus 审查 JSON"), {
      target: {
        value: JSON.stringify({
          verificationReport: {
            summary: "字段类型错误不应让页面崩溃。",
            criticalErrors: [{ location: 3, issue: null }],
            gaps: []
          },
          verdict: "wrong",
          repairHints: "修复"
        })
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "解析并预览 GPT JSON" }));
    expect(screen.getByRole("status")).toHaveTextContent("字段类型不正确");
    expect(screen.getByRole("heading", { name: "证据验证" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("粘贴 GPT Plus 审查 JSON"), {
      target: {
        value: JSON.stringify({
          verificationReport: {
            summary: "基例与归纳步骤完整。",
            criticalErrors: [],
            gaps: []
          },
          verdict: "correct",
          repairHints: ""
        })
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "解析并预览 GPT JSON" }));

    expect(screen.getByLabelText("审查来源")).toHaveValue("gpt-plus-import");
    expect(screen.getByLabelText("审查摘要")).toHaveValue("基例与归纳步骤完整。");
    const save = screen.getByRole("button", { name: "保存不可覆盖的审查结论" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /我已检查可编辑预览/u }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(submittedVerdict).toMatchObject({
      verifierKind: "gpt-plus-import",
      confirmed: true,
      verdict: "correct"
    }));
    expect(await screen.findByText(/增强了信任，但不会自动改变掌握度/u)).toBeInTheDocument();
  });
});
