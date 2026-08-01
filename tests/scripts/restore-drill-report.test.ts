import { describe, expect, it } from "vitest";
import { parseRestoreDrillReport } from "../../scripts/extract-restore-drill-report.mjs";

const passingReport = {
  schemaVersion: 1,
  drill: "backup-restore-launch-learning-loop",
  result: "pass",
  generatedAt: "2026-07-29T12:00:00.000Z",
  sourceFixture: {
    readingRecovered: true,
    cardRecovered: true,
    reviewRecovered: true
  },
  postLaunchFixture: {
    readingCreated: true,
    cardCreated: true,
    reviewCommitted: true
  },
  restore: {
    selectedDestination: true,
    verifiedFileCount: 12,
    verifiedBytes: 4096
  }
};

describe("restore drill report extraction", () => {
  it("extracts exactly one complete machine-readable report", () => {
    const output =
      `Vitest output\nALEKSI_BACKUP_RESTORE_DRILL_REPORT ${JSON.stringify(
        passingReport
      )}\n`;

    expect(parseRestoreDrillReport(output)).toEqual(passingReport);
  });

  it("rejects incomplete or duplicated evidence", () => {
    const incomplete = {
      ...passingReport,
      sourceFixture: {
        ...passingReport.sourceFixture,
        reviewRecovered: false
      }
    };
    expect(() =>
      parseRestoreDrillReport(
        `ALEKSI_BACKUP_RESTORE_DRILL_REPORT ${JSON.stringify(incomplete)}`
      )
    ).toThrow("reviewRecovered");
    expect(() =>
      parseRestoreDrillReport(
        [
          `ALEKSI_BACKUP_RESTORE_DRILL_REPORT ${JSON.stringify(passingReport)}`,
          `ALEKSI_BACKUP_RESTORE_DRILL_REPORT ${JSON.stringify(passingReport)}`
        ].join("\n")
      )
    ).toThrow("Expected one restore drill report");
  });
});
