// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../../src/features/settings/SettingsDialog";
import {
  runLibraryMutation,
  runLibrarySwitch
} from "../../src/lib/library-mutation-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function abortedOperation(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true
    });
  });
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function stubSettingsReads(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/api/vault/status")) {
        return response({ status: null });
      }
      if (url.endsWith("/api/vault/recommended-path")) {
        return response({ path: "C:\\Users\\pcp\\Documents\\Aleksi" });
      }
      if (url.endsWith("/api/runtime/capabilities")) {
        return response({
          mode: "browser-development",
          identity: { version: "1.0.0", buildId: "task8-test" },
          openLearningLibrary: true,
          exportDiagnostics: true,
          exitWorkbench: true
        });
      }
      return new Response("not found", { status: 404 });
    })
  );
}

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsDialog
        onClose={vi.fn()}
        onRequestApplicationClose={vi.fn(async () => "cancelled" as const)}
        open
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("settings delayed-switch recovery", () => {
  it("L05 names the delaying commit and lets the user cancel only the switch", async () => {
    stubSettingsReads();
    const commitGate = deferred<void>();
    const commit = runLibraryMutation(() => commitGate.promise, {
      label: "提交复习证据",
      cancellable: false
    });
    const switchOperation = vi.fn(async () => undefined);
    const switching = runLibrarySwitch(switchOperation, {
      label: "更换学习库",
      delayThresholdMs: 10
    });

    renderSettings();

    expect(
      await screen.findByRole("heading", { name: "学习库切换等待时间较长" })
    ).toBeInTheDocument();
    expect(screen.getByText(/提交复习证据/u)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消卡住的保存并重试" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消切换" }));
    await expect(switching).rejects.toMatchObject({
      code: "LIBRARY_SWITCH_CANCELLED"
    });
    expect(switchOperation).not.toHaveBeenCalled();

    commitGate.resolve();
    await commit;
  });

  it("cancels a safe stuck save from Settings and continues the pending switch", async () => {
    stubSettingsReads();
    const save = runLibraryMutation(abortedOperation, {
      label: "保存卡片“积分”",
      cancellable: true
    });
    const switchOperation = vi.fn(async () => "vault-b");
    const switching = runLibrarySwitch(switchOperation, {
      label: "更换学习库",
      delayThresholdMs: 10
    });

    renderSettings();

    const cancelSave = await screen.findByRole("button", {
      name: "取消卡住的保存并重试"
    });
    expect(screen.getByText(/保存卡片“积分”/u)).toBeInTheDocument();
    fireEvent.click(cancelSave);

    await expect(save).rejects.toMatchObject({
      code: "LIBRARY_MUTATION_CANCELLED"
    });
    await expect(switching).resolves.toBe("vault-b");
    expect(switchOperation).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "学习库切换等待时间较长" })
      ).not.toBeInTheDocument()
    );
  });

  it("keeps writes locked and offers an explicit retry when service reconciliation is required", async () => {
    stubSettingsReads();
    const switching = runLibrarySwitch(
      async (_signal, recovery) => {
        recovery.enterRecovery();
        await recovery.waitForRetry();
        return "confirmed";
      },
      {
        label: "更换本地学习库",
        delayThresholdMs: 0
      }
    );

    renderSettings();

    expect(
      await screen.findByText(/本地服务暂时无法确认/u)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消切换" })
    ).not.toBeInTheDocument();
    const retry = screen.getByRole("button", {
      name: "重新连接并确认切换结果"
    });
    fireEvent.click(retry);

    await expect(switching).resolves.toBe("confirmed");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "重新连接并确认切换结果"
        })
      ).not.toBeInTheDocument()
    );
  });
});
