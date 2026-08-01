#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_BLOCKERS = [
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
const MINIMUM_SOAK_MILLISECONDS = 24 * 60 * 60 * 1_000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function verifyStableEvidenceInputs({
  closure,
  identity,
  knownLimitations,
  soak,
  tag
}) {
  assert(tag === "v1.0.0", "Stable publication requires the exact v1.0.0 tag");
  assert(identity.version === "1.0.0", "Stable identity version must be 1.0.0");
  assert(
    tag === `v${identity.version}`,
    "Stable tag and release identity version must match"
  );
  assert(
    identity.signing?.status === "signed-release" &&
      identity.signing?.metadataOnly === false &&
      identity.signing?.legalPublisherStatus === "confirmed",
    "Stable identity requires confirmed non-metadata signing"
  );
  assert(
    identity.webView2?.policy === "offline-evergreen" &&
      identity.webView2?.networkRequiredWhenMissing === false,
    "Stable first installation requires the offline Evergreen WebView2 policy"
  );

  assert(soak.schemaVersion === 1, "Soak report schemaVersion must be 1");
  assert(soak.candidateVersion === identity.version, "Soak candidate version drift");
  assert(soak.result === "pass", "Soak report did not pass");
  assert(soak.interrupted === false, "Interrupted soak is not a pass");
  const duration = Date.parse(soak.completedAt) - Date.parse(soak.startedAt);
  assert(
    Number.isFinite(duration) && duration >= MINIMUM_SOAK_MILLISECONDS,
    "Stable soak must run uninterrupted for at least 24 hours"
  );
  for (const operation of ["backups", "reviews", "saves", "switches"]) {
    assert(
      Number.isSafeInteger(soak.operations?.[operation]) &&
        soak.operations[operation] > 0,
      `Stable soak is missing ${operation} operations`
    );
  }
  assert(
    Number.isSafeInteger(soak.telemetry?.samples) &&
      soak.telemetry.samples > 0,
    "Stable soak telemetry samples are missing"
  );
  assert(
    soak.telemetry?.residualProcesses === 0,
    "Stable soak left residual processes"
  );

  for (const blocker of RELEASE_BLOCKERS) {
    const row = new RegExp(
      `^\\|\\s*${blocker}\\s*\\|\\s*CLOSED\\s*\\|`,
      "imu"
    );
    assert(row.test(closure), `Stable blocker is not closed: ${blocker}`);
  }
  assert(
    !/\|\s*(?:AR-P0|AR-P1)-\d+\s*\|\s*(?:OPEN|BLOCKED|DEFERRED)\s*\|/iu.test(
      closure
    ),
    "P0/P1 closure contains an unresolved release blocker"
  );
  assert(
    knownLimitations.includes("WebView2") &&
      knownLimitations.includes("Authenticode") &&
      knownLimitations.includes("24-hour soak"),
    "Known limitations must state WebView2, signing, and soak boundaries"
  );
  return {
    blockerCount: RELEASE_BLOCKERS.length,
    durationMilliseconds: duration
  };
}

export async function verifyStableEvidence(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const tag = options.tag ?? process.env.GITHUB_REF_NAME ?? "";
  const [identity, soak, closure, knownLimitations] = await Promise.all([
    readFile(resolve(root, "release/identity.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "release/evidence/SOAK_REPORT.json"), "utf8").then(
      JSON.parse
    ),
    readFile(resolve(root, "release/evidence/P0_P1_CLOSURE.md"), "utf8"),
    readFile(resolve(root, "release/evidence/KNOWN_LIMITATIONS.md"), "utf8")
  ]);
  return verifyStableEvidenceInputs({
    closure,
    identity,
    knownLimitations,
    soak,
    tag
  });
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyStableEvidence();
    console.log(
      `Stable evidence verified: ${result.blockerCount} blockers closed, ${result.durationMilliseconds} ms soak`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
