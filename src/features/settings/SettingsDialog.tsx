import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resetLibraryBackedQueries } from "../../app/query-invalidation";
import { SaveReceipt } from "../../components/SaveReceipt";
import { StatusDot } from "../../components/StatusDot";
import { desktopRuntime } from "../../desktop/runtime";
import { apiClient } from "../../lib/api-client";
import { clearAllDraftStorage } from "../../lib/draft-store";
import { normalizeUserSuppliedVaultPath } from "../../../shared/user-path";
import {
  confirmDiscardUnsavedChanges,
  useUnsavedChanges
} from "../../lib/unsaved-guard";

type VaultStatus = {
  path: string;
  initialized: boolean;
  writable: boolean;
  readOnlyReason: string | null;
  lastSaveAt: string | null;
};

type RuntimeCapabilities = {
  mode: string;
  identity: {
    version: string;
    buildId: string;
  };
  openLearningLibrary: boolean;
  exportDiagnostics: boolean;
  exitWorkbench: boolean;
};

type PendingConfirmation = "migrate" | "backup" | "exit" | null;

export interface SettingsDialogProps {
  onClose: () => void;
  open: boolean;
}

function writableLabel(status: VaultStatus | null): string {
  if (status === null) {
    return "未配置";
  }

  return status.writable ? "可写" : "只读";
}

const EMPTY_SETTINGS_PATHS = JSON.stringify({
  destinationPath: "",
  initializePath: "",
  selectPath: "",
  sourcePath: ""
});

export function SettingsDialog({ onClose, open }: SettingsDialogProps) {
  const queryClient = useQueryClient();
  const [isDesktop] = useState(() => desktopRuntime.isDesktop());
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [recommendedVaultPath, setRecommendedVaultPath] = useState("");
  const [runtimeCapabilities, setRuntimeCapabilities] =
    useState<RuntimeCapabilities | null>(null);
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [initializePath, setInitializePath] = useState("");
  const [selectPath, setSelectPath] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>(null);
  const [receipt, setReceipt] = useState<{
    at: string | null;
    label: string;
    path: string | null;
  }>({ at: null, label: "最近保存", path: null });
  const [cleanSnapshot, setCleanSnapshot] = useState(EMPTY_SETTINGS_PATHS);
  const pathSnapshot = JSON.stringify({
    destinationPath,
    initializePath,
    selectPath,
    sourcePath
  });
  useUnsavedChanges(open && pathSnapshot !== cleanSnapshot);

  useEffect(() => {
    if (!open) {
      return;
    }

    let alive = true;
    setError(null);
    Promise.all([
      apiClient.get<{ status: VaultStatus | null }>("/api/vault/status"),
      apiClient.get<{ path: string }>("/api/vault/recommended-path"),
      apiClient.get<RuntimeCapabilities>("/api/runtime/capabilities")
    ])
      .then(([result, recommended, runtime]) => {
        if (alive) {
          setStatus(result.status);
          setRecommendedVaultPath(recommended.path);
          setRuntimeCapabilities(runtime);
          setReceipt({
            at: result.status?.lastSaveAt ?? null,
            label: "最近保存",
            path: result.status?.path ?? null
          });
        }
      })
      .catch((caught: unknown) => {
        if (alive) {
          setError(caught instanceof Error ? caught.message : "读取本地学习库状态失败");
        }
      });

    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const applyStatus = (
    nextStatus: VaultStatus,
    label: string,
    path = nextStatus.path
  ) => {
    setStatus(nextStatus);
    setReceipt({
      at: nextStatus.lastSaveAt,
      label,
      path
    });
    setCleanSnapshot(pathSnapshot);
  };

  const applyChangedLibrary = (nextStatus: VaultStatus, label: string) => {
    clearAllDraftStorage();
    resetLibraryBackedQueries(queryClient);
    applyStatus(nextStatus, label);
  };

  const runSettingsAction = (label: string, action: () => Promise<void>) => {
    setError(null);
    setSaving(label);
    void action()
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : `${label}失败`);
      })
      .finally(() => {
        setSaving(null);
      });
  };

  const initializeVault = () => {
    runSettingsAction("创建本地学习库", async () => {
      const result = await apiClient.post<{ status: VaultStatus }>(
        "/api/vault/initialize",
        { path: normalizeUserSuppliedVaultPath(initializePath) }
      );
      applyChangedLibrary(result.status, "创建完成");
    });
  };

  const selectVault = () => {
    runSettingsAction("更换学习库", async () => {
      const result = await apiClient.post<{ status: VaultStatus }>(
        "/api/vault/select",
        { path: normalizeUserSuppliedVaultPath(selectPath) }
      );
      applyChangedLibrary(result.status, "更换完成");
    });
  };

  const migrateVault = () => {
    runSettingsAction("迁移学习库", async () => {
      const result = await apiClient.post<{ status: VaultStatus }>(
        "/api/vault/migrate",
        {
          sourcePath: normalizeUserSuppliedVaultPath(sourcePath),
          destinationPath: normalizeUserSuppliedVaultPath(destinationPath),
          confirmed: true
        }
      );
      setPendingConfirmation(null);
      applyChangedLibrary(result.status, "迁移完成");
    });
  };

  const backupVault = () => {
    runSettingsAction("备份学习库", async () => {
      const result = await apiClient.post<{
        backupPath: string;
        status: VaultStatus;
      }>("/api/vault/backup", { confirmed: true });
      setPendingConfirmation(null);
      setStatus(result.status);
      setReceipt({
        at: result.status.lastSaveAt,
        label: "备份完成",
        path: result.backupPath
      });
      setCleanSnapshot(pathSnapshot);
    });
  };

  const chooseLearningLibrary = (
    label: string,
    updatePath: (path: string) => void
  ) => {
    runSettingsAction(label, async () => {
      const path = await desktopRuntime.selectLearningLibrary();
      if (path !== null) {
        updatePath(path);
      }
    });
  };

  const openLearningLibrary = () => {
    runSettingsAction("打开本地学习库", async () => {
      if (isDesktop) {
        await desktopRuntime.openLearningLibrary();
      } else {
        await apiClient.post<{ opened: true }>("/api/runtime/open-library");
      }
      setLifecycleMessage("已在文件管理器中打开当前学习库。");
    });
  };

  const exportDiagnostics = () => {
    runSettingsAction("导出诊断", async () => {
      const path = await desktopRuntime.exportDiagnostics();
      if (path !== null) {
        setLifecycleMessage(`诊断已保存到 ${path}`);
      }
    });
  };

  const exitWorkbench = () => {
    runSettingsAction("退出 Aleksi Workbench", async () => {
      if (isDesktop) {
        await desktopRuntime.requestExit();
      } else {
        await apiClient.post<{ exiting: true }>("/api/runtime/exit", {
          confirmed: true
        });
      }
      setPendingConfirmation(null);
      setLifecycleMessage("退出请求已发送，可以关闭此窗口。");
    });
  };

  const actionDisabled = saving !== null;
  const closeDialog = () => {
    if (confirmDiscardUnsavedChanges()) {
      onClose();
    }
  };

  return (
    <div aria-label="本地学习库设置" aria-modal="true" className="settings-dialog" role="dialog">
      <div className="settings-dialog__panel">
        <header className="settings-dialog__header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>本地学习库设置</h2>
          </div>
          <button className="button button-ghost" onClick={closeDialog} type="button">
            关闭
          </button>
        </header>

        {error === null ? null : (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        {saving === null ? null : (
          <p className="settings-saving" aria-live="polite">
            正在{saving}…
          </p>
        )}

        <section className="settings-status" aria-label="常用设置">
          <StatusDot label="常用" tone={status?.writable ? "active" : "blocked"} />
          <dl>
            <div>
              <dt>当前学习库位置</dt>
              <dd>{status?.path ?? "未配置本地学习库"}</dd>
            </div>
            <div>
              <dt>推荐位置</dt>
              <dd>{recommendedVaultPath || "正在读取推荐位置"}</dd>
            </div>
          </dl>
          <p className="settings-hint">
            如果你不确定放哪里，直接使用推荐位置；路径可以带英文或中文引号。
          </p>

          <div className="settings-form-grid">
            <div className="settings-path-field">
              <label htmlFor="settings-initialize-path">新学习库位置</label>
              <div className="settings-path-control">
                <input
                  id="settings-initialize-path"
                  onChange={(event) => setInitializePath(event.target.value)}
                  value={initializePath}
                />
                {isDesktop ? (
                  <button
                    className="button button-ghost"
                    disabled={actionDisabled}
                    onClick={() =>
                      chooseLearningLibrary("选择新学习库位置", setInitializePath)
                    }
                    type="button"
                  >
                    浏览…
                  </button>
                ) : null}
              </div>
            </div>
            <button
              className="button button-ghost"
              disabled={actionDisabled || recommendedVaultPath.length === 0}
              onClick={() => setInitializePath(recommendedVaultPath)}
              type="button"
            >
              使用推荐位置
            </button>
            <button
              className="button"
              disabled={actionDisabled}
              onClick={initializeVault}
              type="button"
            >
              创建本地学习库
            </button>

            <div className="settings-path-field">
              <label htmlFor="settings-select-path">更换学习库位置</label>
              <div className="settings-path-control">
                <input
                  id="settings-select-path"
                  onChange={(event) => setSelectPath(event.target.value)}
                  value={selectPath}
                />
                {isDesktop ? (
                  <button
                    className="button button-ghost"
                    disabled={actionDisabled}
                    onClick={() =>
                      chooseLearningLibrary("选择现有学习库", setSelectPath)
                    }
                    type="button"
                  >
                    浏览…
                  </button>
                ) : null}
              </div>
            </div>
            <button
              className="button"
              disabled={actionDisabled}
              onClick={selectVault}
              type="button"
            >
              更换学习库
            </button>

            <button
              className="button"
              disabled={actionDisabled}
              onClick={() => setPendingConfirmation("backup")}
              type="button"
            >
              备份学习库
            </button>
          </div>
        </section>

        <section className="settings-status" aria-label="应用与诊断">
          <StatusDot
            label="本地应用"
            tone={runtimeCapabilities?.exitWorkbench ? "active" : "blocked"}
          />
          <dl>
            <div>
              <dt>Product</dt>
              <dd>Aleksi Workbench</dd>
            </div>
            <div>
              <dt>运行模式</dt>
              <dd>{runtimeCapabilities?.mode ?? "正在读取"}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{runtimeCapabilities?.identity.version ?? "—"}</dd>
            </div>
          </dl>
          <p className="settings-hint">
            打开学习库只会定位到当前已验证目录；诊断文件不包含学习正文。
          </p>
          {lifecycleMessage === null ? null : (
            <p className="settings-saving" aria-live="polite">
              {lifecycleMessage}
            </p>
          )}
          <div className="settings-form-grid">
            <button
              className="button"
              disabled={
                actionDisabled ||
                runtimeCapabilities?.openLearningLibrary !== true
              }
              onClick={openLearningLibrary}
              type="button"
            >
              打开本地学习库
            </button>
            {isDesktop ? (
              <button
                className="button button-ghost"
                disabled={
                  actionDisabled ||
                  runtimeCapabilities?.exportDiagnostics !== true
                }
                onClick={exportDiagnostics}
                type="button"
              >
                导出诊断
              </button>
            ) : (
              <a
                aria-disabled={runtimeCapabilities?.exportDiagnostics !== true}
                className="button button-ghost"
                download
                href="/api/runtime/diagnostics"
                onClick={(event) => {
                  if (runtimeCapabilities?.exportDiagnostics !== true) {
                    event.preventDefault();
                  }
                }}
              >
                导出诊断
              </a>
            )}
            <button
              className="button button-ghost"
              disabled={
                actionDisabled || runtimeCapabilities?.exitWorkbench !== true
              }
              onClick={() => setPendingConfirmation("exit")}
              type="button"
            >
              退出 Aleksi Workbench
            </button>
          </div>
        </section>

        <button
          aria-expanded={advancedOpen}
          className="button button-ghost"
          onClick={() => setAdvancedOpen((current) => !current)}
          type="button"
        >
          {advancedOpen ? "收起高级设置" : "显示高级设置"}
        </button>

        {advancedOpen ? (
          <section className="settings-status" aria-label="高级设置">
            <StatusDot label="高级" />
            <dl>
              <div>
                <dt>查看内部路径</dt>
                <dd>{status?.path ?? "未配置本地学习库"}</dd>
              </div>
              <div>
                <dt>写入状态</dt>
                <dd>{writableLabel(status)}</dd>
              </div>
              <div>
                <dt>只读原因</dt>
                <dd>{status?.readOnlyReason ?? "无"}</dd>
              </div>
            </dl>
            <SaveReceipt {...receipt} />
            <p className="settings-hint">
              诊断信息：迁移和路径状态只用于修复学习库位置，不影响当前学习内容。
            </p>

            <div className="settings-form-grid">
              <div className="settings-path-field">
                <label htmlFor="settings-source-path">迁移来源</label>
                <div className="settings-path-control">
                  <input
                    id="settings-source-path"
                    onChange={(event) => setSourcePath(event.target.value)}
                    value={sourcePath}
                  />
                  {isDesktop ? (
                    <button
                      className="button button-ghost"
                      disabled={actionDisabled}
                      onClick={() => chooseLearningLibrary("选择迁移来源", setSourcePath)}
                      type="button"
                    >
                      浏览…
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="settings-path-field">
                <label htmlFor="settings-destination-path">迁移目标</label>
                <div className="settings-path-control">
                  <input
                    id="settings-destination-path"
                    onChange={(event) => setDestinationPath(event.target.value)}
                    value={destinationPath}
                  />
                  {isDesktop ? (
                    <button
                      className="button button-ghost"
                      disabled={actionDisabled}
                      onClick={() =>
                        chooseLearningLibrary("选择迁移目标", setDestinationPath)
                      }
                      type="button"
                    >
                      浏览…
                    </button>
                  ) : null}
                </div>
              </div>
              <button
                className="button"
                disabled={actionDisabled}
                onClick={() => setPendingConfirmation("migrate")}
                type="button"
              >
                迁移学习库
              </button>
            </div>
          </section>
        ) : null}

        {pendingConfirmation === "migrate" ? (
          <section className="settings-confirm" aria-label="确认迁移">
            <p>迁移会复制来源学习库到目标目录，并在成功后选择目标学习库。</p>
            <button className="button" disabled={actionDisabled} onClick={migrateVault} type="button">
              确认迁移
            </button>
          </section>
        ) : null}

        {pendingConfirmation === "backup" ? (
          <section className="settings-confirm" aria-label="确认备份">
            <p>备份会在当前学习库旁边创建时间戳副本，不会改变当前学习库。</p>
            <button className="button" disabled={actionDisabled} onClick={backupVault} type="button">
              确认备份
            </button>
          </section>
        ) : null}

        {pendingConfirmation === "exit" ? (
          <section className="settings-confirm" aria-label="确认退出">
            <p>退出会停止本地服务；学习库中的已保存内容不会被删除。</p>
            <button className="button" disabled={actionDisabled} onClick={exitWorkbench} type="button">
              确认退出
            </button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
