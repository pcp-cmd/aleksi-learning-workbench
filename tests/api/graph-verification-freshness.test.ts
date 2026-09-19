import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createTempVaultContext } from "../temp-vault";

const correctVerdict = {
  verifierKind: "ai-review",
  verificationReport: {
    summary: "The argument is complete.",
    criticalErrors: [],
    gaps: []
  },
  verdict: "correct",
  repairHints: ""
};

describe("graph verification freshness", () => {
  it("does not reuse a graph cache after verification evidence changes", async () => {
    const context = await createTempVaultContext();
    const root = context.path("Vault");
    const app = createApp();

    expect(
      (await request(app).post("/api/vault/initialize").send({ path: root }))
        .status
    ).toBe(200);

    const reading = await request(app).post("/api/readings").send({
      title: "Verification freshness reading",
      concept: "Verification freshness",
      body: "A graph ring reflects the current verification trust state.",
      source: "manual-paste"
    });
    expect(reading.status).toBe(200);

    const card = await request(app).post("/api/cards").send({
      type: "concept",
      title: "Verification freshness concept",
      concept: "Verification freshness",
      relatedConcepts: [],
      sourceReadingId: reading.body.reading.id,
      excerpt: "Graph trust must change with accepted evidence.",
      understanding: "Verification is a graph dependency.",
      blockType: "technical",
      nextAction: "Check the graph after evidence changes.",
      formalExplanation: "Graph evidence confidence is derived from verification state.",
      myUnderstanding: "The graph cache is stale if evidence changes behind it.",
      commonMisunderstanding: "Index freshness alone is enough for graph freshness.",
      usageContext: "After creating or reviewing verification evidence."
    });
    expect(card.status, JSON.stringify(card.body)).toBe(200);
    const cardId = card.body.card.id as string;

    const before = await request(app).get("/api/graph/state");
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(
      before.body.concepts["Verification freshness"].rings.concept.evidenceConfidence
    ).toBe("unverified");

    const candidate = await request(app)
      .post("/api/verification/candidates")
      .send({
        cardId,
        statement: "Graph confidence must include accepted verification evidence.",
        proofAttempt: "The graph reads knowledge projection state for each active card.",
        predecessorIds: [],
        assistanceLevel: "none"
      });
    expect(candidate.status, JSON.stringify(candidate.body)).toBe(201);

    const verdict = await request(app)
      .post(`/api/verification/candidates/${candidate.body.candidate.id}/verdict`)
      .send(correctVerdict);
    expect(verdict.status, JSON.stringify(verdict.body)).toBe(201);

    const after = await request(app).get("/api/graph/state");
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(
      after.body.concepts["Verification freshness"].rings.concept.evidenceConfidence
    ).toBe("independently-supported");
    expect(after.body.sourceIndexFingerprint).not.toBe(
      before.body.sourceIndexFingerprint
    );
  }, 15_000);
});
