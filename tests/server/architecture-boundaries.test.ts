import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [path] : [];
    })
  );
  return nested.flat();
}

describe("active-library architecture boundaries", () => {
  it("requires handler-owned operations instead of response-owned contexts", async () => {
    const routes = await sourceFiles(join(process.cwd(), "server", "routes"));
    const offenders: string[] = [];
    for (const path of routes) {
      const source = await readFile(path, "utf8");
      if (
        source.includes("requestLibraryContext") ||
        source.includes("assertRequestLibraryCurrent")
      ) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("requires LibraryOperationContext for exported active-library services", async () => {
    const services = await sourceFiles(join(process.cwd(), "server", "services"));
    const offenders: string[] = [];
    for (const path of services) {
      const source = await readFile(path, "utf8");
      if (
        /export async function \w+InVault\s*\(\s*vaultPath\s*:\s*string/gu.test(
          source
        )
      ) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not re-read Vault ID inside an active-library service operation", async () => {
    const services = await sourceFiles(join(process.cwd(), "server", "services"));
    const offenders: string[] = [];
    for (const path of services) {
      if (path.endsWith(`${join("server", "services", "vault-service.ts")}`)) {
        continue;
      }
      const source = await readFile(path, "utf8");
      if (/\breadVaultId\s*\(/gu.test(source)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
