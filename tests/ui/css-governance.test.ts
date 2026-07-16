import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTIVE_CSS = [
  "src/styles/tokens.css",
  "src/styles/base.css",
  "src/styles/primitives.css",
  "src/styles/components.css",
  "src/styles/workbench.css",
  "src/features/reader/reader.css",
  "src/features/cards/cards.css",
  "src/features/graph/flywheel.css",
  "src/markdown/MarkdownTheme.css"
];

describe("desktop CSS governance", () => {
  it("uses one responsive contract with no override or private-font leakage", async () => {
    const root = process.cwd();
    const sources = await Promise.all(
      ACTIVE_CSS.map(async (path) => ({
        path,
        source: await readFile(join(root, path), "utf8")
      }))
    );
    const combined = sources.map(({ source }) => source).join("\n");
    const breakpoints = Array.from(
      combined.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/gu),
      (match) => Number(match[1])
    );

    expect(combined).not.toContain("!important");
    expect(new Set(breakpoints)).toEqual(new Set([560, 768, 1024]));
    expect(sources.map(({ path }) => path)).not.toContain(
      "src/styles/overrides.css"
    );
    expect(sources.find(({ path }) => path.endsWith("tokens.css"))?.source).not.toMatch(
      /@font-face/u
    );
  });

  it("keeps all five primary modules visible in the narrow navigation contract", async () => {
    const root = process.cwd();
    const [workbench, navigation, brand, app, main, markdown] = await Promise.all([
      readFile(join(root, "src/styles/workbench.css"), "utf8"),
      readFile(join(root, "src/components/NavigationRail.tsx"), "utf8"),
      readFile(join(root, "src/components/FlywheelBrandMark.tsx"), "utf8"),
      readFile(join(root, "src/app/App.tsx"), "utf8"),
      readFile(join(root, "src/main.tsx"), "utf8"),
      readFile(join(root, "src/markdown/MarkdownRenderer.tsx"), "utf8")
    ]);

    expect(workbench).toContain("repeat(5, minmax(0, 1fr))");
    expect(navigation).toContain("routes.map");
    expect(brand).toContain("NODES.map");
    expect(brand).not.toContain(">A<");
    expect(app).not.toContain("MarkdownTheme.css");
    expect(main).not.toContain("katex.min.css");
    expect(markdown).toContain('import "katex/dist/katex.min.css";');
    expect(markdown).toContain('import "./MarkdownTheme.css";');
  });
});
