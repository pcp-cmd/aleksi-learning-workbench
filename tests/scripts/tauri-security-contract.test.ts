import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMMANDS = [
  "desktop_runtime_snapshot",
  "export_diagnostics",
  "force_exit",
  "open_learning_library",
  "read_selected_reading_part",
  "request_exit",
  "restart_sidecar",
  "select_learning_library",
  "select_reading_file"
] as const;

const PERMISSIONS = COMMANDS.map((command) =>
  `allow-${command.replaceAll("_", "-")}`
).concat([
  "core:event:allow-listen",
  "core:event:allow-unlisten"
]).sort();

describe("Tauri production security contract", () => {
  it("allowlists only the application commands used by the main window", async () => {
    const root = process.cwd();
    const [buildScript, capability, rustCommands] = await Promise.all([
      readFile(join(root, "src-tauri/build.rs"), "utf8"),
      readFile(join(root, "src-tauri/capabilities/default.json"), "utf8").then(
        (source) => JSON.parse(source) as { permissions: string[] }
      ),
      readFile(join(root, "src-tauri/src/lib.rs"), "utf8")
    ]);

    expect([...capability.permissions].sort()).toEqual(PERMISSIONS);
    expect(capability.permissions).not.toContain("core:default");
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:event:allow-listen",
        "core:event:allow-unlisten"
      ])
    );
    expect(buildScript).toContain("tauri_build::AppManifest::new()");
    for (const command of COMMANDS) {
      expect(buildScript).toContain(`\"${command}\"`);
      expect(rustCommands).toContain(command);
    }
  });

  it("excludes development hosts while preserving required production sources", async () => {
    const config = JSON.parse(
      await readFile(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")
    ) as { app: { security: { csp: string } } };
    const csp = config.app.security.csp;

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' ipc: http://127.0.0.1:*");
    expect(csp).not.toContain("http://localhost");
    expect(csp).not.toContain("127.0.0.1:5173");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).not.toContain("img-src 'self' asset:");
    expect(csp).not.toMatch(/img-src[^;]*http:\/\/127\.0\.0\.1/u);
  });
});
