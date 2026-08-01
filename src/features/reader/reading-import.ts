import { DOCUMENT_IMPORT_PREVIEW_BYTES } from "../../../shared/document-limits";

export const READING_IMPORT_ACCEPT = ".md,.markdown,.txt";
export const READING_IMPORT_WARNING_BYTES = 1024 * 1024;

const SUPPORTED_READING_EXTENSION = /\.(?:md|markdown|txt)$/iu;

export type ReadingImportResult = {
  fileName: string;
  size: number;
  preview: string;
  titleSuggestion: string;
  warning: string | null;
};

function fileStem(fileName: string): string {
  return fileName.replace(SUPPORTED_READING_EXTENSION, "").trim();
}

function stripMarkdownHeading(value: string): string {
  return value.replace(/^#{1,6}\s*/u, "").replace(/[*_`[\]()]/gu, "").trim();
}

function titleFromPreview(preview: string, fileName: string): string {
  const firstLine = preview
    .split(/\r?\n/u)
    .map(stripMarkdownHeading)
    .find((line) => line.length > 0);
  const title = fileStem(fileName) || firstLine || "未命名材料";
  return title.length > 60 ? `${title.slice(0, 60)}…` : title;
}

export function isSupportedReadingFile(fileName: string): boolean {
  return SUPPORTED_READING_EXTENSION.test(fileName.trim());
}

export function normalizeReadingImport(input: {
  preview: string;
  fileName: string;
  size: number;
}): ReadingImportResult {
  if (!isSupportedReadingFile(input.fileName)) {
    throw new Error("只支持 .md、.markdown 或 .txt 文件");
  }
  const preview = input.preview.replace(/^\uFEFF/u, "");
  if (input.size <= 0 || preview.trim().length === 0) {
    throw new Error("文件中没有可导入的文本内容");
  }
  if (preview.includes("\u0000")) {
    throw new Error("文件包含不受支持的空字符，请清理后再导入");
  }
  return {
    fileName: input.fileName,
    size: input.size,
    preview,
    titleSuggestion: titleFromPreview(preview, input.fileName),
    warning:
      input.size > READING_IMPORT_WARNING_BYTES
        ? `文件大小为 ${(input.size / 1024 / 1024).toFixed(1)} MB；Workbench 会自动分节处理，无需手动拆分。`
        : null
  };
}

async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file preview"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Unable to read file preview"));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export async function decodeReadingFile(file: File): Promise<ReadingImportResult> {
  if (!isSupportedReadingFile(file.name)) {
    throw new Error("只支持 .md、.markdown 或 .txt 文件");
  }
  let preview: string;
  try {
    const bytes = await readBlobBytes(file.slice(0, DOCUMENT_IMPORT_PREVIEW_BYTES));
    preview = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
      stream: bytes.byteLength === DOCUMENT_IMPORT_PREVIEW_BYTES
    });
  } catch {
    throw new Error("文件开头不是有效的 UTF-8 文本，请先转换编码后再导入");
  }
  return normalizeReadingImport({ preview, fileName: file.name, size: file.size });
}
