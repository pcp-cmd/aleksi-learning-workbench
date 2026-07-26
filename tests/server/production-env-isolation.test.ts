import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryDirectories: string[] = [];
const DESKTOP_ENVIRONMENT_NAMES = [
  "ALEKSI_APP_VERSION",
  "ALEKSI_BUILD_ID",
  "ALEKSI_DESKTOP_PARENT_PID",
  "ALEKSI_PROTOCOL_SECRET",
  "ALEKSI_PROTOCOL_VERSION",
  "ALEKSI_SHELL_BUILD_ID",
  "ALEKSI_SIDECAR_BUILD_ID",
  "ALEKSI_STATIC_DIST_DIR"
] as const;

type ChildResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
};

function isolatedEnvironment(desktopSidecar: boolean): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.ALEKSI_DESKTOP_SIDECAR;
  delete environment.ALEKSI_SERVER_PORT;
  for (const name of DESKTOP_ENVIRONMENT_NAMES) {
    delete environment[name];
  }
  if (desktopSidecar) {
    environment.ALEKSI_APP_VERSION = "0.1.2";
    environment.ALEKSI_BUILD_ID = "trusted-legacy-build";
    environment.ALEKSI_DESKTOP_PARENT_PID = String(process.pid);
    environment.ALEKSI_DESKTOP_SIDECAR = "1";
    environment.ALEKSI_PROTOCOL_VERSION = "1";
    environment.ALEKSI_SERVER_PORT = "0";
    environment.ALEKSI_SHELL_BUILD_ID = "trusted-shell-build";
    environment.ALEKSI_SIDECAR_BUILD_ID = "trusted-sidecar-build";
  }
  return environment;
}

async function runEntry(
  entry: "development-entry.ts" | "runtime-entry.ts",
  cwd: string,
  desktopSidecar: boolean
): Promise<ChildResult> {
  const child = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/tsx/dist/cli.mjs"),
      resolve(root, "server", entry)
    ],
    {
      cwd,
      env: isolatedEnvironment(desktopSidecar),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return await new Promise((resolveResult) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 4_000);
    child.once("exit", (exitCode) => {
      clearTimeout(timeout);
      resolveResult({ exitCode, stderr, stdout, timedOut });
    });
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
});

describe("production environment isolation", () => {
  it("does not let a neighboring .env complete a packaged desktop protocol", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-hostile-env-"));
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, ".env"),
      [
        "ALEKSI_APP_VERSION=9.9.9",
        `ALEKSI_PROTOCOL_SECRET=${"f".repeat(64)}`,
        "ALEKSI_PROTOCOL_VERSION=1",
        "ALEKSI_SHELL_BUILD_ID=hostile-shell-build",
        "ALEKSI_SIDECAR_BUILD_ID=hostile-sidecar-build"
      ].join("\n"),
      "utf8"
    );

    const result = await runEntry("runtime-entry.ts", directory, true);

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("ALEKSI_READY");
    expect(result.stderr).toContain("ALEKSI_PROTOCOL_SECRET");
    expect(result.stderr).not.toContain("f".repeat(64));
  });

  it("keeps .env loading behind the explicit development entry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-development-env-"));
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, ".env"),
      "ALEKSI_SERVER_PORT=not-a-port\n",
      "utf8"
    );

    const result = await runEntry("development-entry.ts", directory, false);

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ALEKSI_SERVER_PORT");
  });

  it("keeps the packaged bundle on runtime-entry while development scripts are explicit", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    const buildRuntime = await readFile(
      resolve(root, "scripts/build-runtime.mjs"),
      "utf8"
    );

    expect(packageJson.scripts["dev:server"]).toContain(
      "server/development-entry.ts"
    );
    expect(packageJson.scripts.start).toContain(
      "server/development-entry.ts"
    );
    expect(buildRuntime).toContain('"server/runtime-entry.ts"');
    expect(buildRuntime).not.toContain('"server/development-entry.ts"');
  });
});
