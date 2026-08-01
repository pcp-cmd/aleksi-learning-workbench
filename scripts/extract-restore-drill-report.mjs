#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "ALEKSI_BACKUP_RESTORE_DRILL_REPORT ";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function parseRestoreDrillReport(output) {
  const lines = String(output)
    .split(/\r?\n/u)
    .filter((line) => line.includes(PREFIX));
  assert(lines.length === 1, `Expected one restore drill report, found ${lines.length}`);
  const payload = lines[0].slice(lines[0].indexOf(PREFIX) + PREFIX.length);
  const report = JSON.parse(payload);
  assert(report.schemaVersion === 1, "Restore drill schemaVersion must be 1");
  assert(
    report.drill === "backup-restore-launch-learning-loop",
    "Unexpected restore drill identifier"
  );
  assert(report.result === "pass", "Restore drill did not pass");
  for (const [label, value] of Object.entries({
    cardRecovered: report.sourceFixture?.cardRecovered,
    readingRecovered: report.sourceFixture?.readingRecovered,
    reviewRecovered: report.sourceFixture?.reviewRecovered,
    cardCreated: report.postLaunchFixture?.cardCreated,
    readingCreated: report.postLaunchFixture?.readingCreated,
    reviewCommitted: report.postLaunchFixture?.reviewCommitted,
    selectedDestination: report.restore?.selectedDestination
  })) {
    assert(value === true, `Restore drill evidence is incomplete: ${label}`);
  }
  assert(
    Number.isSafeInteger(report.restore?.verifiedFileCount) &&
      report.restore.verifiedFileCount > 0,
    "Restore drill verified file count is invalid"
  );
  assert(
    Number.isSafeInteger(report.restore?.verifiedBytes) &&
      report.restore.verifiedBytes > 0,
    "Restore drill verified byte count is invalid"
  );
  return report;
}

export async function extractRestoreDrillReport(inputPath, outputPath) {
  const report = parseRestoreDrillReport(await readFile(inputPath, "utf8"));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (input === undefined || output === undefined || extra.length > 0) {
    console.error(
      "Usage: node scripts/extract-restore-drill-report.mjs <vitest-output> <report.json>"
    );
    process.exitCode = 1;
  } else {
    try {
      const report = await extractRestoreDrillReport(
        resolve(input),
        resolve(output)
      );
      console.log(
        `Restore drill report verified: ${report.restore.verifiedFileCount} files`
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
