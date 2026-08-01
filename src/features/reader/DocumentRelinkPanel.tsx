import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "../../app/query-keys";
import { apiClient } from "../../lib/api-client";

type DocumentRelinkPanelProps = {
  documentId: string;
  message: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "重新关联源文件失败";
}

export function DocumentRelinkPanel({
  documentId,
  message
}: DocumentRelinkPanelProps) {
  const queryClient = useQueryClient();
  const [relativePath, setRelativePath] = useState("");
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const [relinking, setRelinking] = useState(false);

  async function relink() {
    if (relativePath.trim().length === 0) return;
    setRelinking(true);
    setRelinkError(null);
    try {
      await apiClient.post(
        `/api/documents/${encodeURIComponent(documentId)}/relink`,
        { relativePath: relativePath.trim() }
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.documents.detail(documentId)
      });
    } catch (caught) {
      setRelinkError(errorMessage(caught));
    } finally {
      setRelinking(false);
    }
  }

  return (
    <section className="document-relink" aria-label="重新关联阅读材料">
      <p className="settings-error" role="alert">{message}</p>
      <p>
        材料元数据和索引记录仍在。请把原文件放回 Local Learning Library 的
        “01-阅读材料”目录，再填写相对路径。
      </p>
      <label>
        源文件相对路径
        <input
          onChange={(event) => setRelativePath(event.target.value)}
          placeholder="01-阅读材料/原文件.md"
          value={relativePath}
        />
      </label>
      <button
        className="button"
        disabled={relinking || relativePath.trim().length === 0}
        onClick={() => void relink()}
        type="button"
      >
        {relinking ? "正在重新建立索引" : "重新关联源文件"}
      </button>
      {relinkError === null ? null : (
        <p className="settings-error" role="alert">{relinkError}</p>
      )}
    </section>
  );
}
