// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardEditor } from "../../src/features/cards/CardEditor";
import { createCardDraftFromReaderSelection } from "../../src/features/cards/card-draft";
import { ReadingForm } from "../../src/features/reader/ReadingForm";
import { SettingsDialog } from "../../src/features/settings/SettingsDialog";
import { queryClient } from "../../src/app/query-client";

const desktopMocks = vi.hoisted(() => ({
  exportDiagnostics: vi.fn(),
  isDesktop: vi.fn(() => true),
  openLearningLibrary: vi.fn(),
  requestExit: vi.fn(),
  selectLearningLibrary: vi.fn(),
  selectReadingFile: vi.fn()
}));

vi.mock("../../src/desktop/runtime", () => ({
  desktopRuntime: desktopMocks
}));

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  Object.values(desktopMocks).forEach((mock) => mock.mockReset());
  desktopMocks.isDesktop.mockReturnValue(true);
});

describe("desktop interaction adapters", () => {
  it("uses the native file picker and continues through the existing Reading form", async () => {
    desktopMocks.selectReadingFile.mockResolvedValue({
      body: "# 中文标题\r\n\r\n正文",
      fileName: "中文材料.md",
      size: 30
    });

    render(<ReadingForm onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /从电脑选择材料/u }));

    await waitFor(() =>
      expect(screen.getByLabelText("粘贴你要精读的内容")).toHaveValue(
        "# 中文标题\n\n正文"
      )
    );
    expect(screen.getByLabelText("标题建议")).toHaveValue("中文材料");
    expect(desktopMocks.selectReadingFile).toHaveBeenCalledTimes(1);
  });

  it("uses the native directory picker only to populate the validated settings path", async () => {
    desktopMocks.selectLearningLibrary.mockResolvedValue(
      "C:\\Users\\学习者\\Documents\\Aleksi 学习库"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/vault/status")) {
          return response({ status: null });
        }
        if (url.endsWith("/api/vault/recommended-path")) {
          return response({ path: "C:\\Users\\学习者\\Documents\\Aleksi" });
        }
        return response({
          mode: "tauri-desktop",
          identity: { version: "0.1.0", buildId: "desktop-test" },
          openLearningLibrary: true,
          exportDiagnostics: true,
          exitWorkbench: true
        });
      })
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SettingsDialog onClose={vi.fn()} open />
      </QueryClientProvider>
    );
    await screen.findByText("tauri-desktop");
    fireEvent.click(screen.getAllByRole("button", { name: "浏览…" })[0]);

    await waitFor(() =>
      expect(screen.getByLabelText("新学习库位置")).toHaveValue(
        "C:\\Users\\学习者\\Documents\\Aleksi 学习库"
      )
    );
    expect(desktopMocks.selectLearningLibrary).toHaveBeenCalledTimes(1);
  });

  it("dispatches Ctrl+S through the current card editor without a second save path", async () => {
    const onSave = vi.fn(async () => undefined);
    const draft = createCardDraftFromReaderSelection({
      source: "reader-selection",
      target: "cards",
      sourceReadingId: "reading-1",
      sourcePath: "01-阅读材料/极限.md",
      concept: "极限",
      excerpt: "任意 epsilon 都能找到对应的 N。",
      cardType: "concept"
    });

    render(
      <CardEditor
        draft={draft}
        onChange={vi.fn()}
        onSave={onSave}
        receipt={null}
        saveState="unsaved"
      />
    );
    window.dispatchEvent(new Event("aleksi:save-current"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});
