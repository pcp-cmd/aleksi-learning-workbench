export type RestoreDrillReport = {
  schemaVersion: 1;
  drill: "backup-restore-launch-learning-loop";
  result: "pass";
  restore: {
    selectedDestination: true;
    verifiedBytes: number;
    verifiedFileCount: number;
  };
  [key: string]: unknown;
};

export function parseRestoreDrillReport(output: string): RestoreDrillReport;

export function extractRestoreDrillReport(
  inputPath: string,
  outputPath: string
): Promise<RestoreDrillReport>;
