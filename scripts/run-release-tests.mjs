import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const vitestEntry = resolve(root, "node_modules/vitest/vitest.mjs");
const timeoutMs = Number.parseInt(process.env.ALEKSI_TEST_FILE_TIMEOUT_MS ?? "120000", 10);

const suiteDirectories = {
  server: ["tests/server", "tests/shared", "tests/scripts", "tests/docs"],
  api: ["tests/api"],
  ui: ["tests/ui"]
};

const suite = process.argv[2];
if (!(suite in suiteDirectories)) {
  console.error(`Unknown release test suite: ${suite ?? "<missing>"}`);
  console.error(`Expected one of: ${Object.keys(suiteDirectories).join(", ")}`);
  process.exit(2);
}

async function discoverFiles(directories) {
  const files = [];
  for (const directory of directories) {
    const entries = await readdir(resolve(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.test\.(?:ts|tsx)$/u.test(entry.name)) {
        files.push(`${directory}/${entry.name}`);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function runFile(file) {
  const result = spawnSync(
    process.execPath,
    [
      vitestEntry,
      "run",
      file,
      "--pool=threads",
      "--maxWorkers=1",
      "--minWorkers=1",
      "--no-file-parallelism",
      "--reporter=dot",
      "--reporter=hanging-process"
    ],
    {
      cwd: root,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024
    }
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0 && result.error === undefined) {
    console.log(`[release:${suite}] PASS ${file}`);
    return;
  }

  console.error(output);
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`${file} did not exit within ${timeoutMs}ms`);
  }
  if (result.error !== undefined) {
    throw result.error;
  }
  throw new Error(
    `${file} failed with ${result.signal ? `signal ${result.signal}` : `exit code ${result.status}`}`
  );
}

const files = await discoverFiles(suiteDirectories[suite]);
if (files.length === 0) {
  throw new Error(`No test files found for release suite ${suite}`);
}

for (const file of files) {
  runFile(file);
}

console.log(`\n[release:${suite}] completed ${files.length} isolated test files.`);
