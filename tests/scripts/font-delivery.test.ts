import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("font delivery gate", () => {
  it("blocks file-backed private UI fonts while allowing KaTeX math fonts", async () => {
    const source = await readFile(
      join(process.cwd(), "scripts/verify-font-delivery.mjs"),
      "utf8"
    );
    expect(source).toContain("UI font policy must not declare file-backed font faces");
    expect(source).toContain('!basename(file).startsWith("KaTeX_")');
    expect(source).toContain("Private UI font reference found in production output");
  });

  it("runs before desktop resources are prepared", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:fonts"]).toBe(
      "node scripts/verify-font-delivery.mjs"
    );
    expect(packageJson.scripts["prepare:desktop"]).toContain(
      "npm run verify:fonts"
    );
  });
});
