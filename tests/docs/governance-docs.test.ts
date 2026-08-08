import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function doc(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("governance documentation", () => {
  it("keeps the generated current contract synchronized with machine-readable sources", async () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/generate-current-contract.mjs", "--check"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe"
        }
      )
    ).not.toThrow();

    const [contract, identitySource] = await Promise.all([
      doc("docs/current/CURRENT_CONTRACT.md"),
      doc("release/identity.json")
    ]);
    const identity = JSON.parse(identitySource) as {
      displayName: string;
      identifier: string;
      version: string;
    };

    expect(contract).toContain(`# ${identity.displayName} Current Contract`);
    expect(contract).toContain(`| Candidate version | \`${identity.version}\` |`);
    expect(contract).toContain(`| Application identifier | \`${identity.identifier}\` |`);
    expect(contract).toContain("`/motion/overview.json`");
    expect(contract).toContain("20,000 ms");
    expect(contract).toContain("`setSpeed(1)`");
    expect(contract).toContain("`loop: false`");
    expect(contract).toContain("`unsigned-preview`");
    expect(contract).toContain("`downloadBootstrapper`");
    expect(contract).toContain("`/today`");
    expect(contract).toContain("`/verification`");
  });

  it("rejects stale versions in docs/current outside explicitly marked historical tables", async () => {
    const identity = JSON.parse(await doc("release/identity.json")) as {
      version: string;
    };
    const files = (await readdir("docs/current"))
      .filter((name) => name.endsWith(".md"))
      .sort();
    const offenders: string[] = [];
    const startMarker = "<!-- current-contract:historical-table:start -->";
    const endMarker = "<!-- current-contract:historical-table:end -->";
    const historicalTablePattern =
      /<!-- current-contract:historical-table:start -->([\s\S]*?)<!-- current-contract:historical-table:end -->/gu;
    const versionPattern = /\b(?:0\.1\.\d+(?:-[A-Za-z0-9.]+)?|1\.0\.0)\b/gu;

    for (const name of files) {
      const source = await doc(`docs/current/${name}`);
      expect(source.split(startMarker)).toHaveLength(
        source.split(endMarker).length
      );
      for (const match of source.matchAll(historicalTablePattern)) {
        expect(match[1]).toContain("|");
      }
      const currentOnly = source.replace(historicalTablePattern, "");
      for (const match of currentOnly.matchAll(versionPattern)) {
        if (match[0] !== identity.version) {
          offenders.push(`${name}:${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("documents the Danus-inspired verification trust boundary", async () => {
    const [decisions, schema, map] = await Promise.all([
      doc("docs/current/PRODUCT_DECISIONS.md"),
      doc("docs/DATA_SCHEMA.md"),
      doc("docs/current/PROJECT_MAP.md")
    ]);

    expect(decisions).toContain("候选证据");
    expect(decisions).toContain("AI 审查不是形式化证明");
    expect(decisions).toContain("10-Codex任务/验证证据");
    expect(decisions).toContain("qualifiesForMastery");
    expect(decisions).toContain("activeEvidenceIds");
    expect(decisions).toContain("gpt-plus-import");
    expect(decisions).toContain("Revocation propagation is transitive");
    expect(schema).toContain("verification-evidence");
    expect(schema).toContain("verification-verdict");
    expect(schema).toContain("Revocation and knowledge projection");
    expect(schema).toContain("formalProof");
    expect(schema).toContain("trustState");
    expect(schema).toContain("`correct` iff both finding arrays are empty");
    expect(map).toContain("verification-service.ts");
    expect(map).toContain("verification-revocation.ts");
  });

  it("makes README artifact boundaries and docs/current authority explicit", async () => {
    const source = await doc("README.md");

    expect(source).toContain("# Aleksi Workbench 0.1.5-rc.1");
    expect(source).toContain("## 当前发布入口");
    expect(source).toContain("release/identity.json");
    expect(source).toContain(
      "artifacts/release/aleksi-workbench/0.1.5-rc.1/Aleksi-Workbench-0.1.5-rc.1-Setup.exe"
    );
    expect(source).toContain("unsigned-preview");
    expect(source).toContain("源码测试通过，不等于安装器通过");
    expect(source).toContain("GitHub Actions 上传的 artifact 只是候选交付物");
    expect(source).toContain("## Documentation authority");
    expect(source).toContain("`docs/current` 是当前产品、架构、打包与工程纪律的权威入口");
    expect(source).toContain("退役的发布、审计与实施记录位于 `docs/reference/history`");
    expect(source).toContain("以当前证据为准");
  });

  it("publishes one canonical current user path and a non-publishing Windows qualification workflow", async () => {
    const [readme, roadmap, currentContract, workflow] = await Promise.all([
      doc("README.md"),
      doc("docs/current/PACKAGING_ROADMAP.md"),
      doc("docs/current/CURRENT_CONTRACT.md"),
      doc(".github/workflows/windows-qualification.yml")
    ]);
    const canonicalInstaller =
      "artifacts/release/aleksi-workbench/0.1.5-rc.1/Aleksi-Workbench-0.1.5-rc.1-Setup.exe";

    for (const source of [readme, roadmap, currentContract]) {
      expect(source).toContain(canonicalInstaller);
      expect(source).toContain("bundled Node");
      expect(source).toContain("WebView2");
      expect(source).toContain("online-light");
      expect(source).toContain("Visual Studio");
    }
    expect(readme).toContain("用户不需要安装 Node.js");
    expect(readme).toContain("用户不需要安装 Visual Studio");
    expect(roadmap).toContain("缺少 Runtime 且离线");
    expect(currentContract).toContain("unsigned-preview");

    expect(workflow).toContain("runs-on: windows-2022");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("npm.cmd ci --ignore-scripts");
    expect(workflow).toContain("npm.cmd run test");
    expect(workflow).toContain("cargo clippy");
    expect(workflow).toContain('toolchain: "1.97.1"');
    expect(workflow).toContain("npm.cmd run prepare:desktop");
    expect(workflow).toContain("npm.cmd run package:desktop");
    expect(workflow).toContain("npm.cmd run verify:desktop");
    expect(workflow).toContain("npm.cmd run verify:packaged-sidecar");
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(workflow).toContain("release/identity.json");
    expect(workflow).toContain(
      "Join-Path '${{ steps.release.outputs.release_dir }}' $manifest.installer.path"
    );
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("attestations: write");
    expect(workflow).not.toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(workflow).not.toContain("gh release create");
    expect(workflow).not.toContain("action-gh-release");
  });

  it("records only current technical debt and current release boundaries", async () => {
    const source = await doc("docs/current/TECH_DEBT_REGISTER.md");
    expect(source.length).toBeGreaterThan(1200);
    expect(source).toContain("当前非阻断债务");
    expect(source).toContain("TD-P1-004");
    expect(source).toContain("TD-P1-005");
    expect(source).toContain("TD-P2-001");
    expect(source).toContain("TD-P2-003");
    expect(source).toContain("风险");
    expect(source).toContain("状态");
    expect(source).toContain("当前已实现事实");
    expect(source).toContain("当前发布边界");
    expect(source).not.toContain("TD-P0-001");
  });

  it("does not present resolved historical inventory as current debt", async () => {
    const source = await doc("docs/current/TECH_DEBT_REGISTER.md");
    expect(source).not.toContain("## 本轮 all-issues 分支收束清单");
    expect(source).toContain("Card library 已支持分页、搜索、筛选");
    expect(source).toContain("ESLint 已接入");
    expect(source).not.toContain("Card library not complete | Deferred");
    expect(source).not.toContain("ESLint/Biome baseline | DEFERRED");
  });

  it("keeps packaging evidence serial across source, friend runtime, installer, and installed runtime", async () => {
    const source = await doc("docs/current/PACKAGING_ROADMAP.md");

    expect(source.length).toBeGreaterThan(1500);
    expect(source).toContain("已完成基础：V0.2 clean source package");
    expect(source).toContain("Friend Preview Portable Runtime v0.1");
    expect(source).toContain("artifacts/AleksiWorkbench-Preview-win-x64.zip");
    expect(source).toContain("17817-17880");
    expect(source).toContain("当前交付：Windows Desktop Verification Preview");
    expect(source).toContain("下一阶段：Signed Desktop Release");
    expect(source).toContain("artifacts/aleksi-learning-workbench-source.zip");
    expect(source).toContain("artifacts/AleksiWorkbench-Desktop-Source-20260716.zip");
    expect(source).toContain("artifacts/Aleksi-Workbench-Setup.exe");
    expect(source).toContain("friend preview runtime");
    expect(source).toContain("runtime package 只能证明该便携包");
    expect(source).toContain("clean source 通过不等于 runtime、installer 或 installed runtime 通过");
    expect(source).toContain("private fonts are excluded from source package");
  });

  it("documents private font boundaries for source and future runtime packages", async () => {
    const source = await doc("docs/current/FONT_USAGE_POLICY.md");

    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("worktree/private-local");
    expect(source).toContain("允许 public/fonts/claude 存在");
    expect(source).toContain("source package");
    expect(source).toContain("默认排除 public/fonts/claude");
    expect(source).toContain("runtime private build");
    expect(source).toContain("必须显式 private mode");
    expect(source).toContain("public/open-source/runtime");
    expect(source).toContain("禁止包含，除非授权确认");
    expect(source).toContain("copy-claude-fonts");
    expect(source).toContain("只从用户提供的本地路径复制");
    expect(source).toContain("不下载字体");
    expect(source).toContain("不要删除用户本地私用字体");
    expect(source).toContain("不要让 source package 带字体");
  });
});
