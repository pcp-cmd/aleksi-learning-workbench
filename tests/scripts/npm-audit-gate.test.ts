import { describe, expect, it } from "vitest";
import { evaluateAuditReport } from "../../scripts/verify-npm-audit.mjs";

const reviewedVersions = {
  "react-router": "7.18.1",
  "react-router-dom": "7.18.1"
};

const reviewedReport = {
  vulnerabilities: {
    "react-router": {
      severity: "high",
      via: [
        {
          title: "React Router has RCE vulnerabilities in RSC APIs",
          url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2"
        }
      ]
    },
    "react-router-dom": {
      severity: "high",
      via: ["react-router"]
    }
  },
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 2,
      critical: 0,
      total: 2
    }
  }
};

describe("npm release audit gate", () => {
  it("accepts only the reviewed RSC advisory when the SPA has no RSC usage", () => {
    expect(
      evaluateAuditReport({
        report: reviewedReport,
        auditExitCode: 1,
        installedVersions: reviewedVersions,
        rscMatches: []
      })
    ).toMatchObject({
      status: "passed",
      exceptionApplied: true,
      allowedAdvisory: "GHSA-qwww-vcr4-c8h2"
    });
  });

  it("rejects RSC usage because the advisory would become applicable", () => {
    expect(() =>
      evaluateAuditReport({
        report: reviewedReport,
        auditExitCode: 1,
        installedVersions: reviewedVersions,
        rscMatches: ["src/app.tsx: React Router RSC API"]
      })
    ).toThrow(/exception is not applicable/);
  });

  it("rejects any additional high vulnerability", () => {
    const report = structuredClone(reviewedReport) as typeof reviewedReport & {
      vulnerabilities: typeof reviewedReport.vulnerabilities & {
        postcss: { severity: string; via: string[] };
      };
    };
    report.vulnerabilities.postcss = {
      severity: "high",
      via: ["unexpected"]
    };
    report.metadata.vulnerabilities.high = 3;
    report.metadata.vulnerabilities.total = 3;
    expect(() =>
      evaluateAuditReport({
        report,
        auditExitCode: 1,
        installedVersions: reviewedVersions,
        rscMatches: []
      })
    ).toThrow(/unexpected high\/critical vulnerability count/);
  });

  it("rejects reviewed dependency version drift", () => {
    expect(() =>
      evaluateAuditReport({
        report: reviewedReport,
        auditExitCode: 1,
        installedVersions: {
          ...reviewedVersions,
          "react-router": "7.18.2"
        },
        rscMatches: []
      })
    ).toThrow(/version drifted/);
  });
});
