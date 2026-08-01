#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TEXT_EXTENSIONS = new Set([
  "",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".nsh",
  ".ps1",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);

const SECRET_PATTERNS = [
  {
    label: "private key",
    pattern: /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/gu
  },
  {
    label: "GitHub token",
    pattern: /\b(?:gh[oprsu]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/gu
  },
  {
    label: "npm token",
    pattern: /\bnpm_[A-Za-z0-9]{30,}\b/gu
  },
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu
  },
  {
    label: "generic bearer secret",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{32,}\b/gu
  }
];

const EXECUTABLE_SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".rs",
  ".ts",
  ".tsx"
]);

function workspaceSourceFiles(root) {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
    cwd: root,
    encoding: "buffer",
    windowsHide: true
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed: ${result.stderr.toString("utf8").trim()}`
    );
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function isExecutableSource(path) {
  return (
    EXECUTABLE_SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) &&
    /^(?:scripts|server|shared|src|src-tauri)\//u.test(path)
  );
}

export async function scanSourceSecurity(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const files = options.files ?? workspaceSourceFiles(root);
  const findings = [];
  let filesScanned = 0;

  for (const path of files) {
    const extension = extname(path).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) {
      continue;
    }
    let data;
    try {
      data = await readFile(resolve(root, ...path.split("/")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    filesScanned += 1;
    if (data.includes(0)) {
      continue;
    }
    const source = data.toString("utf8");
    for (const { label, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        findings.push({
          code: "SECRET_PATTERN",
          label,
          line: lineNumber(source, match.index),
          path
        });
      }
    }
    if (isExecutableSource(path)) {
      for (const [label, pattern] of [
        ["dynamic eval", /\beval\s*\(/gu],
        ["dynamic Function constructor", /\bnew\s+Function\s*\(/gu]
      ]) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
          findings.push({
            code: "DYNAMIC_CODE_EXECUTION",
            label,
            line: lineNumber(source, match.index),
            path
          });
        }
      }
    }
  }

  const tauriConfig = JSON.parse(
    await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8")
  );
  const csp = String(tauriConfig.app?.security?.csp ?? "");
  if (csp.includes("'unsafe-eval'")) {
    findings.push({
      code: "UNSAFE_CSP",
      label: "CSP contains unsafe-eval",
      line: 1,
      path: "src-tauri/tauri.conf.json"
    });
  }
  const connectSource = csp.match(
    /(?:^|;)\s*connect-src\s+([^;]+)/u
  )?.[1];
  if (connectSource?.split(/\s+/u).includes("*") === true) {
    findings.push({
      code: "UNSAFE_CSP",
      label: "CSP connect-src contains wildcard",
      line: 1,
      path: "src-tauri/tauri.conf.json"
    });
  }

  if (findings.length > 0) {
    const report = findings
      .map(
        (finding) =>
          `${finding.code} ${finding.path}:${finding.line} ${finding.label}`
      )
      .join("\n");
    throw new Error(`Source security scan failed:\n${report}`);
  }
  return { filesScanned, findings };
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const report = await scanSourceSecurity();
    console.log(
      `Source security scan passed: ${report.filesScanned} workspace source files, 0 findings`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
