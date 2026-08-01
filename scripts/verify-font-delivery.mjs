#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const root = process.cwd();
const sourcePath = resolve(root, "src/styles/fonts.css");
const tokensPath = resolve(root, "src/styles/tokens.css");
const distPath = resolve(root, "dist");
const privatePatterns = [
  /\/fonts\/claude\//iu,
  /c66fc489e-C-BHYa_K\.ttf/iu,
  /cc27851ad-CFxw3nG7\.ttf/iu,
  /c5dbe0935-B88FVziN\.ttf/iu,
  /Noto(?:Sans|Serif)SC-VariableFont_wght\.ttf/iu,
  /SourceHanSansSC-(?:Regular|Bold)\.otf/iu
];
const fontSuffix = /\.(?:woff2?|ttf|otf)$/iu;

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

const [fontsCss, tokens, distInfo] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(tokensPath, "utf8"),
  stat(distPath)
]);
if (!distInfo.isDirectory()) throw new Error("Production dist directory is missing");

const declarations = fontsCss.replace(/\/\*[\s\S]*?\*\//gu, "");
if (/@font-face/iu.test(declarations) || /url\s*\(/iu.test(declarations)) {
  throw new Error("UI font policy must not declare file-backed font faces");
}
for (const required of [
  '"Anthropic Serif Web Text"',
  '"Anthropic Sans Web Text"',
  '"Anthropic Mono Variable"',
  '"Segoe UI"',
  '"Microsoft YaHei"',
  '"Cascadia Mono"'
]) {
  if (!tokens.includes(required)) throw new Error(`Font fallback stack is missing ${required}`);
}

const files = await collectFiles(distPath);
for (const file of files) {
  const logical = relative(distPath, file).replaceAll("\\", "/");
  if (fontSuffix.test(file) && !basename(file).startsWith("KaTeX_")) {
    throw new Error(`Unexpected non-KaTeX font binary in production output: ${logical}`);
  }
  if (/\.(?:css|html|js)$/iu.test(file)) {
    const content = await readFile(file, "utf8");
    for (const pattern of privatePatterns) {
      if (pattern.test(content)) {
        throw new Error(`Private UI font reference found in production output: ${logical}`);
      }
    }
  }
}

console.log("Font delivery verification passed.");
console.log("UI typography uses system-installed font stacks; packaged fonts are KaTeX-only.");
