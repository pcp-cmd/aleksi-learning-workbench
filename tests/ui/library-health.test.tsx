// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../src/app/query-keys";
import {
  LibraryHealthSection,
  LibraryWriteBlockWarning
} from "../../src/features/settings/LibraryHealthSection";
import {
  resetLibraryIdentity,
  setLibraryIdentity
} from "../../src/lib/library-identity";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function health(blocked: boolean) {
  return {
    blocked,
    transactions: blocked
      ? [
          {
            transactionId: "11111111-1111-4111-8111-111111111111",
            operation: "save-card",
            state: "quarantined",
            createdAt: "2026-07-29T00:00:00.000Z",
            updatedAt: "2026-07-29T00:00:00.000Z",
            targets: [],
            diagnostics: [],
            allowedActions: ["retry_recovery"]
          }
        ]
      : [],
    projections: {
      index: {
        schemaVersion: 1,
        projection: "index",
        status: "stale",
        attempts: 2,
        firstFailureAt: "2026-07-29T00:00:00.000Z",
        lastFailureAt: "2026-07-29T00:00:00.000Z",
        lastSuccessfulRebuildAt: null,
        errorId: "22222222-2222-4222-8222-222222222222",
        category: "PROJECTION_REBUILD_FAILED",
        updatedAt: "2026-07-29T00:00:00.000Z"
      }
    },
    backupCleanup: {
      schemaVersion: 1,
      status: "failed",
      attempts: 1,
      lastFailureAt: "2026-07-29T00:00:00.000Z",
      lastSuccessfulCleanupAt: null,
      category: "BACKUP_RETENTION_CLEANUP_FAILED",
      candidateName: "C:\\Users\\alice\\Private Backup",
      updatedAt: "2026-07-29T00:00:00.000Z"
    },
    quarantineCleanup: null
  };
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  return client;
}

afterEach(() => {
  resetLibraryIdentity();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("learning-library health UI", () => {
  it("explains blocked writes, locator, projection, and cleanup health without exposing paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(health(true)))
    );

    renderWithClient(<LibraryHealthSection locatorReady />);

    const region = await screen.findByRole("region", {
      name: "学习库健康"
    });
    expect(
      await within(region).findByText("写入已暂停")
    ).toBeInTheDocument();
    expect(within(region).getByText("学习库位置已确认")).toBeInTheDocument();
    expect(within(region).getByText("索引需要重建")).toBeInTheDocument();
    expect(within(region).getByText("备份清理上次失败")).toBeInTheDocument();
    expect(region).not.toHaveTextContent("C:\\");
    expect(region).not.toHaveTextContent("alice");
  });

  it("keeps the global warning visible until health no longer blocks writes", async () => {
    let blocked = true;
    setLibraryIdentity({
      instanceId: "library-health-test",
      vaultId: "33333333-3333-4333-8333-333333333333",
      generation: 1
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(health(blocked)))
    );
    const onOpenSettings = vi.fn();
    const client = renderWithClient(
      <LibraryWriteBlockWarning onOpenSettings={onOpenSettings} />
    );

    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("学习库写入已暂停");
    expect(
      within(warning).queryByRole("button", { name: "关闭" })
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(warning).getByRole("button", { name: "打开设置查看恢复详情" })
    );
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    blocked = false;
    await client.invalidateQueries({ queryKey: queryKeys.vault.health });
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    );
  });

  it("shows locator recovery guidance without issuing a health request before a library is active", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithClient(<LibraryHealthSection locatorReady={false} />);

    expect(screen.getByText("学习库位置尚未确认")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
