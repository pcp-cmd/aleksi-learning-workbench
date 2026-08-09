import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { scanSourceSecurity } from "../../scripts/scan-source-security.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true })
    )
  );
});

async function fixture(source: string) {
  const root = await mkdtemp(join(tmpdir(), "aleksi-security-scan-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "src-tauri"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({
      app: {
        security: {
          csp: "default-src 'self'; connect-src 'self' http://127.0.0.1:*"
        }
      }
    })
  );
  await writeFile(join(root, "src/example.ts"), source);
  return root;
}

describe("source security scan", () => {
  it("accepts bounded local-only source", async () => {
    const root = await fixture("export const value = 'local-only';\n");

    await expect(
      scanSourceSecurity({
        files: ["src/example.ts", "src-tauri/tauri.conf.json"],
        root
      })
    ).resolves.toMatchObject({ findings: [] });
  });

  it("rejects private keys without printing their contents", async () => {
    const root = await fixture(
      `const key = '${["-----BEGIN", "PRIVATE", "KEY-----"].join(" ")}';\n`
    );

    await expect(
      scanSourceSecurity({
        files: ["src/example.ts", "src-tauri/tauri.conf.json"],
        root
      })
    ).rejects.toThrow("SECRET_PATTERN src/example.ts:1 private key");
  });

  it("rejects OpenAI-style API keys without printing their contents", async () => {
    const fakeOpenAiKey = ["sk", "proj", "A".repeat(32)].join("-");
    const root = await fixture(`const token = '${fakeOpenAiKey}';\n`);

    await expect(
      scanSourceSecurity({
        files: ["src/example.ts", "src-tauri/tauri.conf.json"],
        root
      })
    ).rejects.toThrow("SECRET_PATTERN src/example.ts:1 OpenAI API key");
  });

  it("rejects dynamic code execution and wildcard desktop connections", async () => {
    const root = await fixture("export const run = (value) => eval(value);\n");
    await writeFile(
      join(root, "src-tauri/tauri.conf.json"),
      JSON.stringify({
        app: {
          security: {
            csp: "default-src 'self'; connect-src *"
          }
        }
      })
    );

    await expect(
      scanSourceSecurity({
        files: ["src/example.ts", "src-tauri/tauri.conf.json"],
        root
      })
    ).rejects.toThrow("DYNAMIC_CODE_EXECUTION");
  });
});
