import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { VERIFICATION_DIRECTORY } from "../../shared/vault-map";
import { createTempVaultContext } from "../temp-vault";

async function setup() {
  const context = await createTempVaultContext();
  const vaultPath = context.path("Vault");
  const app = createApp();
  expect(
    (await request(app).post("/api/vault/initialize").send({ path: vaultPath }))
      .status
  ).toBe(200);
  const reading = await request(app).post("/api/readings").send({
    title: "三角形数材料",
    concept: "数学归纳法",
    body: "证明 1+2+...+n=n(n+1)/2。",
    source: "manual-paste"
  });
  const card = await request(app).post("/api/cards").send({
    type: "concept",
    title: "归纳法结构",
    concept: "数学归纳法",
    relatedConcepts: [],
    sourceReadingId: reading.body.reading.id,
    excerpt: "证明三角形数公式。",
    understanding: "先验证基例，再从 n 推到 n+1。",
    blockType: "proof-search",
    nextAction: "闭卷写一遍归纳步骤。",
    formalExplanation: "归纳法由基例与归纳步骤构成。",
    myUnderstanding: "假设 n 成立，再证明 n+1。",
    commonMisunderstanding: "把归纳假设当成结论。",
    usageContext: "自然数命题。"
  });
  expect(card.status).toBe(200);
  return { app, vaultPath, cardId: card.body.card.id as string, readingId: reading.body.reading.id as string, readingPath: reading.body.reading.relativePath as string };
}

async function createAdditionalCard(
  app: ReturnType<typeof createApp>,
  readingId: string,
  suffix: string
): Promise<string> {
  const response = await request(app).post("/api/cards").send({
    type: "concept",
    title: `归纳法结构 ${suffix}`,
    concept: `数学归纳法 ${suffix}`,
    relatedConcepts: [],
    sourceReadingId: readingId,
    excerpt: `证明三角形数公式 ${suffix}。`,
    understanding: "先验证基例，再完成归纳步骤。",
    blockType: "proof-search",
    nextAction: "闭卷复述证明结构。",
    formalExplanation: "归纳法由基例与归纳步骤构成。",
    myUnderstanding: "假设 n 成立，再证明 n+1。",
    commonMisunderstanding: "把归纳假设当成结论。",
    usageContext: "自然数命题。"
  });
  expect(response.status).toBe(200);
  return response.body.card.id as string;
}

function candidateBody(cardId: string, assistanceLevel = "none") {
  return {
    cardId,
    statement: "对每个正整数 n，1+2+...+n=n(n+1)/2。",
    proofAttempt:
      "当 n=1 时成立。假设 n 时成立，则加上 n+1 得到 (n+1)(n+2)/2，所以 n+1 时成立。",
    predecessorIds: [],
    assistanceLevel
  };
}

const correctVerdict = {
  verifierKind: "ai-review",
  verificationReport: {
    summary: "基例和归纳步骤均完整。",
    criticalErrors: [],
    gaps: []
  },
  verdict: "correct",
  repairHints: ""
};

describe("evidence verification API", () => {
  it("stores immutable content-addressed candidate and verdict records", async () => {
    const { app, vaultPath, cardId } = await setup();
    const first = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.candidate.id).toMatch(/^evidence-[0-9a-f]{64}$/u);
    expect(first.body.candidate.status).toBe("awaiting-verification");
    expect(first.body.candidate.verificationPrompt).toContain(
      "not a formal proof certificate"
    );

    const replay = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.candidate.id).toBe(first.body.candidate.id);

    const verdict = await request(app)
      .post(`/api/verification/candidates/${first.body.candidate.id}/verdict`)
      .send(correctVerdict);
    expect(verdict.status).toBe(201);
    expect(verdict.body.candidate).toMatchObject({
      status: "accepted",
      evidenceQuality: "independent",
      qualifiesForMastery: false
    });
    expect(verdict.body.verdict.id).toMatch(/^verdict-[0-9a-f]{64}$/u);

    const directory = join(vaultPath, ...VERIFICATION_DIRECTORY.split("/"));
    const files = (await readdir(directory)).sort();
    expect(files).toHaveLength(2);
    expect(files.some((file) => /^evidence-.+\.md$/u.test(file))).toBe(true);
    expect(files.some((file) => /^verdict-.+\.md$/u.test(file))).toBe(true);
    const candidateRaw = await readFile(
      join(directory, `${first.body.candidate.id}.md`),
      "utf8"
    );
    expect(candidateRaw).toContain("对每个正整数 n");
    expect(candidateRaw).toContain("学习者证明或论证");
  }, 15_000);

  it("rejects inconsistent verdicts and a second different immutable verdict", async () => {
    const { app, cardId } = await setup();
    const candidate = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const id = candidate.body.candidate.id as string;

    const inconsistent = await request(app)
      .post(`/api/verification/candidates/${id}/verdict`)
      .send({
        ...correctVerdict,
        verificationReport: {
          summary: "缺一步。",
          criticalErrors: [],
          gaps: [{ location: "归纳步骤", issue: "没有展开代数化简。" }]
        }
      });
    expect(inconsistent.status).toBe(422);
    expect(inconsistent.body.error.code).toBe("INVALID_REQUEST_BODY");

    expect(
      (
        await request(app)
          .post(`/api/verification/candidates/${id}/verdict`)
          .send(correctVerdict)
      ).status
    ).toBe(201);
    const conflicting = await request(app)
      .post(`/api/verification/candidates/${id}/verdict`)
      .send({
        verifierKind: "human-review",
        verificationReport: {
          summary: "发现缺口。",
          criticalErrors: [],
          gaps: [{ location: "结尾", issue: "没有明确使用归纳原理。" }]
        },
        verdict: "wrong",
        repairHints: "补充归纳原理的收束句。"
      });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe(
      "EVIDENCE_VERDICT_ALREADY_RECORDED"
    );
  });

  it("requires accepted predecessors and keeps assisted acceptance non-mastering", async () => {
    const { app, cardId } = await setup();
    const pending = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const blocked = await request(app)
      .post("/api/verification/candidates")
      .send({
        ...candidateBody(cardId, "hint"),
        statement: "由前一结论可推出一个推论。",
        predecessorIds: [pending.body.candidate.id]
      });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("EVIDENCE_PREDECESSOR_NOT_ACCEPTED");

    await request(app)
      .post(`/api/verification/candidates/${pending.body.candidate.id}/verdict`)
      .send(correctVerdict);
    const assisted = await request(app)
      .post("/api/verification/candidates")
      .send({
        ...candidateBody(cardId, "hint"),
        statement: "由前一结论可推出一个推论。",
        predecessorIds: [pending.body.candidate.id]
      });
    expect(assisted.status).toBe(201);
    const accepted = await request(app)
      .post(`/api/verification/candidates/${assisted.body.candidate.id}/verdict`)
      .send(correctVerdict);
    expect(accepted.body.candidate).toMatchObject({
      status: "accepted",
      evidenceQuality: "assisted",
      qualifiesForMastery: false
    });
  });

  it("freezes card and reading context without mutating the source card", async () => {
    const { app, vaultPath, cardId, readingPath, readingId } = await setup();
    const card = await request(app).get(`/api/cards/${cardId}`);
    const cardPath = join(vaultPath, ...card.body.card.relativePath.split("/"));
    const before = await readFile(cardPath, "utf8");

    const created = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await readFile(cardPath, "utf8")).toBe(before);
    expect(created.body.candidate.contextSnapshot).toMatchObject({
      cardRevision: 1,
      cardSnapshotSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      sourceSnapshots: [
        {
          readingId,
          relativePath: readingPath,
          snapshotSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
          excerpt: "证明三角形数公式。",
          locator: null
        }
      ]
    });

    const updated = await request(app).put(`/api/cards/${cardId}`).send({
      expectedVersion: card.body.card.version,
      title: "归纳法结构（修订）",
      concept: "数学归纳法",
      relatedConcepts: [],
      sourceReadingId: readingId,
      excerpt: "修订后的摘录。",
      understanding: "修订后的理解。",
      blockType: "proof-search",
      nextAction: "再写一次。",
      mastery: "learning",
      formalExplanation: "修订后的形式说明。",
      myUnderstanding: "修订后的个人理解。",
      commonMisunderstanding: "仍需区分假设和结论。",
      usageContext: "自然数命题。"
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);

    const historical = await request(app).get(
      `/api/verification/candidates/${created.body.candidate.id}`
    );
    expect(historical.body.candidate.contextSnapshot.cardRevision).toBe(1);
    expect(historical.body.candidate.contextSnapshot.sourceSnapshots[0].excerpt).toBe(
      "证明三角形数公式。"
    );
    expect(historical.body.candidate.title).not.toContain("修订");
  });

  it("projects accepted trust independently from card mastery", async () => {
    const { app, cardId } = await setup();
    const before = await request(app).get(`/api/cards/${cardId}`);
    const created = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const accepted = await request(app)
      .post(`/api/verification/candidates/${created.body.candidate.id}/verdict`)
      .send(correctVerdict);
    expect(accepted.status).toBe(201);

    const knowledge = await request(app).get(
      `/api/verification/knowledge/${cardId}`
    );
    expect(knowledge.status, JSON.stringify(knowledge.body)).toBe(200);
    expect(knowledge.body.knowledge).toMatchObject({
      cardId,
      trustState: "independently-supported",
      activeEvidenceIds: [created.body.candidate.id],
      affectedEvidenceIds: [],
      prerequisites: [],
      usedBy: []
    });
    const card = await request(app).get(`/api/cards/${cardId}`);
    expect(card.body.card.mastery).toBe("learning");
    expect(card.body.card.nextReview).toBe(before.body.card.nextReview);
  });

  it("records typed relations and propagates revocation through all descendants", async () => {
    const { app, vaultPath, cardId, readingId } = await setup();
    const middleCardId = await createAdditionalCard(app, readingId, "推论");
    const leafCardId = await createAdditionalCard(app, readingId, "应用");

    const root = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    await request(app)
      .post(`/api/verification/candidates/${root.body.candidate.id}/verdict`)
      .send(correctVerdict);

    const middle = await request(app)
      .post("/api/verification/candidates")
      .send({
        ...candidateBody(middleCardId),
        statement: "三角形数公式给出连续整数求和。",
        predecessorIds: [root.body.candidate.id],
        relations: [
          { targetEvidenceId: root.body.candidate.id, type: "requires" }
        ]
      });
    expect(middle.status, JSON.stringify(middle.body)).toBe(201);
    await request(app)
      .post(`/api/verification/candidates/${middle.body.candidate.id}/verdict`)
      .send(correctVerdict);

    const leaf = await request(app)
      .post("/api/verification/candidates")
      .send({
        ...candidateBody(leafCardId),
        statement: "连续整数求和可以用于组合计数。",
        predecessorIds: [middle.body.candidate.id],
        relations: [
          {
            targetEvidenceId: middle.body.candidate.id,
            type: "illustrates"
          }
        ]
      });
    expect(leaf.status, JSON.stringify(leaf.body)).toBe(201);
    await request(app)
      .post(`/api/verification/candidates/${leaf.body.candidate.id}/verdict`)
      .send(correctVerdict);

    const middleKnowledge = await request(app).get(
      `/api/verification/knowledge/${middleCardId}`
    );
    expect(middleKnowledge.body.knowledge.prerequisites).toEqual([
      {
        cardId,
        evidenceId: root.body.candidate.id,
        relationType: "requires"
      }
    ]);
    const rootKnowledge = await request(app).get(
      `/api/verification/knowledge/${cardId}`
    );
    expect(rootKnowledge.body.knowledge.usedBy).toEqual([
      {
        cardId: middleCardId,
        evidenceId: middle.body.candidate.id,
        relationType: "requires"
      }
    ]);

    const revoked = await request(app)
      .post(`/api/verification/candidates/${root.body.candidate.id}/revoke`)
      .send({ reason: "上游证明的基例使用了错误定义。", confirmed: true });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(201);
    expect(
      revoked.body.revocation.impacts.map(
        (impact: { evidenceId: string }) => impact.evidenceId
      )
    ).toEqual([
      root.body.candidate.id,
      middle.body.candidate.id,
      leaf.body.candidate.id
    ]);

    expect(
      (await request(app).get(`/api/verification/candidates/${root.body.candidate.id}`))
        .body.candidate.status
    ).toBe("revoked");
    expect(
      (await request(app).get(`/api/verification/candidates/${middle.body.candidate.id}`))
        .body.candidate.status
    ).toBe("affected");
    expect(
      (await request(app).get(`/api/verification/candidates/${leaf.body.candidate.id}`))
        .body.candidate.status
    ).toBe("affected");

    const leafKnowledge = await request(app).get(
      `/api/verification/knowledge/${leafCardId}`
    );
    expect(leafKnowledge.body.knowledge).toMatchObject({
      trustState: "under-review",
      activeEvidenceIds: [],
      affectedEvidenceIds: [leaf.body.candidate.id]
    });
    expect(leafKnowledge.body.knowledge.revocationImpacts[0]).toMatchObject({
      rootEvidenceId: root.body.candidate.id,
      evidenceId: leaf.body.candidate.id,
      upstreamEvidenceId: middle.body.candidate.id,
      path: [
        root.body.candidate.id,
        middle.body.candidate.id,
        leaf.body.candidate.id
      ]
    });

    const directory = join(vaultPath, ...VERIFICATION_DIRECTORY.split("/"));
    const files = await readdir(directory);
    expect(files.filter((file) => file.startsWith("evidence-"))).toHaveLength(3);
    expect(files.filter((file) => file.startsWith("verdict-"))).toHaveLength(3);
    expect(files.filter((file) => file.startsWith("revocation-"))).toHaveLength(1);
  });

  it("requires explicit confirmation for GPT Plus verdict imports", async () => {
    const { app, cardId } = await setup();
    const created = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const imported = {
      ...correctVerdict,
      verifierKind: "gpt-plus-import",
      confirmed: false
    };

    const unconfirmed = await request(app)
      .post(`/api/verification/candidates/${created.body.candidate.id}/verdict`)
      .send(imported);
    expect(unconfirmed.status).toBe(422);

    const confirmed = await request(app)
      .post(`/api/verification/candidates/${created.body.candidate.id}/verdict`)
      .send({ ...imported, confirmed: true });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
    expect(confirmed.body.verdict).toMatchObject({
      verifierKind: "gpt-plus-import",
      confirmedByUser: true,
      formalProof: false
    });
  });

  it("does not quarantine a live atomic-write artifact during a ledger scan", async () => {
    const { app, vaultPath, cardId } = await setup();
    const candidate = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const candidateId = candidate.body.candidate.id as string;
    const directory = join(vaultPath, ...VERIFICATION_DIRECTORY.split("/"));
    const verdictFilename = `${candidateId.replace(/^evidence-/u, "verdict-")}.md`;
    const atomicArtifact = `.${verdictFilename}.${process.pid}.${"a".repeat(24)}.tmp`;
    await writeFile(join(directory, atomicArtifact), "write in progress", "utf8");

    const response = await request(app).get("/api/verification/candidates");

    expect(response.status).toBe(200);
    expect(response.body.diagnostics).toEqual([]);
    expect(await readdir(directory)).toContain(atomicArtifact);
  });

  it("allows exactly one verdict file when different verdicts race", async () => {
    const { app, vaultPath, cardId } = await setup();
    const candidate = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const id = candidate.body.candidate.id as string;
    const wrongVerdict = {
      verifierKind: "human-review",
      verificationReport: {
        summary: "收束句不完整。",
        criticalErrors: [],
        gaps: [{ location: "结尾", issue: "没有写出归纳结论。" }]
      },
      verdict: "wrong",
      repairHints: "补上归纳原理的最终收束。"
    };
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        request(app)
          .post(`/api/verification/candidates/${id}/verdict`)
          .send(index % 2 === 0 ? correctVerdict : wrongVerdict)
      )
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const unexpectedResponses = responses
      .filter((response) => ![200, 201, 409].includes(response.status))
      .map((response) => ({ status: response.status, body: response.body }));
    expect(
      unexpectedResponses,
      JSON.stringify(unexpectedResponses)
    ).toEqual([]);
    const directory = join(vaultPath, ...VERIFICATION_DIRECTORY.split("/"));
    expect(
      (await readdir(directory)).filter((file) => file.startsWith("verdict-"))
    ).toHaveLength(1);
    const detail = await request(app).get(`/api/verification/candidates/${id}`);
    expect(["accepted", "repair-needed"]).toContain(detail.body.candidate.status);
  });

  it("lists records and rejects malformed or server-owned input", async () => {
    const { app, cardId } = await setup();
    const emptyList = await request(app).get("/api/verification/candidates");
    expect(emptyList.status).toBe(200);
    expect(emptyList.body.candidates).toEqual([]);
    const invalid = await request(app)
      .post("/api/verification/candidates")
      .send({ ...candidateBody(cardId), id: "evidence-client" });
    expect(invalid.status).toBe(422);

    const created = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const list = await request(app).get("/api/verification/candidates");
    expect(list.status).toBe(200);
    expect(list.body.candidates).toHaveLength(1);
    expect(list.body.candidates[0].id).toBe(created.body.candidate.id);
    expect(
      (await request(app).get("/api/verification/candidates/not-an-id")).status
    ).toBe(422);
  });

  it("rejects candidate or verdict Markdown whose content no longer matches its hash", async () => {
    const first = await setup();
    const created = await request(first.app)
      .post("/api/verification/candidates")
      .send(candidateBody(first.cardId));
    const candidateId = created.body.candidate.id as string;
    await request(first.app)
      .post(`/api/verification/candidates/${candidateId}/verdict`)
      .send(correctVerdict);
    const directory = join(
      first.vaultPath,
      ...VERIFICATION_DIRECTORY.split("/")
    );
    const candidatePath = join(directory, `${candidateId}.md`);
    const candidateRaw = await readFile(candidatePath, "utf8");
    await writeFile(
      candidatePath,
      candidateRaw.replace(
        /^proofAttempt: .+$/mu,
        'proofAttempt: "这份论证已被手工篡改。"'
      ),
      "utf8"
    );
    const tamperedCandidate = await request(first.app).get(
      `/api/verification/candidates/${candidateId}`
    );
    expect(tamperedCandidate.status).toBe(409);
    expect(tamperedCandidate.body.error.code).toBe("INVALID_EVIDENCE_FILE");

    const second = await setup();
    const secondCandidate = await request(second.app)
      .post("/api/verification/candidates")
      .send(candidateBody(second.cardId));
    const secondId = secondCandidate.body.candidate.id as string;
    await request(second.app)
      .post(`/api/verification/candidates/${secondId}/verdict`)
      .send(correctVerdict);
    const secondDirectory = join(
      second.vaultPath,
      ...VERIFICATION_DIRECTORY.split("/")
    );
    const verdictPath = join(
      secondDirectory,
      `${secondId.replace(/^evidence-/u, "verdict-")}.md`
    );
    const verdictRaw = await readFile(verdictPath, "utf8");
    await writeFile(
      verdictPath,
      verdictRaw.replace(
        '"summary":"基例和归纳步骤均完整。"',
        '"summary":"这条摘要已被手工篡改。"'
      ),
      "utf8"
    );
    const ledgerAfterTamper = await request(second.app).get(
      "/api/verification/candidates"
    );
    expect(ledgerAfterTamper.status).toBe(200);
    expect(ledgerAfterTamper.body.diagnostics).toEqual([
      expect.objectContaining({
        errorId: expect.any(String),
        file: `${secondId.replace(/^evidence-/u, "verdict-")}.md`
      })
    ]);
    expect(ledgerAfterTamper.body.candidates).toEqual([
      expect.objectContaining({
        id: secondId,
        status: "awaiting-verification",
        verdict: null
      })
    ]);
  });

  it("does not quarantine a bounded-read failure as corrupt evidence", async () => {
    const { app, vaultPath, cardId } = await setup();
    const created = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const candidateId = created.body.candidate.id as string;
    const directory = join(
      vaultPath,
      ...VERIFICATION_DIRECTORY.split("/")
    );
    const filename = `${candidateId}.md`;
    await writeFile(
      join(directory, filename),
      Buffer.alloc(1024 * 1024 + 1, 0x78)
    );

    const response = await request(app).get("/api/verification/candidates");
    expect(response.status).toBe(500);
    expect(await readdir(directory)).toContain(filename);
    expect(
      (await readdir(directory)).some((entry) =>
        entry.startsWith(`${filename}.corrupt-`)
      )
    ).toBe(false);
  });

  it("diagnoses and moves malformed verification filenames outside the active ledger", async () => {
    const { app, vaultPath, cardId } = await setup();
    await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const directory = join(
      vaultPath,
      ...VERIFICATION_DIRECTORY.split("/")
    );
    await writeFile(join(directory, "malformed-name.md"), "invalid", "utf8");

    const response = await request(app).get("/api/verification/candidates");

    expect(response.status).toBe(200);
    expect(response.body.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "malformed-name.md" })
      ])
    );
    expect(await readdir(directory)).not.toContain("malformed-name.md");
    const quarantine = join(
      vaultPath,
      ".aleksi",
      "quarantine",
      "verification"
    );
    expect((await readdir(quarantine)).length).toBeGreaterThan(0);
  });

  it("rejects whitespace-only candidate and report content", async () => {
    const { app, cardId } = await setup();
    const candidate = await request(app)
      .post("/api/verification/candidates")
      .send({ ...candidateBody(cardId), statement: "   " });
    expect(candidate.status).toBe(422);

    const valid = await request(app)
      .post("/api/verification/candidates")
      .send(candidateBody(cardId));
    const verdict = await request(app)
      .post(`/api/verification/candidates/${valid.body.candidate.id}/verdict`)
      .send({ ...correctVerdict, verificationReport: { ...correctVerdict.verificationReport, summary: "   " } });
    expect(verdict.status).toBe(422);
  });
});
