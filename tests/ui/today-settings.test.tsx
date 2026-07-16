// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import { queryKeys } from "../../src/app/query-keys";
import { createDraftStore } from "../../src/lib/draft-store";

const NOW = "2026-06-22T03:14:15.926Z";
const INITIAL_VAULT = "C:\\Users\\pcp\\Documents\\Aleksi-Learning-Vault";
const RECOMMENDED_VAULT = "C:\\Users\\pcp\\Documents\\Aleksi Learning Workbench";

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

function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function setupFetch(
  options: {
    failAutoPrepare?: boolean;
    failRecentCards?: boolean;
    failInitialize?: boolean;
    initialVaultPath?: string;
    recommendedVaultPath?: string;
  } = {}
) {
  let vaultStatus = {
    path: options.initialVaultPath ?? INITIAL_VAULT,
    initialized: true,
    writable: true,
    readOnlyReason: null,
    lastSaveAt: NOW
  };
  const calls: FetchCall[] = [];
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

    if (url.endsWith("/api/vault/status")) {
      return response({ status: vaultStatus });
    }

    if (url.endsWith("/api/vault/recommended-path")) {
      return response({
        path: options.recommendedVaultPath ?? RECOMMENDED_VAULT
      });
    }

    if (url.endsWith("/api/runtime/capabilities")) {
      return response({
        mode: "friend-preview",
        identity: {
          version: "0.1.0",
          buildId: "sha256-0123456789abcdef"
        },
        openLearningLibrary: true,
        exportDiagnostics: true,
        exitWorkbench: true
      });
    }

    if (url.endsWith("/api/runtime/open-library")) {
      return response({ opened: true });
    }

    if (url.endsWith("/api/runtime/exit")) {
      return response({ exiting: true });
    }

    if (url.endsWith("/api/vault/auto-prepare")) {
      if (options.failAutoPrepare === true) {
        return errorResponse("本地学习库不可写", 403);
      }

      return response({ status: vaultStatus });
    }

    if (url.endsWith("/api/today/next")) {
      if (options.failRecentCards === true) {
        return errorResponse("今日行动暂时不可用", 500);
      }

      return response({
        nextAction: {
          kind: "due-review",
          title: "完成 2 张到期复习",
          reason: "到期复习优先于继续输入新材料。",
          href: "/review",
          estimatedMinutes: 10,
          concept: "ε-N",
          count: 2
        },
        later: [
          {
            kind: "continue-reading",
            title: "拓扑空间",
            href: "/reader?reading=reading-2"
          },
          {
            kind: "new-reading",
            title: "开始一篇新精读",
            href: "/reader"
          }
        ]
      });
    }

    if (url.endsWith("/api/readings")) {
      return response({
        readings: [
          {
            id: "reading-1",
            type: "reading",
            title: "数列极限",
            concept: "ε-N",
            relativePath: "01-阅读材料/数列极限.md",
            updatedAt: "2026-06-21T03:14:15.926Z"
          },
          {
            id: "reading-2",
            type: "reading",
            title: "拓扑空间",
            concept: "开集",
            relativePath: "01-阅读材料/拓扑空间.md",
            updatedAt: NOW
          }
        ]
      });
    }

    if (url.endsWith("/api/cards/recent?limit=5")) {
      if (options.failRecentCards === true) {
        return errorResponse("最近卡片暂时不可用", 500);
      }

      return response({
        cards: [
          {
            id: "card-recent-1",
            title: "ε-N 概念卡",
            type: "concept",
            typeLabel: "概念卡",
            concept: "错误的顶层概念",
            relativePath: "02-概念卡/ε-N-概念卡.md",
            modifiedAt: NOW,
            preview: {
              concept: "ε-N",
              content: "先选精度 ε，再找 N。",
              sourceReading: "01-阅读材料/数列极限.md"
            }
          }
        ]
      });
    }

    if (url.endsWith("/api/review/today")) {
      return response({
        generatedAt: NOW,
        items: [
          {
            cardId: "card-1",
            cardPath: "02-定义卡/card-1.md",
            cardType: "definition",
            concept: "ε-N",
            mastery: "due",
            nextReview: "2026-06-22",
            lastReviewSequence: 2,
            lastReviewed: "2026-06-21T03:14:15.926Z",
            due: true
          },
          {
            cardId: "card-2",
            cardPath: "05-证明卡/card-2.md",
            cardType: "proof",
            concept: "ε-N",
            mastery: "learning",
            nextReview: "2026-06-22",
            lastReviewSequence: null,
            lastReviewed: null,
            due: true
          }
        ]
      });
    }

    if (url.endsWith("/api/vault/initialize") && body !== null) {
      if (options.failInitialize === true) {
        return errorResponse("初始化路径不可写", 403);
      }

      vaultStatus = {
        path: String((body as { path: string }).path),
        initialized: true,
        writable: true,
        readOnlyReason: null,
        lastSaveAt: NOW
      };
      return response({ status: vaultStatus });
    }

    if (url.endsWith("/api/vault/select") && body !== null) {
      vaultStatus = {
        path: String((body as { path: string }).path),
        initialized: true,
        writable: true,
        readOnlyReason: null,
        lastSaveAt: NOW
      };
      return response({ status: vaultStatus });
    }

    if (url.endsWith("/api/vault/migrate") && body !== null) {
      vaultStatus = {
        path: String((body as { destinationPath: string }).destinationPath),
        initialized: true,
        writable: true,
        readOnlyReason: null,
        lastSaveAt: NOW
      };
      return response({ status: vaultStatus });
    }

    if (url.endsWith("/api/vault/backup")) {
      return response({
        backupPath: "C:\\Users\\pcp\\Documents\\Aleksi-Learning-Vault-backup-20260622T031415926Z",
        status: vaultStatus
      });
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  queryClient.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
});

describe("Today and Settings surfaces", () => {
  it("auto-prepares the local learning library before reading dependent APIs", async () => {
    const { calls } = setupFetch();
    window.history.pushState({}, "", "/today");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "今日学习" })).toBeInTheDocument();
    expect(await screen.findByText("到期复习")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      url: "/api/vault/auto-prepare",
      method: "POST",
      body: null
    });
    expect(calls.some((call) => call.url === "/api/today/next")).toBe(true);
    expect(calls.some((call) => call.url === "/api/review/today")).toBe(false);
    expect(calls.some((call) => call.url === "/api/graph/state")).toBe(false);
    expect(document.body).not.toHaveTextContent("Vault");
    expect(document.body).not.toHaveTextContent("图谱");
    expect(document.body).not.toHaveTextContent("高频卡点");
    expect(screen.queryByLabelText("上下文状态")).not.toBeInTheDocument();
  });

  it("keeps Today focused on the next concrete learning actions", async () => {
    setupFetch();
    window.history.pushState({}, "", "/today");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "今日学习" })).toBeInTheDocument();
    expect(await screen.findByText("到期复习")).toBeInTheDocument();
    expect(screen.getByText("拓扑空间")).toBeInTheDocument();
    expect(screen.getByText("开始一篇新精读")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "开始：完成 2 张到期复习" })
    ).toHaveAttribute("href", "/review");
    expect(
      within(screen.getByLabelText("今日唯一下一步")).getAllByRole("link")
    ).toHaveLength(1);
    expect(screen.getByText("完成 2 张到期复习")).toBeInTheDocument();
    expect(screen.queryByText("01-阅读材料/数列极限.md")).not.toBeInTheDocument();
    expect(screen.queryByText(INITIAL_VAULT)).not.toBeInTheDocument();
    expect(screen.queryByText("proof-search")).not.toBeInTheDocument();
    expect(screen.getByText("当前概念 · ε-N")).toBeInTheDocument();
  });

  it("shows a visible degraded state when recent cards cannot be loaded", async () => {
    setupFetch({ failRecentCards: true });
    window.history.pushState({}, "", "/today");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "今日学习" })).toBeInTheDocument();
    expect(await screen.findByText("本地学习库无法访问")).toBeInTheDocument();
    expect(
      screen.getByText("请打开设置选择其他位置或创建新的学习库。")
    ).toBeInTheDocument();
  });

  it("shows a plain recovery message when auto-prepare fails", async () => {
    setupFetch({ failAutoPrepare: true });
    window.history.pushState({}, "", "/today");
    render(<App />);

    expect(await screen.findByText("本地学习库无法访问")).toBeInTheDocument();
    expect(screen.getByText("请打开设置选择其他位置或创建新的学习库。")).toBeInTheDocument();
    expect(screen.queryByText("Vault")).not.toBeInTheDocument();
  });

  it("opens Settings and sends confirmed learning-library initialize/select/migrate/backup operations", async () => {
    const { calls } = setupFetch();
    window.history.pushState({}, "", "/today");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    const dialog = await screen.findByRole("dialog", { name: "本地学习库设置" });
    expect(within(dialog).getAllByText(INITIAL_VAULT).length).toBeGreaterThan(0);
    expect(within(dialog).queryByLabelText("迁移来源")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "使用推荐位置" }));
    expect(within(dialog).getByLabelText("新学习库位置")).toHaveValue(RECOMMENDED_VAULT);

    fireEvent.change(within(dialog).getByLabelText("新学习库位置"), {
      target: { value: "\"C:\\Vaults\\Initialized\"" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建本地学习库" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/vault/initialize",
        method: "POST",
        body: { path: "C:\\Vaults\\Initialized" }
      })
    );

    const draftStore = createDraftStore<{ text: string }>({
      key: "settings-library-change-test",
      validate: (value): value is { text: string } =>
        typeof value === "object" &&
        value !== null &&
        "text" in value &&
        typeof value.text === "string"
    });
    draftStore.write("active-library", { text: "must not cross libraries" });
    queryClient.setQueryData(queryKeys.readings.all, { readings: ["old-library"] });

    fireEvent.change(within(dialog).getByLabelText("更换学习库位置"), {
      target: { value: "“C:\\Vaults\\Selected”" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "更换学习库" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/vault/select",
        method: "POST",
        body: { path: "C:\\Vaults\\Selected" }
      })
    );
    expect(draftStore.read("active-library")).toBeNull();
    expect(queryClient.getQueryData(queryKeys.readings.all)).toBeUndefined();

    fireEvent.click(within(dialog).getByRole("button", { name: "显示高级设置" }));
    expect(within(dialog).getByText("可写")).toBeInTheDocument();
    expect(within(dialog).getByText(NOW)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("迁移来源"), {
      target: { value: "‘C:\\Vaults\\Selected’" }
    });
    fireEvent.change(within(dialog).getByLabelText("迁移目标"), {
      target: { value: "'C:\\Vaults\\Migrated'" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "迁移学习库" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认迁移" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/vault/migrate",
        method: "POST",
        body: {
          sourcePath: "C:\\Vaults\\Selected",
          destinationPath: "C:\\Vaults\\Migrated",
          confirmed: true
        }
      })
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "备份学习库" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认备份" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/vault/backup",
        method: "POST",
        body: { confirmed: true }
      })
    );
    expect(
      await within(dialog).findByText(
        "C:\\Users\\pcp\\Documents\\Aleksi-Learning-Vault-backup-20260622T031415926Z"
      )
    ).toBeInTheDocument();
  });

  it("keeps Settings focused on common actions with advanced controls collapsed by default", async () => {
    setupFetch();
    window.history.pushState({}, "", "/today");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开设置" }));

    const dialog = await screen.findByRole("dialog", { name: "本地学习库设置" });
    const common = within(dialog).getByRole("region", { name: "常用设置" });
    expect(within(common).getByText("当前学习库位置")).toBeInTheDocument();
    expect(within(common).getByText(INITIAL_VAULT)).toBeInTheDocument();
    expect(within(common).getByText(RECOMMENDED_VAULT)).toBeInTheDocument();
    expect(within(common).getByRole("button", { name: "使用推荐位置" })).toBeInTheDocument();
    expect(within(common).getByRole("button", { name: "更换学习库" })).toBeInTheDocument();
    expect(within(common).getByRole("button", { name: "备份学习库" })).toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: "显示高级设置" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("迁移来源")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("只读原因")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "显示高级设置" }));
    expect(within(dialog).getByRole("region", { name: "高级设置" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("迁移来源")).toBeInTheDocument();
    expect(within(dialog).getByText("只读原因")).toBeInTheDocument();
  });

  it("offers explicit local runtime lifecycle actions", async () => {
    const { calls } = setupFetch();
    window.history.pushState({}, "", "/today");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开设置" }));
    const dialog = await screen.findByRole("dialog", { name: "本地学习库设置" });
    const runtime = within(dialog).getByRole("region", { name: "应用与诊断" });

    fireEvent.click(within(runtime).getByRole("button", { name: "打开本地学习库" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/runtime/open-library",
        method: "POST",
        body: null
      })
    );
    expect(
      within(runtime).getByRole("link", { name: "导出诊断" })
    ).toHaveAttribute("href", "/api/runtime/diagnostics");

    fireEvent.click(
      within(runtime).getByRole("button", { name: "退出 Aleksi Workbench" })
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "确认退出" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "/api/runtime/exit",
        method: "POST",
        body: { confirmed: true }
      })
    );
  });

  it("uses the backend-recommended learning-library path instead of deriving a user path in the frontend", async () => {
    setupFetch({
      initialVaultPath: "C:\\Users\\rina\\Documents\\Aleksi-Learning-Vault",
      recommendedVaultPath: "C:\\Users\\mika\\Documents\\Aleksi Learning Workbench"
    });
    window.history.pushState({}, "", "/today");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开设置" }));

    const dialog = await screen.findByRole("dialog", { name: "本地学习库设置" });
    const common = within(dialog).getByRole("region", { name: "常用设置" });
    expect(
      within(common).getByText("C:\\Users\\mika\\Documents\\Aleksi Learning Workbench")
    ).toBeInTheDocument();

    fireEvent.click(within(common).getByRole("button", { name: "使用推荐位置" }));
    expect(within(common).getByLabelText("新学习库位置")).toHaveValue(
      "C:\\Users\\mika\\Documents\\Aleksi Learning Workbench"
    );
    expect(
      within(common).queryByText("C:\\Users\\rina\\Documents\\Aleksi Learning Workbench")
    ).not.toBeInTheDocument();
    expect(within(common).queryByText(RECOMMENDED_VAULT)).not.toBeInTheDocument();
  });

  it("shows a visible error when a Settings action fails instead of losing the exception", async () => {
    setupFetch({ failInitialize: true });
    window.history.pushState({}, "", "/today");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开设置" }));

    const dialog = await screen.findByRole("dialog", { name: "本地学习库设置" });
    fireEvent.change(within(dialog).getByLabelText("新学习库位置"), {
      target: { value: "C:\\Vaults\\ReadOnly" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建本地学习库" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("初始化路径不可写");
    expect(within(dialog).getByRole("button", { name: "创建本地学习库" })).toBeEnabled();
  });

  it("routes all Settings mutations through a single action runner", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/features/settings/SettingsDialog.tsx"),
      "utf8"
    );

    expect(source).toContain("runSettingsAction");
    expect(source.match(/runSettingsAction/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
