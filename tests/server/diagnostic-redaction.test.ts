import { describe, expect, it } from "vitest";
import {
  collectSensitiveEnvironmentValues,
  DIAGNOSTIC_LOG_NAMES,
  DIAGNOSTIC_TAIL_BYTES,
  redactDiagnosticText,
  runtimeDiagnosticReportSchema,
  sanitizeDiagnosticTail
} from "../../server/runtime/diagnostic-redaction";

describe("diagnostic redaction", () => {
  it("collects only non-empty values from sensitive environment keys", () => {
    expect(
      collectSensitiveEnvironmentValues({
        ALEKSI_PROTOCOL_SECRET: "protocol-secret",
        SERVICE_AUTH_TOKEN: "service-token",
        API_KEY: "api-key",
        DB_PASSWORD: "database-password",
        SESSION_COOKIE: "session-cookie",
        MONKEY_MODE: "not-sensitive",
        EMPTY_SECRET: "",
        ALEKSI_RUNTIME_LOG_DIR: "C:\\Logs"
      })
    ).toEqual([
      "protocol-secret",
      "service-token",
      "api-key",
      "database-password",
      "session-cookie"
    ]);
  });

  it("removes credentials, sensitive assignments, URLs, and local paths while preserving categories", () => {
    const knownSecret = "known-protocol-secret";
    const text = [
      `ECONNREFUSED Authorization: Bearer ${knownSecret}`,
      "EHTTP 2026-07-22 Authorization: Basic unknown-basic-credential",
      "x-api-key=unknown-inline-key",
      'password="unknown-inline-password"',
      "service_secret=unknown multi word secret",
      "Cookie: session=unknown-cookie; theme=light",
      `request failed at https://alice:${knownSecret}@api.example.test/v1?token=query-token&debug=true`,
      "local file file:///C:/Users/alice/Documents/private.md",
      'ENOENT at "C:\\Users\\alice\\Secret Vault\\private.md"; category=filesystem',
      'EACCES at "\\\\fileserver\\learners\\alice\\private.md"; category=network',
      'EINVAL at "/home/alice/private.md"; category=filesystem'
    ].join("\n");

    const redacted = redactDiagnosticText(text, [knownSecret]);

    for (const sensitiveValue of [
      knownSecret,
      "unknown-inline-key",
      "unknown-inline-password",
      "unknown multi word secret",
      "unknown-cookie",
      "unknown-basic-credential",
      "query-token",
      "alice",
      "private.md",
      "fileserver",
      "https://",
      "file:///",
      "/home/"
    ]) {
      expect(redacted).not.toContain(sensitiveValue);
    }
    expect(redacted).toContain("ECONNREFUSED");
    expect(redacted).toContain("EHTTP");
    expect(redacted).toContain("ENOENT");
    expect(redacted).toContain("EACCES");
    expect(redacted).toContain("EINVAL");
    expect(redacted).toContain("category=filesystem");
    expect(redacted).toContain("category=network");
    expect(redacted).toContain("[redacted]");
    expect(redacted).toContain("[remote url]");
    expect(redacted).toContain("[local path]");
  });

  it("keeps the final redacted tail within the UTF-8 byte budget", () => {
    const tail = sanitizeDiagnosticTail(
      `${"secret".repeat(4_000)}\nENOENT category=filesystem secret`,
      ["secret"],
      512
    );

    expect(Buffer.byteLength(tail, "utf8")).toBeLessThanOrEqual(512);
    expect(tail).not.toContain("secret");
    expect(tail).toContain("ENOENT");
    expect(tail).toContain("category=filesystem");
  });

  it("accepts only the structured report allowlist and bounded named tails", () => {
    const report = {
      generatedAt: "2026-07-22T00:00:00.000Z",
      identity: {
        version: "0.1.1",
        buildId: "sha256-0123456789abcdef"
      },
      mode: "friend-preview",
      health: {
        ok: true,
        service: "aleksi-workbench"
      },
      logs: [{ name: DIAGNOSTIC_LOG_NAMES[0], tail: "ENOENT [local path]" }]
    };

    expect(runtimeDiagnosticReportSchema.safeParse(report).success).toBe(true);
    expect(
      runtimeDiagnosticReportSchema.safeParse({
        ...report,
        environment: { ALEKSI_PROTOCOL_SECRET: "must-not-export" }
      }).success
    ).toBe(false);
    expect(
      runtimeDiagnosticReportSchema.safeParse({
        ...report,
        logs: [{ name: "arbitrary.log", tail: "content" }]
      }).success
    ).toBe(false);
    expect(
      runtimeDiagnosticReportSchema.safeParse({
        ...report,
        logs: [
          {
            name: DIAGNOSTIC_LOG_NAMES[0],
            tail: "界".repeat(DIAGNOSTIC_TAIL_BYTES)
          }
        ]
      }).success
    ).toBe(false);
  });
});
