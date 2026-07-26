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
    expect(packageJson.scripts["verify:uninstall-reinstall"]).toContain(
      "scripts/verify-uninstall-reinstall.ps1"
    );
    expect(packageJson.scripts["package:desktop-source"]).toContain(
      "Aleksi-Learning-Workbench-Source-0.1.3-Final.zip"
    );
    expect(packageJson.scripts["audit:desktop-source"]).toContain(
      "Aleksi-Learning-Workbench-Source-0.1.3-Final.zip"
    );
  });

  it("rejects generated desktop binaries from source packages", async () => {
    const [sourceRules, sourceVerifier] = await Promise.all([
      readProject("scripts/package-rules.mjs"),
      readProject("scripts/verify-desktop-source.mjs")
    ]);
    expect(sourceRules).toContain('"src-tauri/target/"');
    expect(sourceRules).toContain('"outputs/"');
    expect(sourceRules).toContain('"src-tauri/resources/sidecar/"');
    expect(sourceRules).toContain('"src-tauri/resources/identity.json"');
    expect(sourceRules).not.toContain('"src-tauri/src/"');
    const requiredSourceList = sourceVerifier.slice(
      0,
      sourceVerifier.indexOf("for (const path")
    );
    expect(requiredSourceList).not.toContain("src-tauri/resources/identity.json");
    expect(requiredSourceList).not.toContain("src-tauri/resources/sidecar/node.exe");
    expect(requiredSourceList).not.toContain("src-tauri/resources/sidecar/server.cjs");
    expect(sourceVerifier).toContain(
      "Generated resources are intentionally verified only after prepare:desktop."
    );
  });

  it("requires a real MZ installer plus sidecar identity and hashes", async () => {
    const [prepare, packager, verifier, rules] = await Promise.all([
      readProject("scripts/prepare-desktop.mjs"),
      readProject("scripts/package-desktop.mjs"),
      readProject("scripts/verify-desktop.mjs"),
      readProject("scripts/desktop-package-rules.mjs")
    ]);

    expect(prepare).toContain("process.execPath");
    expect(prepare).toContain("ALEKSI_NODE_RUNTIME_PATH");
    expect(prepare).toContain("releaseIdentity.nodeRuntime.sha256");
    expect(prepare).toContain("releaseIdentity.nodeRuntime.version");
    expect(prepare).toContain('"sidecar/node.exe"');
    expect(prepare).toContain('"sidecar/server.cjs"');
    expect(prepare).toContain(
      "protocolVersion: releaseIdentity.localProtocolVersion"
    );
    expect(prepare).toContain("shellBuildId:");
    expect(prepare).toContain("sidecarBuildId:");
    expect(prepare).toContain("assertNoLinkAncestors");
    expect(prepare).toContain("assertNoLinksInTree");
    expect(prepare).toContain("contains a symbolic-link or junction ancestor");
    expect(prepare.indexOf("await assertNoLinkAncestors(")).toBeLessThan(
      prepare.indexOf("await rm(sidecarDirectory")
    );
    expect(prepare).not.toContain("placeholder");
    expect(packager).toContain('installerData[0] !== 0x4d');
    expect(packager).toContain('installerData[1] !== 0x5a');
    expect(packager).toContain('runChecked(npmCommand, ["run", "build:desktop"])');
    expect(packager).toContain("protocolVersion: identity.protocolVersion");
    expect(packager).toContain("shellBuildId: identity.shellBuildId");
    expect(packager).toContain("sidecarBuildId: identity.sidecarBuildId");
    expect(verifier).toContain("Desktop resource identity mismatch");
    expect(verifier).toContain("productionRustSource");
    expect(verifier).toContain("inspectInstallerMetadata");
    expect(verifier).toContain('"authenticodeStatus", "NotSigned"');
    expect(verifier).toContain('"peMachine", "I386"');
    expect(verifier).toContain("identity.protocolVersion !== 1");
    expect(verifier).toContain("downloadBootstrapper");
    expect(verifier).toContain("currentUser");
    expect(verifier).toContain('"ALEKSI_DESKTOP_PARENT_PID"');
    expect(rules).toContain("releaseIdentity.releaseDirectory");
    expect(rules).toContain("releaseIdentity.installerFilename");
  });

  it("verifies installed lifecycle without bypassing protocol authentication or deleting user data", async () => {
    const [installedVerifier, restoreVerifier, uninstallVerifier] = await Promise.all([
      readProject("scripts/verify-installed-desktop.ps1"),
      readProject("scripts/restore-verified-user-data-backup.ps1"),
      readProject("scripts/verify-uninstall-reinstall.ps1")
    ]);

    expect(installedVerifier).toContain("Assert-UserDataUnchanged");
    expect(installedVerifier).toContain("New-VerifiedPreUpgradeBackup");
    expect(installedVerifier).toContain("pre-upgrade-user-data-backup-");
    expect(installedVerifier).toContain("$script:MaxBackupFiles");
    expect(installedVerifier).toContain("$script:MaxBackupBytes");
    expect(installedVerifier).toContain("AvailableFreeSpace");
    expect(installedVerifier).toContain("Assert-PredecessorInstallationRestored");
    expect(installedVerifier).toContain(
      "restore-verified-user-data-backup.ps1"
    );
    expect(installedVerifier).toContain("predecessor restored=$applicationRestored");
    expect(installedVerifier).toContain("[string]$ManifestPath");
    expect(installedVerifier).toContain("[string]$PredecessorInstallerPath");
    expect(installedVerifier).toContain("[string]$CanonicalIdentityPath");
    expect(installedVerifier).toContain(
      "IsNullOrWhiteSpace($CanonicalIdentityPath)"
    );
    expect(installedVerifier).toContain("Get-PeMachine");
    expect(installedVerifier).toContain("Assert-UnsignedPe");
    expect(installedVerifier).toContain("build-provenance.json");
    expect(installedVerifier).toContain("manifest.installer.sha256");
    expect(installedVerifier).toContain("canonical.upgradeFromVersion");
    expect(installedVerifier).toContain(
      "canonical.upgradeFrom.installerSha256"
    );
    expect(installedVerifier).toContain(
      "canonical.upgradeFrom.installedExecutableSha256"
    );
    expect(installedVerifier).toContain("actualArtifactPaths");
    expect(installedVerifier).toContain("Assert-SingleInstance");
    expect(installedVerifier).toContain("Assert-NoProtocolSecretTrace");
    expect(installedVerifier).toContain("Get-SidecarFailureContext");
    expect(installedVerifier).toContain("Test-LoopbackPort");
    expect(installedVerifier).toContain("$AppProcess.CloseMainWindow()");
    expect(installedVerifier).toContain("Complete-NormalWindowClose");
    expect(installedVerifier).not.toContain("WScript.Shell");
    expect(installedVerifier).not.toContain("Ctrl+Q fallback");
    expect(installedVerifier).toContain(
      "userDataAfterRuntimeRecovery"
    );
    expect(installedVerifier).toContain("Wait-ForPortClosed");
    expect(installedVerifier).toContain("Start-And-VerifyForcedShellTermination");
    expect(installedVerifier).toContain("Wait-ForProcessesAtPathAbsent");
    expect(installedVerifier).toContain("$sidecars.Count -ne 1");
    expect(installedVerifier).toContain("uninstallerSha256");
    expect(installedVerifier).toContain("Assert-RegularFileNoReparse");
    expect(installedVerifier).toContain(
      "apiVerification = 'delegated-to-isolated-packaged-sidecar-gate'"
    );
    expect(installedVerifier).not.toContain("Invoke-RestMethod");
    expect(installedVerifier).not.toContain("Invoke-WebRequest");
    expect(installedVerifier).not.toContain("Remove-Item");
    expect(installedVerifier).not.toContain("http://127.0.0.1:");
    expect(installedVerifier).not.toContain("/api/");
    expect(restoreVerifier).toContain("Assert-ExactPath");
    expect(restoreVerifier).toContain("Assert-NoReparseAncestors");
    expect(restoreVerifier).toContain("Assert-Inventory");
    expect(restoreVerifier).toContain(
      "Remove-Item -LiteralPath $target -Recurse -Force"
    );
    expect(uninstallVerifier).toContain("Assert-FingerprintsEqual");
    expect(uninstallVerifier).toContain(
      "uninstall-reinstall-evidence.json"
    );
    expect(uninstallVerifier).toContain("uninstall-test-report.md");
    expect(uninstallVerifier).toContain("Wait-ForProcessesAtPathAbsent");
    expect(uninstallVerifier).toContain("Assert-VerifiedUninstaller");
    expect(uninstallVerifier).not.toContain("WScript.Shell");
    expect(uninstallVerifier).not.toContain("Ctrl+Q fallback");
    expect(uninstallVerifier).toContain("$script:MaxBackupFiles");
    expect(uninstallVerifier).toContain("$script:BackupFreeSpaceReserveBytes");
    expect(uninstallVerifier).toContain("Assert-NoReparseAncestors");
    expect(uninstallVerifier).toContain("Restore-VerifiedBackupSnapshot");
    expect(uninstallVerifier).toContain(
      "Post-runtime verified backup recovery"
    );
    expect(uninstallVerifier).toContain(
      "IsNullOrWhiteSpace($CanonicalIdentityPath)"
    );
    expect(uninstallVerifier).toContain(
      "normalWindowCloseStopsSidecar = $true"
    );
    expect(uninstallVerifier).not.toContain("Invoke-RestMethod");
    expect(uninstallVerifier).not.toContain("Invoke-WebRequest");
  });

  it("passes a writable app-data library fallback to the desktop sidecar", async () => {
    const runtime = await readProject("src-tauri/src/runtime.rs");

    expect(runtime).toContain('.app_local_data_dir()');
    expect(runtime).toContain('let app_data_library = app_settings_directory.join("library")');
    expect(runtime).toContain('.unwrap_or_else(|_| app_data_library.clone())');
    expect(runtime).toContain('"ALEKSI_APP_DATA_VAULT_PATH"');
    expect(runtime).toContain('&configuration.app_data_library');
  });

  it("binds the sidecar lifetime to the desktop shell and enforces readiness", async () => {
    const [cargo, runtime, commands, runtimeConfig, server, lifecycle] = await Promise.all([
      readProject("src-tauri/Cargo.toml"),
      readProject("src-tauri/src/runtime.rs"),
      readProject("src-tauri/src/commands.rs"),
      readProject("server/runtime-config.ts"),
      readProject("server/start-server.ts"),
      readProject("server/runtime/lifecycle.ts")
    ]);

    expect(cargo).toContain('"Win32_System_JobObjects"');
    expect(runtime).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
    expect(runtime).toContain("AssignProcessToJobObject");
    expect(runtime).toContain("SIDECAR_READINESS_TIMEOUT");
    expect(runtime).toContain("SIDECAR_TERMINATION_POLLS");
    expect(runtime).toContain("expire_starting_generation");
    expect(runtime).toContain('"ALEKSI_DESKTOP_PARENT_PID"');
    expect(runtimeConfig).toContain("ALEKSI_DESKTOP_PARENT_PID");
    expect(server).toContain("startDesktopParentWatchdog");
    expect(server).toContain(
      "ALEKSI_DESKTOP_PARENT_PID does not match the direct desktop shell parent"
    );
    expect(commands).toContain("GetWindowsDirectoryW");
    expect(commands).toContain("windows_explorer_path()?");
    expect(commands).not.toContain('Command::new("explorer.exe")');
    expect(lifecycle).toContain('join(systemRoot, "explorer.exe")');
    expect(lifecycle).not.toContain('spawn("explorer.exe"');
  });

  it("allows the embedded desktop frontend to fetch its bundled overview animation", async () => {
    const [configSource, glyph, motion] = await Promise.all([
      readProject("src-tauri/tauri.conf.json"),
      readProject("src/features/entrance/OverviewGlyph.tsx"),
      readProject("public/motion/overview.json")
    ]);
    const config = JSON.parse(configSource) as {
      app: { security: { csp: string } };
    };
    const connectSource = config.app.security.csp.match(
      /(?:^|;)\s*connect-src\s+([^;]+)/u
    )?.[1];
    const motionData = JSON.parse(motion) as {
      fr: number;
      ip: number;
      op: number;
    };
    const sourceDurationMs =
      ((motionData.op - motionData.ip) / motionData.fr) * 1_000;

    expect(connectSource?.split(/\s+/u)).toContain("'self'");
    expect(glyph).toContain('const OVERVIEW_MOTION_PATH = "/motion/overview.json"');
    expect(glyph).toContain("animation.setSpeed(1)");
    expect(sourceDurationMs).toBe(20_000);
    expect(motion.length).toBeGreaterThan(2_000_000);
  });

  it("keeps one desktop instance, restores window geometry, and enforces the minimum window", async () => {
    const [cargo, shell, config, app] = await Promise.all([
      readProject("src-tauri/Cargo.toml"),
      readProject("src-tauri/src/lib.rs"),
      readProject("src-tauri/tauri.conf.json"),
      readProject("src/app/App.tsx")
    ]);
    const tauriConfig = JSON.parse(config) as {
      app: { windows: Array<{ minWidth: number; minHeight: number }> };
    };

    expect(cargo).toContain('tauri-plugin-single-instance = "2"');
    expect(cargo).toContain('tauri-plugin-window-state = "2"');
    expect(shell).toContain("tauri_plugin_single_instance::init");
    expect(shell).toContain("window.unminimize()");
    expect(shell).toContain("window.show()");
    expect(shell).toContain("window.set_focus()");
    expect(shell).toContain("tauri_plugin_window_state::Builder::default().build()");
    expect(tauriConfig.app.windows[0]).toMatchObject({ minWidth: 960, minHeight: 680 });
    expect(app).toContain("readLastSafeRoute(window.localStorage)");
    expect(app).toContain("writeLastSafeRoute(window.localStorage");
  });
});
