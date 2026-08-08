import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readProject = (path: string) => readFile(join(root, path), "utf8");

const WORKFLOW_PATHS = [
  ".github/workflows/ci.yml",
  ".github/workflows/windows-qualification.yml",
  ".github/workflows/scheduled-health.yml",
  ".github/workflows/stable-release.yml"
] as const;

describe("archival release workflow contract", () => {
  it("keeps CI, Windows qualification, scheduled health, and stable publication separate", async () => {
    const workflows = await Promise.all(WORKFLOW_PATHS.map(readProject));

    for (const workflow of workflows) {
      expect(workflow).not.toContain("pull_request_target:");
      const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map(
        (match) => match[1]
      );
      expect(uses.every((value) => {
        return (
          value.startsWith("./.github/workflows/") ||
          /@[0-9a-f]{40}$/u.test(value)
        );
      })).toBe(true);
    }
  });

  it("runs source and supply-chain gates without exposing release secrets", async () => {
    const workflow = await readProject(".github/workflows/ci.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).toContain("npm ci --ignore-scripts");
    expect(workflow).toContain("node scripts/verify-release-identity.mjs");
    expect(workflow).toContain("npm run audit:release");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run architecture");
    expect(workflow).toContain("npm run test:coverage");
    expect(workflow).toContain("npm run test:browser:production");
    expect(workflow).toContain("npm run scan:source-security");
    expect(workflow).toContain("npm run package:desktop-source");
    expect(workflow).toContain("npm run audit:desktop-source");
    expect(workflow).not.toContain("actions/dependency-review-action@");
  });

  it("qualifies an unsigned RC on a clean Windows runner with durable predecessor and recovery evidence", async () => {
    const workflow = await readProject(
      ".github/workflows/windows-qualification.yml"
    );

    expect(workflow).toContain("workflow_call:");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow).toContain("runs-on: windows-2022");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).toContain("PREDECESSOR_RELEASE_TAG: v0.1.4");
    expect(workflow).toContain("gh release download");
    expect(workflow).not.toContain("actions/artifacts/");
    expect(workflow).toContain("cargo fmt");
    expect(workflow).toContain("cargo check");
    expect(workflow).toContain("cargo clippy");
    expect(workflow).toContain("cargo test");
    expect(workflow).toContain("npm.cmd run prepare:desktop");
    expect(workflow).toContain("npm.cmd run test:coverage");
    expect(workflow).toContain("Unexpected source drift after prepare:desktop");
    expect(workflow).toContain("Unexpected source drift after package:desktop");
    expect(workflow).toContain("npm.cmd run package:desktop");
    expect(workflow).toContain("npm.cmd run verify:desktop");
    expect(workflow).toContain("verify-installed-desktop.ps1");
    expect(workflow).toContain("verify-uninstall-reinstall.ps1");
    expect(workflow).toContain(
      "tests/scripts/backup-restore-drill.test.ts"
    );
    expect(workflow).toContain("npm.cmd run verify:release-manifest");
    expect(workflow).toContain("installed-desktop-evidence.json");
    expect(workflow).toContain("uninstall-reinstall-evidence.json");
    expect(workflow).toContain("restore-drill-report");
    expect(workflow).toContain("retention-days: 30");
    expect(workflow).not.toContain("gh release create");
  });

  it("keeps quick and compatibility Windows installers manual-only", async () => {
    const [quick, compatibility] = await Promise.all([
      readProject(".github/workflows/quick-windows-installer.yml"),
      readProject(".github/workflows/build-current-windows-installer.yml")
    ]);

    for (const workflow of [quick, compatibility]) {
      expect(workflow).toContain("workflow_dispatch:");
      expect(workflow).not.toMatch(/^\s{2}push:/mu);
    }
    expect(quick).toContain("UNQUALIFIED / DEBUG ONLY / NOT FOR RELEASE");
    expect(compatibility).toContain(
      "uses: ./.github/workflows/windows-qualification.yml"
    );
  });

  it("runs periodic synthetic checks and opens an issue only after a scheduled failure", async () => {
    const workflow = await readProject(".github/workflows/scheduled-health.yml");

    expect(workflow).toContain("cron: \"");
    expect(workflow).toContain("weekly-source-health");
    expect(workflow).toContain("monthly-windows-health");
    expect(workflow).toContain("quarterly-predecessor-upgrade");
    expect(workflow).toContain(
      "uses: ./.github/workflows/windows-qualification.yml"
    );
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("gh issue create");
    expect(workflow).toContain("synthetic");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("USERPROFILE");
    expect(workflow).not.toContain("LOCALAPPDATA");
  });

  it("publishes stable assets only for the exact protected tag after approval, signing, and evidence verification", async () => {
    const workflow = await readProject(".github/workflows/stable-release.yml");

    expect(workflow).toContain('tags: ["v1.0.0"]');
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("environment: stable-release");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("attestations: write");
    expect(workflow).toContain("secrets.WINDOWS_SIGNING_CERTIFICATE_BASE64");
    expect(workflow).toContain("secrets.WINDOWS_SIGNING_CERTIFICATE_PASSWORD");
    expect(workflow).toContain("scripts/sign-windows-release.ps1");
    expect(workflow).toContain("scripts/verify-authenticode-release.ps1");
    expect(workflow).toContain("release/evidence/SOAK_REPORT.json");
    expect(workflow).toContain("release/evidence/P0_P1_CLOSURE.md");
    expect(workflow).toContain("npm.cmd run verify:release-manifest");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--verify-tag");
    expect(workflow).toContain("actions/attest-build-provenance@");
    expect(workflow).not.toContain("unsigned-preview");
  });

  it("publishes a strict release-manifest schema and verifier", async () => {
    const [schemaSource, verifier, packageSource] = await Promise.all([
      readProject("release/release-manifest.schema.json"),
      readProject("scripts/verify-release-manifest.mjs"),
      readProject("package.json")
    ]);
    const schema = JSON.parse(schemaSource) as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining([
      "schemaVersion",
      "version",
      "commit",
      "signingStatus",
      "installerStatus",
      "artifacts"
    ]));
    expect(schema.properties).toHaveProperty("installer");
    expect(schema.properties).toHaveProperty("webView2");
    expect(verifier).toContain("release/release-manifest.schema.json");
    expect(verifier).toContain("release/identity.json");
    expect(verifier).toContain("artifact hash");
    expect(packageJson.scripts["verify:release-manifest"]).toBe(
      "node scripts/verify-release-manifest.mjs"
    );
  });
});
