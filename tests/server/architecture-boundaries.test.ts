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
  it("keeps characterized high-risk modules within shrinking line budgets", async () => {
    const budgets = {
      "server/services/index-service.ts": 1175,
      "server/services/vault-service.ts": 1300,
      "src-tauri/src/runtime.rs": 1900,
      "src/features/reader/ReaderPage.tsx": 650,
      "src/features/review/ReviewPage.tsx": 850,
      "src/features/settings/SettingsDialog.tsx": 425,
      "src/features/verification/VerificationPage.tsx": 650,
      "src/lib/api-client.ts": 525
    } as const;
    const offenders: string[] = [];

    for (const [path, maxLines] of Object.entries(budgets)) {
      const source = await readFile(join(process.cwd(), path), "utf8");
      const lines = source.replace(/\r\n/gu, "\n").trimEnd().split("\n").length;
      if (lines > maxLines) {
        offenders.push(`${path}: ${lines} > ${maxLines}`);
      }
    }

    expect(offenders).toEqual([]);
  });

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

  it("uses bounded readers instead of direct readFile in user-data services", async () => {
    const services = await sourceFiles(join(process.cwd(), "server", "services"));
    const offenders: string[] = [];
    for (const path of services) {
      const source = await readFile(path, "utf8");
      if (
        /\breadFile\s*\(/gu.test(source) ||
        /import\s*\{[^}]*\breadFile\b[^}]*\}\s*from\s*["']node:fs\/promises["']/su.test(
          source
        )
      ) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps server layers and codecs pointed in one direction", async () => {
    const services = await sourceFiles(join(process.cwd(), "server", "services"));
    const src = await sourceFiles(join(process.cwd(), "src"));
    const domainAndCodecs = [
      ...(await sourceFiles(join(process.cwd(), "server", "domain"))),
      join(process.cwd(), "server", "lib", "markdown-codec.ts")
    ];
    const offenders: string[] = [];
    for (const path of services) {
      const source = await readFile(path, "utf8");
      if (/from\s*["'][^"']*\/routes(?:\/|["'])/u.test(source)) {
        offenders.push(path);
      }
    }
    for (const path of src) {
      const source = await readFile(path, "utf8");
      if (/from\s*["'][^"']*server\//u.test(source)) {
        offenders.push(path);
      }
    }
    for (const path of domainAndCodecs) {
      const source = await readFile(path, "utf8");
      if (
        /from\s*["']express["']/u.test(source) ||
        /from\s*["']@tauri-apps\//u.test(source)
      ) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not delete authoritative Markdown from projection code", async () => {
    const projections = await sourceFiles(
      join(process.cwd(), "server", "projections")
    );
    const offenders: string[] = [];
    for (const path of projections) {
      const source = await readFile(path, "utf8");
      if (
        /\.(?:md|markdown)["'`]/iu.test(source) &&
        /\b(?:rm|unlink)\s*\(/u.test(source)
      ) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
