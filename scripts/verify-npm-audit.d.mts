export interface AuditGateInput {
  report: {
    vulnerabilities?: Record<
      string,
      {
        severity?: string;
        via?: Array<string | Record<string, unknown>>;
      }
    >;
    metadata?: {
      vulnerabilities?: Record<string, number>;
    };
  };
  auditExitCode: number | null;
  installedVersions: Record<string, string | undefined>;
  rscMatches: string[];
}

export interface AuditGateResult {
  status: "passed";
  exceptionApplied: boolean;
  allowedAdvisory: string | null;
  counts: Record<string, number>;
}

export function evaluateAuditReport(input: AuditGateInput): AuditGateResult;
