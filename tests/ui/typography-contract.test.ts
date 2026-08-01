import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production and development typography contract", () => {
  it("loads one semantic font policy in every frontend mode", async () => {
    const root = process.cwd();
    const [app, fonts, tokens] = await Promise.all([
      readFile(join(root, "src/app/App.tsx"), "utf8"),
      readFile(join(root, "src/styles/fonts.css"), "utf8"),
      readFile(join(root, "src/styles/tokens.css"), "utf8")
    ]);

    expect(app).toContain('import "../styles/fonts.css";');
    expect(app).not.toContain("import.meta.env.DEV");
    const fontDeclarations = fonts.replace(/\/\*[\s\S]*?\*\//gu, "");

    expect(fontDeclarations).not.toMatch(/:root\s*\{/u);
    expect(fontDeclarations).not.toContain("@font-face");
    expect(fontDeclarations).not.toContain("url(");
    expect(fonts).toContain("System-installed font policy");
    expect(tokens).toContain('"Anthropic Serif Web Text"');
    expect(tokens).toContain('"Noto Serif SC"');
    expect(tokens).toContain('"Songti SC"');
    expect(tokens).toContain('"Segoe UI"');
    expect(tokens).toContain('"Microsoft YaHei"');
    expect(tokens).toContain('"Cascadia Mono"');
  });

  it("keeps private binaries outside source delivery while retaining fallbacks", async () => {
    const packageRules = await readFile(
      join(process.cwd(), "scripts/package-rules.mjs"),
      "utf8"
    );

    expect(packageRules).toContain('"public/fonts/claude/"');
    expect(packageRules).toContain("FORBIDDEN_DIRECTORY_PREFIXES");
  });
});
