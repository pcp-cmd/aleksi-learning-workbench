import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function doc(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("governance documentation", () => {
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

    expect(source).toContain("## Current artifact types");
    expect(source).toContain("Windows 安装包（当前桌面交付）");
    expect(source).toContain("artifacts/Aleksi-Workbench-Setup.exe");
    expect(source).toContain("桌面源码包（当前复现交付）");
    expect(source).toContain("artifacts/AleksiWorkbench-Desktop-Source-20260716.zip");
    expect(source).toContain("artifacts/aleksi-learning-workbench-source.zip");
    expect(source).toContain("friend preview portable runtime");
    expect(source).toContain("artifacts/AleksiWorkbench-Preview-win-x64.zip");
    expect(source).toContain("Start Aleksi Workbench.cmd");
    expect(source).toContain("不要手工压缩整个项目目录");
    expect(source).toContain("worktree snapshot：只用于诊断");
    expect(source).toContain("它不是安装器，也不能替代桌面验证");
    expect(source).toContain("Tauri 2 生成的 per-user NSIS 安装包");
    expect(source).toContain("## Documentation authority");
    expect(source).toContain("`docs/current` 是当前产品、架构、打包与工程纪律的权威入口");
    expect(source).toContain("旧计划只提供实施来源与历史上下文");
    expect(source).toContain("以当前文档和可运行测试为准");
  });

  it("records all clean-base P0/P1 debt with required fields", async () => {
    const source = await doc("docs/current/TECH_DEBT_REGISTER.md");
    const ids = [
      "TD-P0-001",
      "TD-P0-002",
      "TD-P0-003",
      "TD-P0-004",
      "TD-P0-005",
      "TD-P0-006",
      "TD-P1-001",
      "TD-P1-002",
      "TD-P1-003",
      "TD-P1-004",
      "TD-P1-005",
      "TD-P1-006",
      "TD-P1-007",
      "TD-P1-008",
      "TD-P1-009",
      "TD-P1-010"
    ];

    expect(source.length).toBeGreaterThan(3000);
    expect(source).toContain("P0：阻断交付的问题");
    expect(source).toContain("P1：必须治理但可排期的问题");
    expect(source).toContain("P2：可后置的问题");
    expect(source).toContain("风险");
    expect(source).toContain("处理方案");
    expect(source).toContain("验收标准");
    expect(source).toContain("状态");
    expect(source).toContain("相关文件");

    for (const id of ids) {
      expect(source).toContain(id);
    }
  });

  it("records the all-issues branch fixed/deferred status inventory", async () => {
    const source = await doc("docs/current/TECH_DEBT_REGISTER.md");
    const inventoryItems = [
      "Test cross-platform path issue",
      "Listener timeout risk",
      "health:source not in verify",
      "PowerShell UTF-8 guard",
      "demo-vault-template Chinese path",
      "demo reading frontmatter",
      "Settings hard-coded pcp path",
      "README path mismatch",
      "Today recent card API shape mismatch",
      "Today recent reading sorting",
      "Cards empty direct save",
      "Fake reference save",
      "Ambiguous 我的理解",
      "Absolute path in primary UI",
      "View card not using detail data",
      "Card library not complete",
      "Reader path exposure",
      "Reader responsive layout",
      "Excerpt basket limited card type",
      "sessionStorage temporary basket",
      "selection popover overflow",
      "selection popover ARIA",
      "Review legacy field mismatch",
      "components.css scope debt",
      ".claude-card semantic debt",
      "stale APP_ROUTES copy",
      "private fonts warning / local copy helper",
      "Friend preview runtime boundary",
      "non-JSON API error handling",
      "Express JSON limit"
    ];

    expect(source).toContain("## 本轮 all-issues 分支收束清单");
    expect(source).toContain("Fixed");
    expect(source).toContain("Deferred");
    expect(source).not.toContain("Partially fixed");

    for (const item of inventoryItems) {
      expect(source).toContain(item);
    }
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
