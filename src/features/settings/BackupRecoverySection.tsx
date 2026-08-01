import { useEffect, useState } from "react";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import { normalizeUserSuppliedVaultPath } from "../../../shared/user-path";
import { confirmDiscardUnsavedChanges } from "../../lib/unsaved-guard";

type BackupStatus =
  | "verified"
  | "incomplete"
  | "verified-needs-finalize"
  | "invalid"
  | "orphaned";

type BackupRecord = Readonly<{
  path: string;
  status: BackupStatus;
  transactionId: string | null;
  fileCount: number | null;
  totalBytes: number | null;
  diagnostics: readonly string[];
}>;

type BackupCandidateExport = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  candidate: BackupRecord;
  files: readonly Readonly<{
    relativePath: string;
    sha256: string;
    size: number;
  }>[];
  exportToken: string;
}>;

type QuarantineCandidate = Readonly<{
  relativePath: string;
  category:
    | "transactions"
    | "projections"
    | "verification"
    | "app-settings-diagnostics";
  bundleName: string;
}>;

type QuarantineCandidateExport = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  candidate: QuarantineCandidate;
  files: readonly Readonly<{
    relativePath: string;
    sha256: string;
    size: number;
  }>[];
  exportToken: string;
}>;

export type RestoredVaultStatus = Readonly<{
  path: string;
  initialized: boolean;
  writable: boolean;
  readOnlyReason: string | null;
  lastSaveAt: string | null;
}>;

type BackupRecoverySectionProps = Readonly<{
  active: boolean;
  disabled: boolean;
  isDesktop: boolean;
  onChooseDestination: (updatePath: (path: string) => void) => void;
  onRestored: (status: RestoredVaultStatus, backupPath: string) => void;
  runAction: (label: string, action: () => Promise<void>) => void;
}>;

const STATUS_COPY: Record<
  BackupStatus,
  Readonly<{ label: string; tone: "good" | "pending" | "bad" }>
> = {
  verified: { label: "已验证", tone: "good" },
  "verified-needs-finalize": { label: "待完成", tone: "pending" },
  incomplete: { label: "未完成", tone: "pending" },
  invalid: { label: "不可用", tone: "bad" },
  orphaned: { label: "不可用", tone: "bad" }
};

function formatBytes(value: number | null): string {
  if (value === null) {
    return "大小未知";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function backupName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function downloadExportInventory(
  exported: BackupCandidateExport | QuarantineCandidateExport,
  fileName: string
): void {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(exported, null, 2)}\n`], {
      type: "application/json"
    })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileName}-inventory.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function BackupRecoverySection({
  active,
  disabled,
  isDesktop,
  onChooseDestination,
  onRestored,
  runAction
}: BackupRecoverySectionProps) {
  const [backups, setBackups] = useState<readonly BackupRecord[]>([]);
  const [quarantine, setQuarantine] = useState<
    readonly QuarantineCandidate[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [restorePending, setRestorePending] = useState(false);
  const [cleanupExport, setCleanupExport] =
    useState<BackupCandidateExport | null>(null);
  const [quarantineCleanupExport, setQuarantineCleanupExport] =
    useState<QuarantineCandidateExport | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!active) {
      setBackups([]);
      setQuarantine([]);
      setLoadError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setLoadError(null);
    void Promise.allSettled([
      apiClient.get<{ backups: BackupRecord[] }>("/api/vault/backups"),
      apiClient.get<{ candidates: QuarantineCandidate[] }>(
        "/api/vault/quarantine"
      )
    ])
      .then(([backupResult, quarantineResult]) => {
        if (!alive) {
          return;
        }
        setBackups(
          backupResult.status === "fulfilled"
            ? backupResult.value.backups
            : []
        );
        setQuarantine(
          quarantineResult.status === "fulfilled"
            ? quarantineResult.value.candidates
            : []
        );
        const failures = [backupResult, quarantineResult]
          .filter(
            (
              result
            ): result is PromiseRejectedResult =>
              result.status === "rejected"
          )
          .map((result) =>
            result.reason instanceof Error
              ? result.reason.message
              : "读取备份与隔离状态失败"
          );
        if (failures.length > 0) {
          setLoadError(failures.join("；"));
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [active, refreshKey]);

  const requestRestore = () => {
    if (selectedPath.length === 0) {
      setLoadError("请先选择一个已验证备份。");
      return;
    }
    if (normalizeUserSuppliedVaultPath(destinationPath).length === 0) {
      setLoadError("请填写一个新的空目录作为恢复位置。");
      return;
    }
    setLoadError(null);
    setRestorePending(true);
  };

  const restore = () => {
    if (!confirmDiscardUnsavedChanges()) {
      setRestorePending(false);
      return;
    }
    runAction("恢复已验证备份", async () => {
      const normalizedDestination =
        normalizeUserSuppliedVaultPath(destinationPath);
      const result = await apiClient.post<{
        restored: {
          destinationPath: string;
          fileCount: number;
          totalBytes: number;
        };
        status: RestoredVaultStatus;
      }>("/api/vault/backups/restore", {
        backupPath: selectedPath,
        destinationPath: normalizedDestination,
        confirmed: true
      });
      setRestorePending(false);
      setDestinationPath("");
      setSelectedPath("");
      onRestored(result.status, selectedPath);
      setRefreshKey((value) => value + 1);
    });
  };

  const finalize = (partialPath: string) => {
    runAction("完成中断的备份", async () => {
      await apiClient.post<{
        backupPath: string;
        fileCount: number;
        totalBytes: number;
      }>("/api/vault/backups/finalize", {
        partialPath,
        confirmed: true
      });
      setRefreshKey((value) => value + 1);
    });
  };

  const prepareCleanup = (candidatePath: string) => {
    runAction("导出备份清单", async () => {
      const exported = await apiClient.post<BackupCandidateExport>(
        "/api/vault/backups/export",
        { candidatePath }
      );
      downloadExportInventory(exported, backupName(exported.candidate.path));
      setCleanupExport(exported);
    });
  };

  const prepareQuarantineCleanup = (relativePath: string) => {
    runAction("导出隔离清单", async () => {
      const exported = await apiClient.post<QuarantineCandidateExport>(
        "/api/vault/quarantine/export",
        { relativePath }
      );
      downloadExportInventory(exported, exported.candidate.bundleName);
      setQuarantineCleanupExport(exported);
    });
  };

  const cleanupQuarantine = () => {
    if (quarantineCleanupExport === null) {
      return;
    }
    runAction("清理已导出的隔离证据", async () => {
      await apiClient.post<{
        removedRelativePath: string;
        exportReceipt: QuarantineCandidateExport;
      }>("/api/vault/quarantine/cleanup", {
        relativePath: quarantineCleanupExport.candidate.relativePath,
        exportToken: quarantineCleanupExport.exportToken,
        confirmed: true
      });
      setQuarantineCleanupExport(null);
      setRefreshKey((value) => value + 1);
    });
  };

  const cleanup = () => {
    if (cleanupExport === null) {
      return;
    }
    runAction("清理已导出的备份", async () => {
      await apiClient.post<{
        removedPath: string;
        exportReceipt: BackupCandidateExport;
      }>("/api/vault/backups/cleanup", {
        candidatePath: cleanupExport.candidate.path,
        exportToken: cleanupExport.exportToken,
        confirmed: true
      });
      if (selectedPath === cleanupExport.candidate.path) {
        setSelectedPath("");
        setDestinationPath("");
        setRestorePending(false);
      }
      setCleanupExport(null);
      setRefreshKey((value) => value + 1);
    });
  };

  return (
    <section aria-label="备份与恢复" className="settings-status settings-recovery">
      <div className="settings-recovery__heading">
        <div>
          <StatusDot
            label="备份与恢复"
            tone={backups.some((backup) => backup.status === "verified") ? "active" : undefined}
          />
          <p className="settings-hint">
            这里只列出本机学习库旁的备份。恢复前会逐文件核对路径、大小和 SHA‑256。
          </p>
        </div>
        <button
          className="button button-ghost"
          disabled={disabled || loading || !active}
          onClick={() => setRefreshKey((value) => value + 1)}
          type="button"
        >
          {loading ? "检查中…" : "重新检查"}
        </button>
      </div>

      {loadError === null ? null : (
        <p className="settings-error" role="alert">
          {loadError}
        </p>
      )}

      {!active ? (
        <p className="settings-recovery__empty">请先创建或选择一个本地学习库。</p>
      ) : backups.length === 0 && !loading ? (
        <p className="settings-recovery__empty">尚未发现可用或待处理的备份。</p>
      ) : (
        <ul className="settings-backup-list">
          {backups.map((backup) => {
            const status = STATUS_COPY[backup.status];
            const selectable = backup.status === "verified";
            return (
              <li
                className={
                  selectedPath === backup.path
                    ? "settings-backup-card settings-backup-card--selected"
                    : "settings-backup-card"
                }
                key={`${backup.status}:${backup.path}`}
              >
                <div className="settings-backup-card__copy">
                  <span
                    className={`settings-backup-card__status settings-backup-card__status--${status.tone}`}
                  >
                    {status.label}
                  </span>
                  <strong>{backupName(backup.path)}</strong>
                  <span className="settings-backup-card__meta">
                    {backup.fileCount === null
                      ? "文件数未知"
                      : `${backup.fileCount} 个文件`}
                    {" · "}
                    {formatBytes(backup.totalBytes)}
                  </span>
                  <span className="settings-backup-card__path">{backup.path}</span>
                </div>
                <div className="settings-backup-card__actions">
                  {selectable ? (
                    <button
                      aria-pressed={selectedPath === backup.path}
                      className="button button-ghost"
                      disabled={disabled}
                      onClick={() => {
                        setSelectedPath(backup.path);
                        setRestorePending(false);
                      }}
                      type="button"
                    >
                      选择已验证备份
                    </button>
                  ) : backup.status === "verified-needs-finalize" ? (
                    <button
                      className="button button-ghost"
                      disabled={disabled}
                      onClick={() => finalize(backup.path)}
                      type="button"
                    >
                      完成中断备份
                    </button>
                  ) : null}
                  <button
                    className="button button-ghost"
                    disabled={disabled}
                    onClick={() => prepareCleanup(backup.path)}
                    type="button"
                  >
                    导出并准备清理
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="settings-path-field settings-recovery__destination">
        <label htmlFor="settings-restore-destination">恢复到新位置</label>
        <div className="settings-path-control">
          <input
            disabled={disabled || selectedPath.length === 0}
            id="settings-restore-destination"
            onChange={(event) => {
              setDestinationPath(event.target.value);
              setRestorePending(false);
            }}
            placeholder="请选择一个新的空目录"
            value={destinationPath}
          />
          {isDesktop ? (
            <button
              className="button button-ghost"
              disabled={disabled || selectedPath.length === 0}
              onClick={() => onChooseDestination(setDestinationPath)}
              type="button"
            >
              浏览…
            </button>
          ) : null}
        </div>
      </div>

      <button
        className="button settings-recovery__prepare"
        disabled={disabled || selectedPath.length === 0}
        onClick={requestRestore}
        type="button"
      >
        准备恢复
      </button>

      {restorePending ? (
        <div className="settings-confirm">
          <p>
            恢复只写入新位置；全部校验通过后，才会把当前学习库切换到该位置。
          </p>
          <button
            className="button"
            disabled={disabled}
            onClick={restore}
            type="button"
          >
            确认恢复并切换
          </button>
        </div>
      ) : null}

      {cleanupExport === null ? null : (
        <div className="settings-confirm">
          <p>
            已导出 {cleanupExport.files.length} 个文件的校验清单。确认后只清理这一个备份：
            {backupName(cleanupExport.candidate.path)}
          </p>
          <div className="settings-confirm__actions">
            <button
              className="button button-ghost"
              disabled={disabled}
              onClick={() => setCleanupExport(null)}
              type="button"
            >
              取消清理
            </button>
            <button
              className="button"
              disabled={disabled}
              onClick={cleanup}
              type="button"
            >
              确认清理已导出的备份
            </button>
          </div>
        </div>
      )}

      <div className="settings-recovery__quarantine">
        <div>
          <strong>隔离证据</strong>
          <p className="settings-hint">
            损坏或冲突的证据不参与正常索引。必须先导出逐文件校验清单，才能清理单个隔离包。
          </p>
        </div>
        {quarantine.length === 0 && !loading ? (
          <p className="settings-recovery__empty">当前没有隔离证据。</p>
        ) : (
          <ul className="settings-backup-list">
            {quarantine.map((candidate) => (
              <li
                className="settings-backup-card"
                key={candidate.relativePath}
              >
                <div className="settings-backup-card__copy">
                  <span className="settings-backup-card__status settings-backup-card__status--pending">
                    {candidate.category}
                  </span>
                  <strong>{candidate.bundleName}</strong>
                  <span className="settings-backup-card__path">
                    {candidate.relativePath}
                  </span>
                </div>
                <div className="settings-backup-card__actions">
                  <button
                    className="button button-ghost"
                    disabled={disabled}
                    onClick={() =>
                      prepareQuarantineCleanup(candidate.relativePath)
                    }
                    type="button"
                  >
                    导出隔离清单
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {quarantineCleanupExport === null ? null : (
        <div className="settings-confirm">
          <p>
            已导出 {quarantineCleanupExport.files.length} 个文件的校验清单。确认后只清理这一个隔离包：
            {quarantineCleanupExport.candidate.bundleName}
          </p>
          <div className="settings-confirm__actions">
            <button
              className="button button-ghost"
              disabled={disabled}
              onClick={() => setQuarantineCleanupExport(null)}
              type="button"
            >
              取消清理
            </button>
            <button
              className="button"
              disabled={disabled}
              onClick={cleanupQuarantine}
              type="button"
            >
              确认清理已导出的隔离证据
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
