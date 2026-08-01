import { describe, expect, it } from "vitest";
import { verifyStableEvidenceInputs } from "../../scripts/verify-stable-evidence.mjs";

const blockers = [
  "AR-P0-001",
  "AR-P0-002",
  "AR-P0-003",
  "AR-P0-004",
  "AR-P0-005",
  "AR-P0-006",
  "AR-P0-007",
  "AR-P0-008",
  "AR-P1-001",
  "AR-P1-002",
  "AR-P1-003",
  "AR-P1-004",
  "AR-P1-005",
  "AR-P1-006",
  "AR-P1-007",
  "AR-P1-008",
  "AR-P1-009",
  "AR-P1-010",
  "AR-P1-011",
  "AR-P1-012",
  "AR-P1-013"
];
const closure = blockers
  .map((blocker) => `| ${blocker} | CLOSED | evidence |`)
  .join("\n");
const identity = {
  version: "1.0.0",
  signing: {
    status: "signed-release",
    metadataOnly: false,
    legalPublisherStatus: "confirmed"
  },
  webView2: {
    policy: "offline-evergreen",
    networkRequiredWhenMissing: false
  }
};
const soak = {
  schemaVersion: 1,
  candidateVersion: "1.0.0",
  result: "pass",
  interrupted: false,
  startedAt: "2026-07-27T00:00:00.000Z",
  completedAt: "2026-07-28T00:00:01.000Z",
  operations: {
    backups: 2,
    reviews: 20,
    saves: 40,
    switches: 4
  },
  telemetry: {
    samples: 1440,
    residualProcesses: 0
  }
};
const knownLimitations =
  "WebView2 offline first install verified. Authenticode timestamp verified. 24-hour soak completed.";

describe("stable release evidence gate", () => {
  it("accepts only a signed, offline-capable, fully closed 24-hour candidate", () => {
    expect(
      verifyStableEvidenceInputs({
        closure,
        identity,
        knownLimitations,
        soak,
        tag: "v1.0.0"
      })
    ).toMatchObject({
      blockerCount: blockers.length,
      durationMilliseconds: 86_401_000
    });
  });

  it("rejects an unsigned RC, interrupted soak, and unresolved blocker", () => {
    expect(() =>
      verifyStableEvidenceInputs({
        closure,
        identity: {
          ...identity,
          version: "0.1.5-rc.1",
          signing: { status: "unsigned-preview", metadataOnly: true }
        },
        knownLimitations,
        soak,
        tag: "v1.0.0"
      })
    ).toThrow("Stable identity version must be 1.0.0");
    expect(() =>
      verifyStableEvidenceInputs({
        closure,
        identity,
        knownLimitations,
        soak: { ...soak, interrupted: true },
        tag: "v1.0.0"
      })
    ).toThrow("Interrupted soak is not a pass");
    expect(() =>
      verifyStableEvidenceInputs({
        closure: closure.replace(
          "| AR-P0-001 | CLOSED |",
          "| AR-P0-001 | BLOCKED |"
        ),
        identity,
        knownLimitations,
        soak,
        tag: "v1.0.0"
      })
    ).toThrow("Stable blocker is not closed: AR-P0-001");
  });
});
