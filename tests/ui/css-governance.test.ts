import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function cssFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return cssFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
    })
  );
  return nested.flat().sort();
}

describe("desktop CSS governance", () => {
  it("forces the approved light color scheme for native controls", async () => {
    const base = await readFile(
      join(process.cwd(), "src/styles/base.css"),
      "utf8"
    );

    expect(base).toMatch(/html\s*\{[^}]*color-scheme:\s*light;/su);
    expect(base).not.toContain("prefers-color-scheme: dark");
  });

  it("governs every production CSS file with one responsive contract and no override or private-font leakage", async () => {
    const root = process.cwd();
    const paths = await cssFiles(join(root, "src"));
    const sources = await Promise.all(
      paths.map(async (path) => ({
        path,
        source: await readFile(path, "utf8")
      }))
    );
    const combined = sources.map(({ source }) => source).join("\n");
    const breakpoints = Array.from(
      combined.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/gu),
      (match) => Number(match[1])
    );

    expect(paths.length).toBeGreaterThan(0);
    expect(combined).not.toContain("!important");
    expect(new Set(breakpoints)).toEqual(new Set([560, 768, 1024]));
    expect(
      sources.map(({ path }) => path.replaceAll("\\", "/"))
    ).not.toContain(`${root.replaceAll("\\", "/")}/src/styles/overrides.css`);
    for (const { source } of sources) {
      expect(source).not.toMatch(/@font-face/u);
    }
  });

  it("keeps all five primary modules visible in the narrow navigation contract", async () => {
    const root = process.cwd();
    const [workbench, navigation, app, main, markdown] = await Promise.all([
      readFile(join(root, "src/styles/workbench.css"), "utf8"),
      readFile(join(root, "src/components/NavigationRail.tsx"), "utf8"),
      readFile(join(root, "src/app/App.tsx"), "utf8"),
      readFile(join(root, "src/main.tsx"), "utf8"),
      readFile(join(root, "src/markdown/MarkdownRenderer.tsx"), "utf8")
    ]);

    expect(workbench).toContain("repeat(5, minmax(0, 1fr))");
    expect(navigation).toContain("routes.map");
    expect(navigation).toContain('aria-hidden="true">A</span>');
    expect(app).not.toContain("MarkdownTheme.css");
    expect(main).not.toContain("katex.min.css");
    expect(markdown).toContain('import "katex/dist/katex.min.css";');
    expect(markdown).toContain('import "./MarkdownTheme.css";');
  });
});
