// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardLibrary } from "../../src/features/cards/CardLibrary";
import { CardStudioPage } from "../../src/features/cards/CardStudioPage";
import { ContextualReturnControl } from "../../src/components/ContextualReturnControl";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function libraryResponse() {
  return {
    cards: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "积分的几何意义",
        concept: "积分",
        type: "concept",
        typeLabel: "概念卡",
        mastery: "learning",
        nextReview: "2026-07-30",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
        archived: false
      }
    ],
    pageInfo: { hasMore: false, nextCursor: null },
    degraded: {
      active: true,
      parseErrorCount: 1,
      recoveryAction: "rebuild-index"
    }
  };
}

function renderLibrary(
  onOpenCard = vi.fn(),
  onEditCard = vi.fn()
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <CardLibrary onEditCard={onEditCard} onOpenCard={onOpenCard} />
    </QueryClientProvider>
  );
  return { client, onEditCard, onOpenCard };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("full Card Library", () => {
  it("C04/C07/C09 keeps cards visible in degraded mode with accessible recovery and no paths", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/cards/library")) return response(libraryResponse());
      if (url === "/api/index/rebuild" && init?.method === "POST") {
        return response({ recoveredFromCorruption: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { onOpenCard } = renderLibrary();

    const region = await screen.findByRole("region", { name: "全部卡片" });
    expect(
      await within(region).findByText("积分的几何意义")
    ).toBeInTheDocument();
    expect(within(region).getByRole("status")).toHaveTextContent("索引");
    expect(region).not.toHaveTextContent("C:\\");
    expect(region).not.toHaveTextContent("02-概念卡");

    const open = within(region).getByRole("button", {
      name: "打开 积分的几何意义"
    });
    open.focus();
    expect(open).toHaveFocus();
    fireEvent.keyDown(open, { key: "Enter" });
    fireEvent.click(open);
    expect(onOpenCard).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111"
    );

    fireEvent.click(
      within(region).getByRole("button", { name: "重建卡片索引" })
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/index/rebuild",
        expect.objectContaining({ method: "POST" })
      )
    );
  });

  it("C05 opens a non-recent deep-linked card by ID", async () => {
    const cardId = "22222222-2222-4222-8222-222222222222";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/cards/recent?limit=10") {
          return response(
            { error: { code: "RECENT_UNAVAILABLE", message: "recent failed" } },
            500
          );
        }
        if (url.startsWith("/api/cards/library")) {
          return response({
            cards: [],
            pageInfo: { hasMore: false, nextCursor: null },
            degraded: { active: false, parseErrorCount: 0, recoveryAction: null }
          });
        }
        if (url === `/api/cards/${cardId}`) {
          return response({
            card: {
              id: cardId,
              type: "definition",
              title: "非最近卡片",
              concept: "紧致性",
              sourceReading: "C:\\Users\\pcp\\private-reading.md",
              relativePath: "02-定义卡/紧致性.md",
              modifiedAt: "2026-07-29T00:00:00.000Z",
              formalDefinition: "每个开覆盖都有有限子覆盖。"
            }
          });
        }
        if (url === `/api/verification/knowledge/${cardId}`) {
          return response({
            knowledge: {
              cardId,
              trustState: "unverified",
              activeEvidenceIds: [],
              affectedEvidenceIds: [],
              prerequisites: [],
              usedBy: [],
              revocationImpacts: []
            }
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/cards?cardId=${cardId}`]}>
          <Routes>
            <Route path="/cards" element={<CardStudioPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole("heading", { name: "非最近卡片" })
    ).toBeInTheDocument();
    expect(screen.getByText("每个开覆盖都有有限子覆盖。")).toBeInTheDocument();
    expect(screen.getByText("来源阅读不可用")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("C:\\Users\\pcp");
    expect(
      screen.queryByRole("button", { name: "打开来源阅读" })
    ).not.toBeInTheDocument();
  });

  it("opens a card's source reading and returns to the exact card context", async () => {
    const cardId = "55555555-5555-4555-8555-555555555555";
    const sourceReadingId = "66666666-6666-4666-8666-666666666666";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/cards/recent?limit=10") return response({ cards: [] });
        if (url.startsWith("/api/cards/library")) {
          return response({
            cards: [],
            pageInfo: { hasMore: false, nextCursor: null },
            degraded: { active: false, parseErrorCount: 0, recoveryAction: null }
          });
        }
        if (url === `/api/cards/${cardId}`) {
          return response({
            card: {
              id: cardId,
              type: "concept",
              title: "带来源的卡片",
              concept: "积分",
              sourceReadingId,
              sourceReading: "01-阅读材料/积分.md",
              relativePath: "02-概念卡/积分.md",
              modifiedAt: "2026-08-08T00:00:00.000Z",
              myUnderstanding: "积分累积局部贡献。"
            }
          });
        }
        if (url === `/api/verification/knowledge/${cardId}`) {
          return response({
            knowledge: {
              cardId,
              trustState: "unverified",
              activeEvidenceIds: [],
              affectedEvidenceIds: [],
              prerequisites: [],
              usedBy: [],
              revocationImpacts: []
            }
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/cards?cardId=${cardId}`]}>
          <Routes>
            <Route path="/cards" element={<CardStudioPage />} />
            <Route
              path="/reader"
              element={(
                <section>
                  <ContextualReturnControl />
                  <h1>来源阅读</h1>
                </section>
              )}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole("heading", { name: "带来源的卡片" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开来源阅读" }));
    expect(await screen.findByRole("heading", { name: "来源阅读" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← 返回卡片库" }));
    expect(
      await screen.findByRole("heading", { name: "带来源的卡片" })
    ).toBeInTheDocument();
  });

  it("C06 archives with the version fetched immediately before the mutation", async () => {
    const currentVersion = {
      sha256: "a".repeat(64),
      size: 512,
      mtimeNs: "123",
      inode: "456"
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/cards/library")) return response(libraryResponse());
      if (
        url === "/api/cards/11111111-1111-4111-8111-111111111111" &&
        init?.method !== "POST"
      ) {
        return response({ card: { version: currentVersion } });
      }
      if (
        url ===
          "/api/cards/11111111-1111-4111-8111-111111111111/archive" &&
        init?.method === "POST"
      ) {
        return response({ archived: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "归档 积分的几何意义"
      })
    );

    await waitFor(() => {
      const archiveCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith("/archive") && init?.method === "POST"
      );
      expect(archiveCall).toBeDefined();
      expect(JSON.parse(String(archiveCall?.[1]?.body))).toEqual({
        confirmed: true,
        expectedVersion: currentVersion
      });
    });
  });

  it("C06 edits a library card through the existing editor with the current CAS version", async () => {
    const cardId = "11111111-1111-4111-8111-111111111111";
    const currentVersion = {
      sha256: "b".repeat(64),
      size: 768,
      mtimeNs: "789",
      inode: "1011"
    };
    const nextVersion = {
      sha256: "c".repeat(64),
      size: 780,
      mtimeNs: "790",
      inode: "1011"
    };
    const card = {
      id: cardId,
      type: "concept",
      title: "积分的几何意义",
      concept: "积分",
      relatedConcepts: ["面积"],
      sourceReadingId: "33333333-3333-4333-8333-333333333333",
      sourceReading: "01-阅读材料/积分.md",
      excerpt: "积分表示带符号面积。",
      understanding: "把小块面积累加。",
      blockType: null,
      nextAction: "完成一道换元积分题",
      createdAt: "2026-07-01T00:00:00.000Z",
      nextReview: "2026-07-30",
      mastery: "learning",
      formalExplanation: "黎曼和的极限。",
      myUnderstanding: "局部累加形成整体。",
      commonMisunderstanding: "",
      usageContext: "求面积",
      relativePath: "02-概念卡/积分的几何意义.md",
      modifiedAt: "2026-07-29T00:00:00.000Z",
      version: currentVersion
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/cards/recent?limit=10") {
        return response({ cards: [] });
      }
      if (url.startsWith("/api/cards/library")) return response(libraryResponse());
      if (url === `/api/cards/${cardId}` && init?.method !== "PUT") {
        return response({ card });
      }
      if (url === `/api/cards/${cardId}` && init?.method === "PUT") {
        return response({
          card: {
            ...card,
            version: nextVersion,
            modifiedAt: "2026-07-29T01:00:00.000Z"
          },
          saveReceipt: {
            relativePath: card.relativePath,
            modifiedAt: "2026-07-29T01:00:00.000Z"
          }
        });
      }
      if (url === `/api/verification/knowledge/${cardId}`) {
        return response({
          knowledge: {
            cardId,
            trustState: "unverified",
            activeEvidenceIds: [],
            affectedEvidenceIds: [],
            prerequisites: [],
            usedBy: [],
            revocationImpacts: []
          }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/cards"]}>
          <Routes>
            <Route path="/cards" element={<CardStudioPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "编辑 积分的几何意义"
      })
    );
    expect(
      await screen.findByDisplayValue("积分的几何意义")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));

    await waitFor(() => {
      const updateCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === `/api/cards/${cardId}` && init?.method === "PUT"
      );
      expect(updateCall).toBeDefined();
      expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({
        expectedVersion: currentVersion,
        sourceReadingId: card.sourceReadingId,
        title: card.title
      });
    });
  });
});
