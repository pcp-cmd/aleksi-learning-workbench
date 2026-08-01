import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("release test runner", () => {
  it("isolates every test file with a bounded synchronous child process", async () => {
    const source = await readFile(
      join(process.cwd(), "scripts/run-release-tests.mjs"),
      "utf8"
    );

    expect(source).toContain('import { spawnSync } from "node:child_process";');
    expect(source).toContain('timeout: timeoutMs');
    expect(source).toContain('maxBuffer: 4 * 1024 * 1024');
    expect(source).toContain('"--pool=threads"');
    expect(source).toContain('"--no-file-parallelism"');
    expect(source).toContain('result.status === 0');
    expect(source).toContain('result.error?.code === "ETIMEDOUT"');
  });

  it("keeps the release suites discoverable from explicit test directories", async () => {
    const [source, packageJson] = await Promise.all([
      readFile(join(process.cwd(), "scripts/run-release-tests.mjs"), "utf8"),
      readFile(join(process.cwd(), "package.json"), "utf8")
    ]);

    expect(source).toContain('server: ["tests/server", "tests/shared", "tests/scripts", "tests/docs"]');
    expect(source).toContain('api: ["tests/api"]');
    expect(source).toContain('ui: ["tests/ui"]');
    expect(packageJson).toContain('"test:release:server": "node scripts/run-release-tests.mjs server"');
    expect(packageJson).toContain('"test:release:api": "node scripts/run-release-tests.mjs api"');
    expect(packageJson).toContain('"test:release:ui": "node scripts/run-release-tests.mjs ui"');
  });
});
