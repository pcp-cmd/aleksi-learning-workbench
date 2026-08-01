#!/usr/bin/env node
import { copyFile, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_FONT_FILES = [
  "c66fc489e-C-BHYa_K.ttf",
  "cc27851ad-CFxw3nG7.ttf",
  "c5dbe0935-B88FVziN.ttf",
  "NotoSerifSC-VariableFont_wght.ttf",
  "NotoSansSC-VariableFont_wght.ttf",
  "SourceHanSansSC-Regular.otf",
  "SourceHanSansSC-Bold.otf"
];

async function assertFile(path) {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`Expected a font file: ${path}`);
  }
}

export async function copyClaudeFonts(sourceDirectoryInput, projectRoot = process.cwd()) {
  if (!sourceDirectoryInput) {
    throw new Error("Usage: node scripts/copy-claude-fonts.mjs <local-font-directory>");
  }

  const sourceDirectory = resolve(sourceDirectoryInput);
  const targetDirectory = resolve(projectRoot, "public", "fonts", "claude");

  for (const filename of REQUIRED_FONT_FILES) {
    await assertFile(resolve(sourceDirectory, filename));
  }

  await mkdir(targetDirectory, { recursive: true });

  for (const filename of REQUIRED_FONT_FILES) {
    await copyFile(resolve(sourceDirectory, filename), resolve(targetDirectory, filename));
  }

  return {
    count: REQUIRED_FONT_FILES.length,
    targetDirectory
  };
}

async function main() {
  try {
    const result = await copyClaudeFonts(process.argv[2]);
    console.log(`Copied ${result.count} Claude font files to public/fonts/claude`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
