import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_ADVISORY = "GHSA-qwww-vcr4-c8h2";
const ALLOWED_PACKAGES = new Map([
  ["react-router", "7.18.1"],
  ["react-router-dom", "7.18.1"]
]);
const SOURCE_ROOTS = ["src", "server", "shared"];
const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx"
]);
const RSC_PATTERNS = [
  {
    label: "React Router RSC module",
    pattern: /react-router\/(?:unstable_)?rsc|react-router\/internal\/react-server/i
  },
  {
    label: "React Server Components dependency",
    pattern: /react-server-dom|@vitejs\/plugin-rsc/i
  },
  {
    label: "React Router RSC API",
    pattern:
      /\b(?:RSCRouteConfig|RSCStaticRouter|RSCHydratedRouter|routeRSCServerRequest|createCallServer|ServerRouter|decodeReply|decodeAction|decodeFormState)\b/
  }
];

function advisoryIds(vulnerability) {
  const ids = [];
  for (const via of vulnerability?.via ?? []) {
    if (typeof via !== "object" || via === null) {
      continue;
    }
    const haystack = `${via.url ?? ""} ${via.title ?? ""} ${via.name ?? ""}`;
    ids.push(...(haystack.match(/GHSA-[a-z0-9-]+/gi) ?? []));
  }
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

export function evaluateAuditReport({
  report,
  auditExitCode,
  installedVersions,
  rscMatches
}) {
  if (!report || typeof report !== "object" || !report.metadata?.vulnerabilities) {
    throw new Error("npm audit returned a malformed report.");
  }
  if (![0, 1].includes(auditExitCode)) {
    throw new Error(`npm audit failed before evaluation (exit ${auditExitCode}).`);
  }

  const counts = report.metadata.vulnerabilities;
  const high = Number(counts.high ?? 0);
  const critical = Number(counts.critical ?? 0);
  if (high === 0 && critical === 0) {
    return {
      status: "passed",
      exceptionApplied: false,
      allowedAdvisory: null,
      counts
    };
  }

  if (critical !== 0 || high !== 2) {
    throw new Error(
      `npm audit found an unexpected high/critical vulnerability count (high=${high}, critical=${critical}).`
    );
  }

  const vulnerabilityNames = Object.keys(report.vulnerabilities ?? {}).sort();
  const expectedNames = [...ALLOWED_PACKAGES.keys()].sort();
  if (JSON.stringify(vulnerabilityNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `npm audit found unexpected vulnerable packages: ${vulnerabilityNames.join(", ")}.`
    );
  }

  for (const [packageName, expectedVersion] of ALLOWED_PACKAGES) {
    const actualVersion = installedVersions[packageName];
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `${packageName} version drifted from the reviewed ${expectedVersion} to ${actualVersion ?? "missing"}.`
      );
    }
  }

  const router = report.vulnerabilities["react-router"];
  const routerDom = report.vulnerabilities["react-router-dom"];
  const ids = advisoryIds(router);
  if (
    router?.severity !== "high" ||
    routerDom?.severity !== "high" ||
    ids.length !== 1 ||
    ids[0] !== ALLOWED_ADVISORY.toLowerCase()
  ) {
    throw new Error("The React Router audit finding does not match the reviewed advisory.");
  }
  if (
    !(routerDom.via ?? []).every(
      (via) => typeof via === "string" && via === "react-router"
    )
  ) {
    throw new Error("react-router-dom has a direct or unexpected advisory.");
  }
  if (rscMatches.length > 0) {
    throw new Error(
      `The ${ALLOWED_ADVISORY} exception is not applicable because RSC usage was found: ${rscMatches.join("; ")}.`
    );
  }

  return {
    status: "passed",
    exceptionApplied: true,
    allowedAdvisory: ALLOWED_ADVISORY,
    counts
  };
}

async function collectSourceFiles(root) {
  const files = [];
  async function visit(relativePath) {
    const absolutePath = join(root, relativePath);
    let entries;
    try {
      entries = await readdir(absolutePath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const child = join(relativePath, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(child);
      }
    }
  }
  for (const sourceRoot of SOURCE_ROOTS) {
    await visit(sourceRoot);
  }
  files.push("package.json");
  return files.sort();
}

async function scanForRscUsage(root) {
  const matches = [];
  const files = await collectSourceFiles(root);
  for (const relativePath of files) {
    const content = await readFile(join(root, relativePath), "utf8");
    for (const { label, pattern } of RSC_PATTERNS) {
      if (pattern.test(content)) {
        matches.push(`${relativePath}: ${label}`);
      }
    }
  }
  return { files, matches };
}

async function readInstalledVersions(root) {
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  return Object.fromEntries(
    [...ALLOWED_PACKAGES.keys()].map((packageName) => [
      packageName,
      lock.packages?.[`node_modules/${packageName}`]?.version
    ])
  );
}

async function main() {
  const root = process.cwd();
  const outputPath = resolve(
    root,
    process.argv[2] ?? "artifacts/qualification/npm-audit-evidence.json"
  );
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error("Run this verifier through npm so the pinned npm audit client is used.");
  }

  const audit = spawnSync(
    process.execPath,
    [npmExecPath, "audit", "--json", "--audit-level=high"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    }
  );
  if (audit.error) {
    throw audit.error;
  }
  const npmVersionResult = spawnSync(process.execPath, [npmExecPath, "--version"], {
    cwd: root,
    encoding: "utf8"
  });
  if (npmVersionResult.error || npmVersionResult.status !== 0) {
    throw npmVersionResult.error ?? new Error("Unable to record the npm audit client version.");
  }

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    throw new Error(
      `npm audit did not return JSON (exit ${audit.status ?? "unknown"}): ${audit.stderr.trim()}`
    );
  }

  const [installedVersions, scan] = await Promise.all([
    readInstalledVersions(root),
    scanForRscUsage(root)
  ]);
  const result = evaluateAuditReport({
    report,
    auditExitCode: audit.status,
    installedVersions,
    rscMatches: scan.matches
  });
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    npmVersion: npmVersionResult.stdout.trim(),
    auditExitCode: audit.status,
    ...result,
    reviewedVersions: installedVersions,
    rscApplicabilityCheck: {
      applicable: false,
      scannedFileCount: scan.files.length,
      sourceRoots: SOURCE_ROOTS,
      matches: scan.matches
    },
    rationale: result.exceptionApplied
      ? "GHSA-qwww-vcr4-c8h2 affects React Router experimental RSC APIs; this browser SPA does not import or use those APIs."
      : "No high or critical npm vulnerabilities were reported."
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    result.exceptionApplied
      ? `npm audit gate passed with the reviewed non-applicable ${ALLOWED_ADVISORY} exception.`
      : "npm audit gate passed with no high or critical vulnerabilities."
  );
  console.log(`Audit evidence: ${outputPath}`);
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    resolve(process.argv[1]).toLowerCase();
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
