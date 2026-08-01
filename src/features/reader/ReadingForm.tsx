import { FileText, Upload } from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { SaveReceipt } from "../../components/SaveReceipt";
import { desktopRuntime, type SelectedReading } from "../../desktop/runtime";
import { apiClient, ApiClientError } from "../../lib/api-client";
import { DOCUMENT_IMPORT_PART_BYTES } from "../../../shared/document-limits";
import { useUnsavedChanges } from "../../lib/unsaved-guard";
import {
  decodeReadingFile,
  normalizeReadingImport,
  type ReadingImportResult,
  READING_IMPORT_ACCEPT
} from "./reading-import";
import {
  clearReadingImportDraft,
  readReadingImportDraft,
  writeReadingImportDraft
} from "./reading-import-draft-store";

type CreatedReadingResponse = {
  reading: {
    id: string;
    relativePath: string;
  };
  saveReceipt: {
    modifiedAt: string;
    relativePath: string;
  };
};

type ExistingReading = {
  id: string;
  title: string;
};

type AssetVersion = {
  sha256: string;
  size: number;
  mtimeNs: string;
  inode: string;
};

type DocumentVersionResponse = {
  document: {
    sourceHash: string;
    sourceVersion: {
      byteSize: number;
      modifiedNanoseconds: string;
      inode: string;
    };
  };
};

type PendingImportSource =
  | { kind: "browser"; file: File }
  | { kind: "desktop"; selected: SelectedReading };

type DocumentImportSessionResponse = {
  session: {
    sessionId: string;
    receivedBytes: number;
    expectedBytes: number;
    status: "uploading" | "processing" | "ready" | "failed";
    stage: string;
  };
};

const DOCUMENT_FINALIZE_TIMEOUT_MS = 15 * 60_000;

function importStageLabel(stage: string): string {
  if (stage === "analyzing-structure") return "正在分析 Markdown 结构";
  if (stage === "preparing-sections") return "正在准备可读取章节";
  if (stage === "building-search-index") return "正在建立全文索引";
  if (stage === "ready") return "材料已准备完成";
  return "正在分析结构并建立索引";
}

export interface ReadingFormProps {
  autoOpenImportKey?: string | null;
  existingReadings?: ExistingReading[];
  onAutoImportHandled?: () => void;
  onCreated: (response: CreatedReadingResponse) => void;
}

function stripMarkdownHeading(value: string): string {
  return value
    .replace(/^#{1,6}\s*/u, "")
    .replace(/[*_`[\]()]/gu, "")
    .trim();
}

function deriveReadingName(body: string): string {
  const firstLine =
    body
      .split(/\r?\n/u)
      .map((line) => stripMarkdownHeading(line))
      .find((line) => line.length > 0) ?? "";

  if (firstLine.length === 0) {
    return "未命名材料";
  }

  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

function deriveConceptName(title: string): string {
  return title.match(/[εɛ]-N/iu)?.[0] ?? title;
}

function normalizeTitle(value: string): string {
  return value.trim().normalize("NFC").toLocaleLowerCase("zh-CN");
}

export function ReadingForm({
  autoOpenImportKey = null,
  existingReadings = [],
  onAutoImportHandled,
  onCreated
}: ReadingFormProps) {
  const browserFileInputRef = useRef<HTMLInputElement | null>(null);
  const handledImportKeyRef = useRef<string | null>(null);
  const [initialDraft] = useState(readReadingImportDraft);
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const [titleEdited, setTitleEdited] = useState(initialDraft?.titleEdited ?? false);
  const [source, setSource] = useState<"manual-paste" | "file-import">(
    initialDraft?.source ?? "manual-paste"
  );
  const [fileName, setFileName] = useState<string | null>(
    initialDraft?.fileName ?? null
  );
  const [fileWarning, setFileWarning] = useState<string | null>(
    initialDraft?.fileWarning ?? null
  );
  const [pendingImportSource, setPendingImportSource] =
    useState<PendingImportSource | null>(null);
  const [pendingImportSessionId, setPendingImportSessionId] =
    useState<string | null>(initialDraft?.pendingImportSessionId ?? null);
  const [pendingImportExpectedBytes, setPendingImportExpectedBytes] =
    useState<number | null>(initialDraft?.pendingImportExpectedBytes ?? null);
  const [importProgress, setImportProgress] = useState<{
    label: string;
    percent: number;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [duplicate, setDuplicate] = useState<ExistingReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<CreatedReadingResponse["saveReceipt"] | null>(null);
  const [cleanSnapshot, setCleanSnapshot] = useState(() =>
    JSON.stringify({
      body: initialDraft?.body ?? "",
      title: initialDraft?.title ?? "",
      fileName: initialDraft?.fileName ?? null,
      pendingImportSessionId: initialDraft?.pendingImportSessionId ?? null,
      pendingImportExpectedBytes: initialDraft?.pendingImportExpectedBytes ?? null
    })
  );
  const draftSnapshot = JSON.stringify({
    body,
    title,
    fileName,
    pendingImportSessionId,
    pendingImportExpectedBytes
  });
  const dirty = draftSnapshot !== cleanSnapshot;
  const markReadingDraftClean = useUnsavedChanges(dirty);

  useEffect(() => {
    if (dirty) {
      writeReadingImportDraft({
        body,
        title,
        titleEdited,
        source,
        fileName,
        fileWarning,
        pendingImportSessionId,
        pendingImportExpectedBytes
      });
    }
  }, [
    body,
    dirty,
    fileName,
    fileWarning,
    pendingImportExpectedBytes,
    pendingImportSessionId,
    source,
    title,
    titleEdited
  ]);

  const updateBody = (
    value: string,
    nextSource: "manual-paste" | "file-import"
  ) => {
    setBody(value);
    setPendingImportSource(null);
    setPendingImportSessionId(null);
    setPendingImportExpectedBytes(null);
    setSource(nextSource);
    setDuplicate(null);
    if (!titleEdited) {
      setTitle(deriveReadingName(value));
    }
  };

  async function sourcePart(
    pending: PendingImportSource,
    offset: number,
    length: number
  ): Promise<Blob> {
    if (pending.kind === "browser") {
      return pending.file.slice(offset, offset + length);
    }
    const bytes = await desktopRuntime.readSelectedReadingPart(
      pending.selected.handleId,
      offset,
      length
    );
    const exact = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return new Blob([exact], { type: "application/octet-stream" });
  }

  async function persistImportedReading(
    finalTitle: string,
    conflictMode: "create-new" | "replace",
    existing: ExistingReading | undefined
  ): Promise<CreatedReadingResponse> {
    const pending = pendingImportSource;
    if (pending === null) {
      throw new Error("请重新选择原文件后再导入；为保护内存，Workbench 不会把大文件保存在草稿中。");
    }
    const selectedFileName =
      pending.kind === "browser" ? pending.file.name : pending.selected.fileName;
    const selectedSize =
      pending.kind === "browser" ? pending.file.size : pending.selected.size;

    let sessionId = pendingImportSessionId;
    let receivedBytes = 0;
    let resumedStatus: DocumentImportSessionResponse["session"]["status"] | null = null;
    if (sessionId !== null) {
      try {
        const resumed = await apiClient.get<DocumentImportSessionResponse>(
          `/api/document-imports/${encodeURIComponent(sessionId)}`
        );
        if (resumed.session.expectedBytes !== selectedSize) {
          sessionId = null;
          setPendingImportSessionId(null);
        } else {
          receivedBytes = resumed.session.receivedBytes;
          resumedStatus = resumed.session.status;
        }
      } catch (caught) {
        if (!(caught instanceof ApiClientError) || caught.status !== 404) throw caught;
        sessionId = null;
        setPendingImportSessionId(null);
      }
    }
    if (sessionId === null) {
      let expectedVersion: AssetVersion | undefined;
      if (existing !== undefined && conflictMode === "replace") {
        const opened = await apiClient.get<DocumentVersionResponse>(
          `/api/documents/${encodeURIComponent(existing.id)}`
        );
        expectedVersion = {
          sha256: opened.document.sourceHash,
          size: opened.document.sourceVersion.byteSize,
          mtimeNs: opened.document.sourceVersion.modifiedNanoseconds,
          inode: opened.document.sourceVersion.inode
        };
      }
      setImportProgress({ label: "正在准备导入", percent: 0 });
      const created = await apiClient.post<DocumentImportSessionResponse>(
        "/api/document-imports",
        {
          fileName: selectedFileName,
          expectedBytes: selectedSize,
          title: finalTitle,
          concept: deriveConceptName(finalTitle),
          conflictMode,
          ...(existing === undefined ? {} : { replaceReadingId: existing.id }),
          ...(expectedVersion === undefined ? {} : { expectedVersion })
        }
      );
      sessionId = created.session.sessionId;
      receivedBytes = created.session.receivedBytes;
      setPendingImportSessionId(sessionId);
      setPendingImportExpectedBytes(selectedSize);
    }

    if (resumedStatus !== null && resumedStatus !== "ready" && receivedBytes > 0) {
      try {
        for (let offset = 0; offset < receivedBytes; offset += DOCUMENT_IMPORT_PART_BYTES) {
          const length = Math.min(DOCUMENT_IMPORT_PART_BYTES, receivedBytes - offset);
          const part = await sourcePart(pending, offset, length);
          await apiClient.putBinary<DocumentImportSessionResponse>(
            `/api/document-imports/${encodeURIComponent(sessionId)}/verify-parts?offset=${offset}`,
            part
          );
          setImportProgress({
            label: "正在核对原文件",
            percent: Math.round(((offset + length) / selectedSize) * 20)
          });
        }
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.code === "IMPORT_SOURCE_MISMATCH") {
          setPendingImportSessionId(null);
          setPendingImportExpectedBytes(null);
        }
        throw caught;
      }
    }

    while (receivedBytes < selectedSize) {
      const length = Math.min(
        DOCUMENT_IMPORT_PART_BYTES,
        selectedSize - receivedBytes
      );
      const part = await sourcePart(pending, receivedBytes, length);
      const uploaded = await apiClient.putBinary<DocumentImportSessionResponse>(
        `/api/document-imports/${encodeURIComponent(sessionId)}/parts?offset=${receivedBytes}`,
        part
      );
      receivedBytes = uploaded.session.receivedBytes;
      setImportProgress({
        label: "正在读取材料",
        percent: Math.round((receivedBytes / selectedSize) * 80)
      });
    }

    setImportProgress({ label: "正在分析结构并建立索引", percent: 88 });
    let finalizing = true;
    const finalize = apiClient.post<CreatedReadingResponse>(
      `/api/document-imports/${encodeURIComponent(sessionId)}/finalize`,
      {},
      { timeoutMs: DOCUMENT_FINALIZE_TIMEOUT_MS }
    );
    void finalize.then(
      () => { finalizing = false; },
      () => { finalizing = false; }
    );
    while (finalizing) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      if (!finalizing) break;
      const status = await apiClient.get<DocumentImportSessionResponse>(
        `/api/document-imports/${encodeURIComponent(sessionId)}`
      ).catch(() => null);
      if (status !== null) {
        setImportProgress({
          label: importStageLabel(status.session.stage),
          percent: status.session.stage === "building-search-index" ? 96 : 90
        });
      }
    }
    const result = await finalize;
    setImportProgress({ label: "材料已准备完成", percent: 100 });
    return result;
  }

  async function persistReading(
    conflictMode: "create-new" | "replace" = "create-new"
  ) {
    const trimmedBody = body.trim();
    if (source === "manual-paste" && trimmedBody.length === 0) {
      setError("请先粘贴或导入你要精读的内容");
      return;
    }

    const finalTitle = title.trim() || deriveReadingName(trimmedBody);
    const existing = existingReadings.find(
      (reading) => normalizeTitle(reading.title) === normalizeTitle(finalTitle)
    );
    if (existing !== undefined && duplicate === null) {
      setDuplicate(existing);
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = source === "file-import"
        ? await persistImportedReading(finalTitle, conflictMode, existing)
        : await apiClient.post<CreatedReadingResponse>("/api/readings", {
            title: finalTitle,
            concept: deriveConceptName(finalTitle),
            body: trimmedBody,
            source,
            ...(existing === undefined
              ? {}
              : conflictMode === "replace"
                ? {
                    conflictMode,
                    replaceReadingId: existing.id,
                    expectedVersion: await apiClient
                      .get<DocumentVersionResponse>(
                        `/api/documents/${encodeURIComponent(existing.id)}`
                      )
                      .then(({ document }) => ({
                        sha256: document.sourceHash,
                        size: document.sourceVersion.byteSize,
                        mtimeNs: document.sourceVersion.modifiedNanoseconds,
                        inode: document.sourceVersion.inode
                      }))
                  }
                : { conflictMode })
          });
      setReceipt(result.saveReceipt);
      markReadingDraftClean();
      setCleanSnapshot(JSON.stringify({
        body,
        title: finalTitle,
        fileName,
        pendingImportSessionId,
        pendingImportExpectedBytes
      }));
      clearReadingImportDraft();
      onCreated(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存阅读材料失败");
    } finally {
      setSaving(false);
      setImportProgress(null);
    }
  }

  async function submitReading(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistReading();
  }

  const applyImportedReading = useCallback((
    imported: ReadingImportResult,
    pending: PendingImportSource
  ) => {
    const selectedSize = pending.kind === "browser" ? pending.file.size : pending.selected.size;
    const canResume =
      pendingImportSessionId !== null &&
      pendingImportExpectedBytes === selectedSize &&
      fileName === imported.fileName;
    setBody("");
    setTitle(imported.titleSuggestion);
    setTitleEdited(false);
    setSource("file-import");
    setFileName(imported.fileName);
    setFileWarning(imported.warning);
    setPendingImportSource(pending);
    setPendingImportSessionId(canResume ? pendingImportSessionId : null);
    setPendingImportExpectedBytes(selectedSize);
  }, [fileName, pendingImportExpectedBytes, pendingImportSessionId]);

  async function importFile(file: File) {
    setError(null);
    setDuplicate(null);
    try {
      applyImportedReading(await decodeReadingFile(file), { kind: "browser", file });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取导入文件");
    }
  }

  const openImportPicker = useCallback(async () => {
    setError(null);
    setDuplicate(null);
    if (!desktopRuntime.isDesktop()) {
      browserFileInputRef.current?.click();
      return;
    }

    try {
      const selected: SelectedReading | null = await desktopRuntime.selectReadingFile();
      if (selected !== null) {
        applyImportedReading(normalizeReadingImport(selected), {
          kind: "desktop",
          selected
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取导入文件");
    }
  }, [applyImportedReading]);

  useEffect(() => {
    if (
      autoOpenImportKey === null ||
      handledImportKeyRef.current === autoOpenImportKey
    ) {
      return;
    }
    handledImportKeyRef.current = autoOpenImportKey;
    void openImportPicker().finally(() => onAutoImportHandled?.());
  }, [autoOpenImportKey, onAutoImportHandled, openImportPicker]);

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) {
      void importFile(file);
    }
  };

  return (
    <form className="reading-form input-surface" onSubmit={submitReading}>
      <StatusLine />
      {initialDraft === null ? null : (
        <p className="reading-import-receipt" role="status">
          已恢复上次未保存的新材料草稿
          {initialDraft.source === "file-import" ? "；请重新选择原文件后继续导入" : ""}
        </p>
      )}
      {desktopRuntime.isDesktop() ? (
        <button
          className="reading-import-dropzone"
          onClick={() => void openImportPicker()}
          type="button"
        >
          <Upload aria-hidden="true" size={21} strokeWidth={1.7} />
          <span>
            <strong>从电脑选择材料</strong>
            <small>.md、.markdown、.txt · 原生文件选择</small>
          </span>
        </button>
      ) : (
        <label
          className={`reading-import-dropzone${dragActive ? " is-drag-active" : ""}`}
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            accept={READING_IMPORT_ACCEPT}
            aria-label="选择 Markdown 或文本文件"
            className="reading-import-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) {
                void importFile(file);
              }
              event.target.value = "";
            }}
            ref={browserFileInputRef}
            type="file"
          />
          <Upload aria-hidden="true" size={21} strokeWidth={1.7} />
          <span>
            <strong>拖入文件或点击选择</strong>
            <small>.md、.markdown、.txt · 按 UTF-8 读取</small>
          </span>
        </label>
      )}
      {fileName === null ? null : (
        <p className="reading-import-receipt">
          <FileText aria-hidden="true" size={16} /> 已选择 {fileName}
        </p>
      )}
      {fileWarning === null ? null : (
        <p className="reading-import-warning" role="status">{fileWarning}</p>
      )}
      {importProgress === null ? null : (
        <div className="reading-import-progress" role="status">
          <span>{importProgress.label}</span>
          <progress max={100} value={importProgress.percent}>
            {importProgress.percent}%
          </progress>
        </div>
      )}
      <div className="reading-form__separator"><span>或继续粘贴</span></div>
      <label>
        粘贴你要精读的内容
        <textarea
          onChange={(event) => {
            setFileName(null);
            setFileWarning(null);
            updateBody(event.target.value, "manual-paste");
          }}
          placeholder="粘贴教材、论文段落、笔记或题目解析。第一行会自动成为材料名。"
          rows={10}
          value={body}
        />
      </label>
      <label>
        标题建议
        <input
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleEdited(true);
            setDuplicate(null);
          }}
          value={title}
        />
      </label>
      {error === null ? null : (
        <p className="settings-error" role="alert">{error}</p>
      )}
      {duplicate === null ? null : (
        <section className="reading-conflict" aria-label="同名材料处理">
          <strong>已存在同名材料“{duplicate.title}”</strong>
          <p>请选择保留两份，或明确替换原材料。替换会保留原材料 ID 与文件位置。</p>
          <div className="form-actions">
            <button
              className="button button-ghost"
              disabled={saving}
              onClick={() => void persistReading("create-new")}
              type="button"
            >
              保留两份
            </button>
            <button
              className="button"
              disabled={saving}
              onClick={() => void persistReading("replace")}
              type="button"
            >
              替换原材料
            </button>
          </div>
        </section>
      )}
      <button className="button reading-form__submit" disabled={saving} type="submit">
        {saving ? "正在准备" : "开始精读"}
      </button>
      {receipt === null ? null : (
        <SaveReceipt
          at={receipt.modifiedAt}
          label="保存完成"
          path={receipt.relativePath}
        />
      )}
    </form>
  );
}

function StatusLine() {
  return <p className="eyebrow" id="reading-form-status">新精读材料</p>;
}
