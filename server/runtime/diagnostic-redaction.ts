import { z } from "zod";

export const DIAGNOSTIC_TAIL_BYTES = 8 * 1024;
export const DIAGNOSTIC_LOG_NAMES = [
  "latest.log",
  "sidecar.stdout.log",
  "sidecar.stderr.log",
  "server.stdout.log",
  "server.stderr.log",
  "desktop-lifecycle.log"
] as const;

const DIAGNOSTIC_MODES = [
  "development",
  "friend-preview",
  "tauri-desktop",
  "other"
] as const;
const REDACTED_VALUE = "[redacted]";
const SENSITIVE_NAME_PARTS = new Set([
  "auth",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "key",
  "passcode",
  "passphrase",
  "password",
  "passwd",
  "pwd",
  "secret",
  "token"
]);
const SENSITIVE_FIELD_NAME =
  "[A-Za-z0-9_.-]*(?:secret|token|password|passwd|passphrase|credential|api[-_.]?key|access[-_.]?key|private[-_.]?key|auth(?:orization)?|cookie|key)[A-Za-z0-9_.-]*";
const SENSITIVE_HEADER_PATTERN = new RegExp(
  `(^|\\s)(${SENSITIVE_FIELD_NAME}\\s*:\\s*)[^\\r\\n]*`,
  "gimu"
);
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `((?:["']?)${SENSITIVE_FIELD_NAME}(?:["']?)\\s*[:=]\\s*)(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^,;\\r\\n]+)`,
  "giu"
);
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/giu;
const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/giu;
const FILE_URL_PATTERN = /\bfile:\/\/\/?[^\s<>"']+/giu;
const QUOTED_LOCAL_PATH_PATTERN =
  /(["'])(?:(?:[A-Za-z]:[\\/])|(?:\\\\)|(?:\/(?!\/)))[^"'\r\n]*\1/gu;
const UNQUOTED_WINDOWS_PATH_PATTERN =
  /(^|[\s(=])(?:[A-Za-z]:[\\/]|\\\\)[^\r\n]*/gmu;
const UNQUOTED_POSIX_PATH_PATTERN = /(^|[\s(=])\/(?!\/)[^\r\n]*/gmu;

function sensitiveNameParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .split(/[^A-Za-z0-9]+/gu)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

function sensitiveEnvironmentName(name: string): boolean {
  return sensitiveNameParts(name).some((part) =>
    SENSITIVE_NAME_PARTS.has(part)
  );
}

export function collectSensitiveEnvironmentValues(
  env: Record<string, string | undefined>
): string[] {
  const values = new Set<string>();

  for (const [name, value] of Object.entries(env)) {
    if (value && sensitiveEnvironmentName(name)) {
      values.add(value);
    }
  }

  return [...values];
}

function redactKnownValues(
  text: string,
  knownSensitiveValues: readonly string[]
): string {
  const values = [...new Set(knownSensitiveValues.filter(Boolean))].sort(
    (left, right) => right.length - left.length
  );

  return values.reduce(
    (redacted, value) => redacted.split(value).join(REDACTED_VALUE),
    text
  );
}

export function redactDiagnosticText(
  text: string,
  knownSensitiveValues: readonly string[] = []
): string {
  const withoutKnownValues = redactKnownValues(text, knownSensitiveValues);

  return withoutKnownValues
    .replace(SENSITIVE_HEADER_PATTERN, `$1$2${REDACTED_VALUE}`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED_VALUE}`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(HTTP_URL_PATTERN, "[remote url]")
    .replace(FILE_URL_PATTERN, "[local file]")
    .replace(QUOTED_LOCAL_PATH_PATTERN, "[local path]")
    .replace(UNQUOTED_WINDOWS_PATH_PATTERN, "$1[local path]")
    .replace(UNQUOTED_POSIX_PATH_PATTERN, "$1[local path]");
}

function utf8Tail(text: string, maximumBytes: number): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("maximumBytes must be a non-negative safe integer");
  }

  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maximumBytes) {
    return text;
  }

  let start = buffer.length - maximumBytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }

  return buffer.subarray(start).toString("utf8");
}

export function sanitizeDiagnosticTail(
  text: string,
  knownSensitiveValues: readonly string[] = [],
  maximumBytes = DIAGNOSTIC_TAIL_BYTES
): string {
  return utf8Tail(
    redactDiagnosticText(text, knownSensitiveValues),
    maximumBytes
  );
}

export function allowlistedDiagnosticMode(
  mode: string
): (typeof DIAGNOSTIC_MODES)[number] {
  return (DIAGNOSTIC_MODES as readonly string[]).includes(mode)
    ? (mode as (typeof DIAGNOSTIC_MODES)[number])
    : "other";
}

const identityValueSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9.-]+$/u);
const diagnosticLogSchema = z
  .object({
    name: z.enum(DIAGNOSTIC_LOG_NAMES),
    tail: z.string().refine(
      (tail) => Buffer.byteLength(tail, "utf8") <= DIAGNOSTIC_TAIL_BYTES,
      "diagnostic log tail exceeds the byte budget"
    )
  })
  .strict();

export const runtimeDiagnosticReportSchema = z
  .object({
    generatedAt: z.string().datetime(),
    identity: z
      .object({
        version: identityValueSchema,
        buildId: identityValueSchema
      })
      .strict(),
    mode: z.enum(DIAGNOSTIC_MODES),
    health: z
      .object({
        ok: z.boolean(),
        service: z.literal("aleksi-workbench"),
        desktopLifecycle: z.enum(["healthy", "failed"])
      })
      .strict(),
    logs: z.array(diagnosticLogSchema).max(DIAGNOSTIC_LOG_NAMES.length)
  })
  .strict()
  .superRefine((report, context) => {
    const names = new Set<string>();
    for (const log of report.logs) {
      if (names.has(log.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate diagnostic log name: ${log.name}`,
          path: ["logs"]
        });
      }
      names.add(log.name);
    }
  });

export type RuntimeDiagnosticReport = z.infer<
  typeof runtimeDiagnosticReportSchema
>;
