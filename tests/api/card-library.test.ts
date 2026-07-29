import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { recordProjectionFailureHealth } from "../../server/projections/projection-health";
import {
  CardLibraryServiceError,
  queryCardLibraryIndex
} from "../../server/services/card-library-service";
import type { IndexDocument } from "../../server/services/index-service";
import { createTempVaultContext } from "../temp-vault";

const GENERATED_AT = "2026-07-29T10:00:00.000Z";
const FINGERPRINT = "a".repeat(64);

type CardAsset = {
  id: string;
  assetType: "concept" | "definition" | "example";
  title: string;
  concept: string;
  relativePath: string;
  mastery: "learning" | "due" | "mastered";
  nextReview: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

function cardAsset(
  index: number,
  overrides: Partial<CardAsset> = {}
): CardAsset {
  const day = String(index + 1).padStart(2, "0");
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    assetType: "definition",
    title: `Card ${String(index).padStart(2, "0")}`,
    concept: index % 2 === 0 ? "Topology" : "Calculus",
    relativePath: `02-定义卡/Card-${index}.md`,
    mastery: "learning",
    nextReview: `2026-07-${day}`,
    createdAt: `2026-06-${day}T08:00:00.000Z`,
    updatedAt: `2026-07-${day}T09:00:00.000Z`,
    archived: false,
    ...overrides
  };
}

async function setup(assets: CardAsset[], parseErrors: unknown[] = []) {
  const context = await createTempVaultContext();
  const vaultPath = context.path("Vault");
  const app = createApp();
  const initialize = await request(app)
    .post("/api/vault/initialize")
    .send({ path: vaultPath });
  expect(initialize.status).toBe(200);
  await mkdir(join(vaultPath, ".aleksi"), { recursive: true });
  await writeFile(
    join(vaultPath, ".aleksi", "index.json"),
    `${JSON.stringify(
      {
        generatedAt: GENERATED_AT,
        sourceFingerprint: FINGERPRINT,
        assets,
        parseErrors
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return { app, context, vaultPath };
}

describe("bounded card library API", () => {
  it("C01 returns deterministic cursor pages without duplicates", async () => {
    const { app, context } = await setup(
      Array.from({ length: 7 }, (_, index) => cardAsset(index))
    );

    const first = await request(app).get(
      "/api/cards/library?limit=3&sort=updated&order=desc"
    );
    const repeated = await request(app).get(
      "/api/cards/library?limit=3&sort=updated&order=desc"
    );
    expect(first.status).toBe(200);
    expect(repeated.body).toEqual(first.body);
    expect(first.body.cards).toHaveLength(3);
    expect(first.body.pageInfo.nextCursor).toEqual(expect.any(String));

    const second = await request(app).get(
      `/api/cards/library?limit=3&sort=updated&order=desc&cursor=${encodeURIComponent(
        first.body.pageInfo.nextCursor
      )}`
    );
    expect(second.status).toBe(200);
    const ids = [...first.body.cards, ...second.body.cards].map(
      (card: { id: string }) => card.id
    );
    expect(new Set(ids).size).toBe(ids.length);

    const secondVault = context.path("CursorSecondVault");
    expect(
      (
        await request(app)
          .post("/api/vault/initialize")
          .send({ path: secondVault })
      ).status
    ).toBe(200);
    await writeFile(
      join(secondVault, ".aleksi", "index.json"),
      `${JSON.stringify(
        {
          generatedAt: GENERATED_AT,
          sourceFingerprint: FINGERPRINT,
          assets: Array.from({ length: 7 }, (_, index) => cardAsset(index)),
          parseErrors: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const crossLibrary = await request(app).get(
      `/api/cards/library?limit=3&sort=updated&order=desc&cursor=${encodeURIComponent(
        first.body.pageInfo.nextCursor
      )}`
    );
    expect(crossLibrary.status).toBe(409);
    expect(crossLibrary.body.error.code).toBe("CARD_LIBRARY_CURSOR_STALE");
  });

  it("C02 bounds title/concept search and scopes results to the active library", async () => {
    const { app, context } = await setup([
      cardAsset(1, { title: "Compactness theorem", concept: "Topology" }),
      cardAsset(2, { title: "Chain rule", concept: "Calculus" })
    ]);

    const search = await request(app).get(
      "/api/cards/library?query=compactness&limit=20"
    );
    expect(search.status).toBe(200);
    expect(search.body.cards.map((card: { title: string }) => card.title)).toEqual([
      "Compactness theorem"
    ]);

    const oversized = await request(app).get(
      `/api/cards/library?query=${"x".repeat(121)}`
    );
    expect(oversized.status).toBe(422);

    const secondVault = context.path("SecondVault");
    expect(
      (
        await request(app)
          .post("/api/vault/initialize")
          .send({ path: secondVault })
      ).status
    ).toBe(200);
    await writeFile(
      join(secondVault, ".aleksi", "index.json"),
      `${JSON.stringify(
        {
          generatedAt: GENERATED_AT,
          sourceFingerprint: "b".repeat(64),
          assets: [
            cardAsset(3, {
              title: "Compactness in the second library",
              concept: "Topology"
            })
          ],
          parseErrors: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const switched = await request(app).get(
      "/api/cards/library?query=compactness&limit=20"
    );
    expect(
      switched.body.cards.map((card: { title: string }) => card.title)
    ).toEqual(["Compactness in the second library"]);
  });

  it("C03 combines type, mastery, and due filters", async () => {
    const { app } = await setup([
      cardAsset(1),
      cardAsset(2, {
        assetType: "example",
        mastery: "due",
        nextReview: "2026-07-28"
      }),
      cardAsset(3, {
        assetType: "definition",
        mastery: "due",
        nextReview: "2026-07-28"
      }),
      cardAsset(4, {
        assetType: "definition",
        mastery: "mastered",
        nextReview: "2026-08-04"
      })
    ]);

    const response = await request(app).get(
      "/api/cards/library?type=definition&mastery=due&due=overdue&limit=20"
    );
    expect(response.status).toBe(200);
    expect(response.body.cards).toHaveLength(1);
    expect(response.body.cards[0]).toMatchObject({
      type: "definition",
      mastery: "due",
      nextReview: "2026-07-28"
    });
  });

  it("C03 supports updated, created, title, and due ordering", async () => {
    const { app } = await setup([
      cardAsset(1, {
        title: "Gamma",
        createdAt: "2026-06-03T08:00:00.000Z",
        updatedAt: "2026-07-01T09:00:00.000Z",
        nextReview: "2026-08-02"
      }),
      cardAsset(2, {
        title: "Alpha",
        createdAt: "2026-06-01T08:00:00.000Z",
        updatedAt: "2026-07-03T09:00:00.000Z",
        nextReview: "2026-08-01"
      }),
      cardAsset(3, {
        title: "Beta",
        createdAt: "2026-06-02T08:00:00.000Z",
        updatedAt: "2026-07-02T09:00:00.000Z",
        nextReview: "2026-08-03"
      })
    ]);
    const cases = [
      ["updated", "desc", ["Alpha", "Beta", "Gamma"]],
      ["created", "asc", ["Alpha", "Beta", "Gamma"]],
      ["title", "asc", ["Alpha", "Beta", "Gamma"]],
      ["due", "desc", ["Beta", "Gamma", "Alpha"]]
    ] as const;

    for (const [sort, order, expected] of cases) {
      const response = await request(app).get(
        `/api/cards/library?sort=${sort}&order=${order}&limit=20`
      );
      expect(response.status).toBe(200);
      expect(
        response.body.cards.map((card: { title: string }) => card.title)
      ).toEqual(expected);
    }
  });

  it("C04 exposes degraded recovery without hiding valid indexed cards", async () => {
    const { app, vaultPath } = await setup(
      [cardAsset(1, { title: "Still available" })],
      [
        {
          relativePath: "02-定义卡/broken.md",
          code: "FRONTMATTER_PARSE_ERROR",
          message: "broken frontmatter"
        }
      ]
    );

    const partial = await request(app).get("/api/cards/library");
    expect(partial.status).toBe(200);
    expect(partial.body.degraded).toMatchObject({
      active: true,
      recoveryAction: "rebuild-index"
    });
    expect(partial.body.cards[0].title).toBe("Still available");

    await recordProjectionFailureHealth(
      vaultPath,
      "index",
      "44444444-4444-4444-8444-444444444444",
      Object.assign(new Error("rebuild failed"), {
        code: "INDEX_SCAN_DEADLINE_EXCEEDED"
      })
    );
    const staleHealth = await request(app).get("/api/cards/library");
    expect(staleHealth.status).toBe(200);
    expect(staleHealth.body.cards[0].title).toBe("Still available");
    expect(staleHealth.body.degraded).toMatchObject({
      active: true,
      recoveryAction: "rebuild-index"
    });

    await writeFile(
      join(vaultPath, ".aleksi", "index.json"),
      "{\"invalid\":true}\n",
      "utf8"
    );
    const corrupt = await request(app).get("/api/cards/library");
    expect(corrupt.status).toBe(200);
    expect(corrupt.body).toMatchObject({
      cards: [],
      degraded: {
        active: true,
        recoveryAction: "rebuild-index"
      }
    });
  });

  it("rejects a cursor reused with different filters", async () => {
    const { app } = await setup(
      Array.from({ length: 4 }, (_, index) => cardAsset(index))
    );
    const first = await request(app).get(
      "/api/cards/library?limit=2&type=definition"
    );
    const mismatch = await request(app).get(
      `/api/cards/library?limit=2&type=example&cursor=${encodeURIComponent(
        first.body.pageInfo.nextCursor
      )}`
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("CARD_LIBRARY_CURSOR_STALE");
  });

  it("rejects a due-sensitive cursor after the UTC calculation date changes", () => {
    const index: IndexDocument = {
      generatedAt: GENERATED_AT,
      sourceFingerprint: FINGERPRINT,
      assets: Array.from({ length: 4 }, (_, item) => cardAsset(item)),
      parseErrors: []
    };
    const query = {
      due: "overdue",
      limit: 2,
      order: "asc",
      sort: "due"
    } as const;
    const first = queryCardLibraryIndex(index, query, "2026-07-29");

    expect(() =>
      queryCardLibraryIndex(
        index,
        { ...query, cursor: first.pageInfo.nextCursor ?? undefined },
        "2026-07-30"
      )
    ).toThrow(CardLibraryServiceError);
  });

  it("marks legacy created-time ordering degraded until a rebuild fills metadata", async () => {
    const legacy: Partial<CardAsset> = cardAsset(1);
    delete legacy.createdAt;
    const { app } = await setup([legacy as CardAsset]);
    const response = await request(app).get(
      "/api/cards/library?sort=created&order=asc"
    );

    expect(response.status).toBe(200);
    expect(response.body.cards).toHaveLength(1);
    expect(response.body.degraded).toMatchObject({
      active: true,
      recoveryAction: "rebuild-index"
    });
  });
});
