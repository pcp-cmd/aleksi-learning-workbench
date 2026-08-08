import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_TYPES,
  LEGACY_CARD_TYPES,
  PRIMARY_CARD_TYPES
} from "../../shared/card-types";
import { CARD_LABELS } from "../../shared/card-labels";
import {
  CARD_DIRECTORIES,
  COMPATIBLE_SCAN_DIRECTORIES,
  DEFAULT_VAULT_DIRECTORIES,
  GRAPH_DIRECTORY,
  LEGACY_CARD_DIRECTORIES,
  LEGACY_REVIEW_DIRECTORY,
  PRIMARY_CARD_DIRECTORIES
} from "../../shared/vault-map";

describe("shared card and vault maps", () => {
  it("defines the V0.2 five-card system and legacy compatibility types once", () => {
    expect(PRIMARY_CARD_TYPES).toEqual([
      "concept",
      "example",
      "boundary",
      "process",
      "mistake"
    ]);
    expect(LEGACY_CARD_TYPES).toEqual([
      "definition",
      "counterexample",
      "proof"
    ]);
    expect(CARD_TYPES).toEqual([
      ...PRIMARY_CARD_TYPES,
      ...LEGACY_CARD_TYPES
    ]);
  });

  it("labels every card type with primary or legacy semantics", () => {
    expect(Object.keys(CARD_LABELS)).toEqual([...CARD_TYPES]);
    for (const type of PRIMARY_CARD_TYPES) {
      expect(CARD_LABELS[type]).toMatchObject({
        isPrimary: true,
        isLegacy: false
      });
    }
    for (const type of LEGACY_CARD_TYPES) {
      expect(CARD_LABELS[type]).toMatchObject({
        isPrimary: false,
        isLegacy: true
      });
    }
  });

  it("creates only V0.2 default Vault directories while keeping legacy scan dirs", () => {
    expect(PRIMARY_CARD_DIRECTORIES).toEqual({
      concept: "\u0030\u0032-\u6982\u5ff5\u5361",
      example: "\u0030\u0033-\u4f8b\u5b50\u5361",
      boundary: "\u0030\u0034-\u8fb9\u754c\u5361",
      process: "\u0030\u0035-\u6d41\u7a0b\u5361",
      mistake: "\u0030\u0036-\u9519\u8bef\u5361"
    });
    expect(LEGACY_CARD_DIRECTORIES).toEqual({
      definition: "\u0030\u0032-\u5b9a\u4e49\u5361",
      counterexample: "\u0030\u0034-\u53cd\u4f8b\u5361",
      proof: "\u0030\u0035-\u8bc1\u660e\u5361"
    });
    expect(CARD_DIRECTORIES).toEqual({
      ...PRIMARY_CARD_DIRECTORIES,
      ...LEGACY_CARD_DIRECTORIES
    });
    expect(DEFAULT_VAULT_DIRECTORIES).toEqual([
      "\u0030\u0031-\u9605\u8bfb\u6750\u6599",
      "\u0030\u0032-\u6982\u5ff5\u5361",
      "\u0030\u0033-\u4f8b\u5b50\u5361",
      "\u0030\u0034-\u8fb9\u754c\u5361",
      "\u0030\u0035-\u6d41\u7a0b\u5361",
      "\u0030\u0036-\u9519\u8bef\u5361",
      "\u0030\u0037-\u5361\u70b9\u8bca\u65ad",
      "\u0030\u0038-\u590d\u4e60\u8bb0\u5f55",
      "\u0031\u0030-Codex\u4efb\u52a1",
      "\u0039\u0039-\u5f52\u6863",
      ".aleksi"
    ]);
    expect(DEFAULT_VAULT_DIRECTORIES).not.toContain(GRAPH_DIRECTORY);
    expect(DEFAULT_VAULT_DIRECTORIES).not.toContain(LEGACY_REVIEW_DIRECTORY);
    expect(
      COMPATIBLE_SCAN_DIRECTORIES.find(
        (directory) => directory.relativePath === LEGACY_REVIEW_DIRECTORY
      )
    ).toMatchObject({ assetType: "review" });
    for (const legacyDirectory of Object.values(LEGACY_CARD_DIRECTORIES)) {
      expect(DEFAULT_VAULT_DIRECTORIES).not.toContain(legacyDirectory);
      expect(
        COMPATIBLE_SCAN_DIRECTORIES.some(
          (directory) => directory.relativePath === legacyDirectory
        )
      ).toBe(true);
    }
  });

  it("routes app, server, and tests through shared single-source modules", async () => {
    const files = {
      schemas: await readFile(
        join(process.cwd(), "server/domain/schemas.ts"),
        "utf8"
      ),
      vaultService: await readFile(
        join(process.cwd(), "server/services/vault-service.ts"),
        "utf8"
      ),
      cardService: await readFile(
        join(process.cwd(), "server/services/card-service.ts"),
        "utf8"
      ),
      indexService: await readFile(
        join(process.cwd(), "server/services/index-service.ts"),
        "utf8"
      ),
      reviewService: await readFile(
        join(process.cwd(), "server/services/review-service.ts"),
        "utf8"
      ),
      diagnosisService: await readFile(
        join(process.cwd(), "server/services/diagnosis-service.ts"),
        "utf8"
      ),
      graphService: await readFile(
        join(process.cwd(), "server/services/graph-service.ts"),
        "utf8"
      ),
      cardStudio: await readFile(
        join(process.cwd(), "src/features/cards/CardStudioPage.tsx"),
        "utf8"
      ),
      cardEditor: await readFile(
        join(process.cwd(), "src/features/cards/CardEditor.tsx"),
        "utf8"
      ),
      diagnosisPage: await readFile(
        join(process.cwd(), "src/features/diagnosis/DiagnosisPage.tsx"),
        "utf8"
      ),
      reviewPage: await readFile(
        join(process.cwd(), "src/features/review/ReviewPage.tsx"),
        "utf8"
      ),
      reviewSteps: await readFile(
        join(process.cwd(), "src/features/review/ReviewSessionSteps.tsx"),
        "utf8"
      )
    };

    expect(files.schemas).toContain("../../shared/card-types");
    expect(files.vaultService).toContain("../../shared/vault-map");
    expect(files.cardService).toContain("../../shared/vault-map");
    expect(files.indexService).toContain("../../shared/vault-map");
    expect(files.reviewService).toContain("../../shared/card-types");
    expect(files.reviewService).toContain("../../shared/card-labels");
    expect(files.reviewService).not.toContain("const CARD_TYPES = [");
    expect(files.reviewService).not.toContain("const CARD_TYPE_LABELS");
    expect(files.diagnosisService).toContain("../../shared/card-labels");
    expect(files.diagnosisService).not.toContain("const CARD_TYPE_LABELS");
    expect(files.graphService).toContain("../../shared/card-types");
    expect(files.graphService).not.toContain(
      'const GRAPH_CARD_TYPES = ["concept"'
    );
    expect(files.graphService).not.toContain("const GRAPH_SOURCE_CARD_TYPES = [");
    expect(files.cardStudio).toContain("createEmptyCardDraft(\"concept\")");
    expect(files.cardStudio).not.toContain("createEmptyCardDraft(\"definition\")");
    expect(files.cardEditor).toContain("../../shared/card-labels");
    expect(files.diagnosisPage).toContain("../../../shared/card-labels");
    expect(files.diagnosisPage).toContain("../../../shared/card-types");
    expect(files.diagnosisPage).not.toContain("const CARD_TYPES: Array");
    expect(files.reviewSteps).toContain("../../../shared/card-labels");
    expect(files.reviewPage).not.toContain("const CARD_TYPE_LABELS");
  });
});
