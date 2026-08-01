import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { ARCHIVE_DIRECTORY } from "../../shared/vault-map";
import { createTempVaultContext } from "../temp-vault";

describe("asset version conflicts", () => {
  it("rejects a stale card update without overwriting external bytes or rebuilding projections", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const app = createApp();
    expect(
      (await request(app).post("/api/vault/initialize").send({ path: vaultPath }))
        .status
    ).toBe(200);
    const reading = await request(app).post("/api/readings").send({
      title: "Versioned reading",
      concept: "Concurrency",
      body: "A stable source.",
      source: "manual-paste"
    });
    expect(reading.status).toBe(200);
    const created = await request(app).post("/api/cards").send({
      type: "definition",
      title: "Versioned card",
      concept: "Concurrency",
      relatedConcepts: [],
      sourceReadingId: reading.body.reading.id,
      excerpt: "A stable source.",
      understanding: "A version identifies the bytes I opened.",
      blockType: "definition",
      nextAction: "Retry after reload.",
      formalDefinition: "Compare before applying.",
      plainExplanation: "Do not overwrite someone else's edit.",
      quantifierStructure: "read then compare then write",
      commonMisunderstandings: "A timestamp alone is not enough."
    });
    expect(created.status).toBe(200);
    const relativePath = created.body.card.relativePath as string;
    const cardPath = join(vaultPath, ...relativePath.split("/"));
    const indexPath = join(vaultPath, ".aleksi", "index.json");
    const original = await readFile(cardPath, "utf8");
    const external = original.replace(
      "Do not overwrite someone else's edit.",
      "External edit must remain untouched.!"
    );
    expect(external).not.toBe(original);
    await writeFile(cardPath, external, "utf8");
    const indexBefore = await readFile(indexPath, "utf8");

    const response = await request(app)
      .put(`/api/cards/${created.body.card.id}`)
      .send({
        title: "Stale client edit",
        concept: "Concurrency",
        relatedConcepts: [],
        sourceReadingId: reading.body.reading.id,
        excerpt: "A stale source.",
        understanding: "This must not win.",
        blockType: "definition",
        nextAction: "Reload.",
        mastery: "learning",
        formalDefinition: "Stale.",
        plainExplanation: "Stale.",
        quantifierStructure: "stale",
        commonMisunderstandings: "stale",
        expectedVersion: created.body.card.version
      });

    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body).toMatchObject({
      error: {
        code: "ASSET_VERSION_CONFLICT"
      }
    });
    await expect(readFile(cardPath, "utf8")).resolves.toBe(external);
    await expect(readFile(indexPath, "utf8")).resolves.toBe(indexBefore);

    const archive = await request(app)
      .post(`/api/cards/${created.body.card.id}/archive`)
      .send({
        confirmed: true,
        expectedVersion: created.body.card.version
      });
    expect(archive.status).toBe(409);
    expect(archive.body.error.code).toBe("ASSET_VERSION_CONFLICT");
    await expect(
      readFile(
        join(
          vaultPath,
          ...`${ARCHIVE_DIRECTORY}/${relativePath}`.split("/")
        ),
        "utf8"
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
