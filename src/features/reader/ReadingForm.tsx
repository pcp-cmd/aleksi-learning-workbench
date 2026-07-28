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
import { apiClient } from "../../lib/api-client";
import { useUnsavedChanges } from "../../lib/unsaved-guard";
import {
  decodeReadingFile,
  normalizeReadingImport,
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

type ReadingVersionResponse = {
  reading: {
    version: AssetVersion;
  };
};

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
  const [dragActive, setDragActive] = useState(false);
  const [duplicate, setDuplicate] = useState<ExistingReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<CreatedReadingResponse["saveReceipt"] | null>(null);
  const [cleanSnapshot, setCleanSnapshot] = useState(() =>
    JSON.stringify({
      body: initialDraft?.body ?? "",
      title: initialDraft?.title ?? ""
    })
  );
  const draftSnapshot = JSON.stringify({ body, title });
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
        fileWarning
      });
    }
  }, [body, dirty, fileName, fileWarning, source, title, titleEdited]);

  const updateBody = (
    value: string,
    nextSource: "manual-paste" | "file-import"
  ) => {
    setBody(value);
    setSource(nextSource);
    setDuplicate(null);
    if (!titleEdited) {
      setTitle(deriveReadingName(value));
    }
  };

  async function persistReading(
    conflictMode: "create-new" | "replace" = "create-new"
  ) {
    const trimmedBody = body.trim();
    if (trimmedBody.length === 0) {
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
      const expectedVersion =
        existing !== undefined && conflictMode === "replace"
          ? (
              await apiClient.get<ReadingVersionResponse>(
                `/api/readings/${encodeURIComponent(existing.id)}`
              )
            ).reading.version
          : undefined;
      const payload = {
        title: finalTitle,
        concept: deriveConceptName(finalTitle),
        body: trimmedBody,
        source,
        ...(source === "file-import" && fileName !== null
          ? { sourceFileName: fileName }
          : {}),
        ...(existing === undefined
          ? {}
          : conflictMode === "replace"
            ? {
                conflictMode,
                replaceReadingId: existing.id,
                expectedVersion
              }
            : { conflictMode })
      };
      const result = await apiClient.post<CreatedReadingResponse>(
        "/api/readings",
        payload
      );
      setReceipt(result.saveReceipt);
      markReadingDraftClean();
      setCleanSnapshot(JSON.stringify({ body, title: finalTitle }));
      clearReadingImportDraft();
      onCreated(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存阅读材料失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitReading(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistReading();
  }

  const applyImportedReading = useCallback((imported: ReturnType<typeof normalizeReadingImport>) => {
    setBody(imported.body);
    setTitle(imported.titleSuggestion);
    setTitleEdited(false);
    setSource("file-import");
    setFileName(imported.fileName);
    setFileWarning(imported.warning);
  }, []);

  async function importFile(file: File) {
    setError(null);
    setDuplicate(null);
    try {
      applyImportedReading(await decodeReadingFile(file));
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
        applyImportedReading(normalizeReadingImport(selected));
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
          <FileText aria-hidden="true" size={16} /> 已读取 {fileName}
        </p>
      )}
      {fileWarning === null ? null : (
        <p className="reading-import-warning" role="status">{fileWarning}</p>
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
