import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import {
  parseCardMarkdown,
  serializeCardMarkdown
} from "../../server/lib/markdown-codec";
import { createTempVaultContext } from "../temp-vault";

function vaultPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

describe("card index freshness", () => {
  it("rebuilds a structurally valid but stale index before card reads", async () => {
    const context = await createTempVaultContext();
    const root = context.path("Vault");
    const app = createApp();

    const initialized = await request(app)
      .post("/api/vault/initialize")
      .send({ path: root });
    expect(initialized.status).toBe(200);

    const reading = await request(app).post("/api/readings").send({
      title: "Freshness reading",
      concept: "Index freshness",
      body: "The authoritative Markdown may change while a projection remains cached.",
      source: "manual-paste"
    });
    expect(reading.status).toBe(200);

    const created = await request(app).post("/api/cards").send({
      type: "concept",
      title: "Freshness concept",
      concept: "Index freshness",
      relatedConcepts: [],
      sourceReadingId: reading.body.reading.id,
      excerpt: "Cached projections must not outrank source Markdown.",
      understanding: "A stale cache has to be rebuilt before card lookup.",
      blockType: "technical",
      nextAction: "Re-read through the freshness gate.",
      formalExplanation: "Projection consumers validate source freshness before use.",
      myUnderstanding: "The cache is disposable; Markdown is authoritative.",
      commonMisunderstanding: "Schema-valid JSON is not necessarily current.",
      usageContext: "After files are edited, restored, or replaced outside the app."
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);

    const oldId = created.body.card.id as string;
    const cardPath = vaultPath(root, created.body.card.relativePath as string);
    const parsed = parseCardMarkdown(await readFile(cardPath, "utf8"));
    const newId = randomUUID();
    await writeFile(
      cardPath,
      serializeCardMarkdown({ ...parsed, id: newId }),
      "utf8"
    );

    const recent = await request(app).get("/api/cards/recent?limit=10");
    expect(recent.status, JSON.stringify(recent.body)).toBe(200);
    expect(recent.body.cards).toContainEqual(
      expect.objectContaining({ id: newId, title: "Freshness concept" })
    );
    expect(
      (recent.body.cards as Array<{ id: string }>).some((card) => card.id === oldId)
    ).toBe(false);

    const current = await request(app).get(`/api/cards/${newId}`);
    expect(current.status, JSON.stringify(current.body)).toBe(200);
    expect(current.body.card.id).toBe(newId);
  });
});
