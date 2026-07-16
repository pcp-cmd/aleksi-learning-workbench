import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readProject = (path: string) => readFile(join(root, path), "utf8");

describe("desktop delivery scripts", () => {
  it("registers real Tauri build, packaging, and verification commands", async () => {
    const packageJson = JSON.parse(await readProject("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["prepare:desktop"]).toContain(
      "scripts/prepare-desktop.mjs"
    );
    expect(packageJson.scripts["build:desktop"]).toContain(
      "tauri build --bundles nsis"
    );
    expect(packageJson.scripts["package:desktop"]).toBe(
      "node scripts/package-desktop.mjs"
    );
    expect(packageJson.scripts["verify:desktop"]).toBe(
      "node scripts/verify-desktop.mjs"
    );
    expect(packageJson.scripts["package:desktop-source"]).toContain(
      "AleksiWorkbench-Desktop-Source-20260716.zip"
    );
    expect(packageJson.scripts["audit:desktop-source"]).toContain(
      "AleksiWorkbench-Desktop-Source-20260716.zip"
    );
  });

  it("rejects generated desktop binaries from source packages", async () => {
    const sourceRules = await readProject("scripts/package-rules.mjs");
    expect(sourceRules).toContain('"src-tauri/target/"');
    expect(sourceRules).toContain('"src-tauri/resources/sidecar/"');
    expect(sourceRules).toContain('"src-tauri/resources/identity.json"');
    expect(sourceRules).not.toContain('"src-tauri/src/"');
  });

  it("requires a real MZ installer plus sidecar identity and hashes", async () => {
    const [prepare, packager, verifier, rules] = await Promise.all([
      readProject("scripts/prepare-desktop.mjs"),
      readProject("scripts/package-desktop.mjs"),
      readProject("scripts/verify-desktop.mjs"),
      readProject("scripts/desktop-package-rules.mjs")
    ]);

    expect(prepare).toContain("process.execPath");
    expect(prepare).toContain('"sidecar/node.exe"');
    expect(prepare).toContain('"sidecar/server.js"');
    expect(prepare).not.toContain("placeholder");
    expect(packager).toContain('installerData[0] !== 0x4d');
    expect(packager).toContain('installerData[1] !== 0x5a');
    expect(packager).toContain('runChecked(npmCommand, ["run", "build:desktop"])');
    expect(verifier).toContain("Desktop resource identity mismatch");
    expect(verifier).toContain("downloadBootstrapper");
    expect(verifier).toContain("currentUser");
    expect(rules).toContain('"artifacts/Aleksi-Workbench-Setup.exe"');
  });

  it("passes a writable app-data library fallback to the desktop sidecar", async () => {
    const runtime = await readProject("src-tauri/src/runtime.rs");

    expect(runtime).toContain('.app_local_data_dir()');
    expect(runtime).toContain('let app_data_library = app_settings_directory.join("library")');
    expect(runtime).toContain('.unwrap_or_else(|_| app_data_library.clone())');
    expect(runtime).toContain('"ALEKSI_APP_DATA_VAULT_PATH"');
    expect(runtime).toContain('&configuration.app_data_library');
  });
});
