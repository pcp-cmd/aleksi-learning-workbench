export const READING_IMPORT_ACCEPT = ".md,.markdown,.txt";
export const READING_IMPORT_WARNING_BYTES = 1024 * 1024;

const SUPPORTED_READING_EXTENSION = /\.(?:md|markdown|txt)$/iu;

export type ReadingImportResult = {
  body: string;
  fileName: string;
  size: number;
  titleSuggestion: string;
  warning: string | null;
};

function fileStem(fileName: string): string {
  return fileName.replace(SUPPORTED_READING_EXTENSION, "").trim();
}

export function isSupportedReadingFile(fileName: string): boolean {
  return SUPPORTED_READING_EXTENSION.test(fileName.trim());
}

export function normalizeReadingImport(input: {
  body: string;
  fileName: string;
  size: number;
}): ReadingImportResult {
  if (!isSupportedReadingFile(input.fileName)) {
    throw new Error("只支持 .md、.markdown 或 .txt 文件");
  }

  const body = input.body.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  if (body.trim().length === 0) {
    throw new Error("文件中没有可导入的文本内容");
  }
  if (body.includes("\u0000")) {
    throw new Error("文件包含不受支持的空字符，请清理后再导入");
  }

  return {
    body,
    fileName: input.fileName,
    size: input.size,
    titleSuggestion: fileStem(input.fileName) || "未命名材料",
    warning:
      input.size > READING_IMPORT_WARNING_BYTES
        ? `文件大小为 ${(input.size / 1024 / 1024).toFixed(1)} MB，保存和渲染可能需要更长时间。`
        : null
  };
}

export async function decodeReadingFile(file: File): Promise<ReadingImportResult> {
  if (!isSupportedReadingFile(file.name)) {
    throw new Error("只支持 .md、.markdown 或 .txt 文件");
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error("文件不是有效的 UTF-8 文本，请先转换编码后再导入");
  }

  return normalizeReadingImport({
    body: decoded,
    fileName: file.name,
    size: file.size
  });
}
