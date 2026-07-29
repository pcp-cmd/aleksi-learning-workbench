import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApplicationCloseOutcome } from "../../app/application-close";
import { resetLibraryBackedQueries } from "../../app/query-invalidation";
import { desktopRuntime } from "../../desktop/runtime";
import { apiClient } from "../../lib/api-client";
import { useLibraryMutationState } from "../../lib/library-mutation-coordinator";
import {
  activateLibraryDraftIdentity,
  switchLibraryDraftIdentity
} from "../../lib/active-library-drafts";
import { normalizeUserSuppliedVaultPath } from "../../../shared/user-path";
import {
  confirmDiscardUnsavedChanges,
  UNSAVED_CHANGES_MESSAGE
} from "../../lib/unsaved-guard";
import {
  BackupRecoverySection,
  type RestoredVaultStatus
} from "./BackupRecoverySection";
import { LibraryHealthSection } from "./LibraryHealthSection";
import { LibrarySwitchRecoveryNotice } from "./LibrarySwitchRecoveryNotice";
import {
  AdvancedLibrarySection,
  LibraryLocationSection,
  SettingsConfirmation,
  type PendingConfirmation,
  type VaultStatus
} from "./SettingsLibrarySections";
import {
  SettingsRuntimeSection,
  type RuntimeCapabilities
} from "./SettingsRuntimeSection";

export interface SettingsDialogProps {
  onClose: () => void;
  onLibraryChanged?: () => void;
  onRequestApplicationClose: () => Promise<ApplicationCloseOutcome>;
  open: boolean;
}

const EMPTY_SETTINGS_PATHS = JSON.stringify({
  destinationPath: "",
  initializePath: "",
  selectPath: "",
  sourcePath: ""
});

export function SettingsDialog({
  onClose,
  onLibraryChanged,
  onRequestApplicationClose,
  open
}: SettingsDialogProps) {
  const queryClient = useQueryClient();
  const mutationState = useLibraryMutationState();
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
          if (result.status !== null) {
            activateLibraryDraftIdentity(result.status.path);
          }
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
    switchLibraryDraftIdentity(status?.path ?? null, nextStatus.path);
    resetLibraryBackedQueries(queryClient);
    applyStatus(nextStatus, label);
    onLibraryChanged?.();
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
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }
    runSettingsAction("创建本地学习库", async () => {
      const result = await apiClient.post<{ status: VaultStatus }>(
        "/api/vault/initialize",
        { path: normalizeUserSuppliedVaultPath(initializePath) }
      );
      applyChangedLibrary(result.status, "创建完成");
    });
  };

  const selectVault = () => {
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }
    runSettingsAction("更换学习库", async () => {
      const result = await apiClient.post<{ status: VaultStatus }>(
        "/api/vault/select",
        { path: normalizeUserSuppliedVaultPath(selectPath) }
      );
      applyChangedLibrary(result.status, "更换完成");
    });
  };

  const migrateVault = () => {
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }
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
        const outcome = await onRequestApplicationClose();
        if (outcome !== "exited") {
          if (typeof outcome === "object" && outcome.status === "failed") {
            setError(`无法安全退出：${outcome.message}`);
          }
          setPendingConfirmation(null);
          return;
        }
      } else {
        await apiClient.post<{ exiting: true }>("/api/runtime/exit", {
          confirmed: true
        });
      }
      setPendingConfirmation(null);
      setLifecycleMessage("退出请求已发送，可以关闭此窗口。");
    });
  };

  const actionDisabled = saving !== null || mutationState.switching;
  const closeDialog = () => {
    if (
      pathSnapshot === cleanSnapshot ||
      window.confirm(UNSAVED_CHANGES_MESSAGE)
    ) {
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
        <LibrarySwitchRecoveryNotice
          mutationState={mutationState}
          onError={setError}
        />

        <LibraryLocationSection
          actionDisabled={actionDisabled}
          initializePath={initializePath}
          isDesktop={isDesktop}
          onChooseLearningLibrary={chooseLearningLibrary}
          onInitialize={initializeVault}
          onRequestBackup={() => setPendingConfirmation("backup")}
          onSelect={selectVault}
          recommendedVaultPath={recommendedVaultPath}
          selectPath={selectPath}
          setInitializePath={setInitializePath}
          setSelectPath={setSelectPath}
          status={status}
        />

        <LibraryHealthSection locatorReady={status?.initialized === true} />

        <BackupRecoverySection
          active={status?.initialized === true}
          disabled={actionDisabled}
          isDesktop={isDesktop}
          onChooseDestination={(updatePath) =>
            chooseLearningLibrary("选择备份恢复位置", updatePath)
          }
          onRestored={(nextStatus: RestoredVaultStatus, backupPath) => {
            applyChangedLibrary(nextStatus, "恢复完成");
            setReceipt({
              at: nextStatus.lastSaveAt,
              label: "恢复完成",
              path: backupPath
            });
          }}
          runAction={runSettingsAction}
        />

        <SettingsRuntimeSection
          actionDisabled={actionDisabled}
          capabilities={runtimeCapabilities}
          isDesktop={isDesktop}
          lifecycleMessage={lifecycleMessage}
          onExportDiagnostics={exportDiagnostics}
          onOpenLearningLibrary={openLearningLibrary}
          onRequestExit={() => setPendingConfirmation("exit")}
        />

        <button
          aria-expanded={advancedOpen}
          className="button button-ghost"
          onClick={() => setAdvancedOpen((current) => !current)}
          type="button"
        >
          {advancedOpen ? "收起高级设置" : "显示高级设置"}
        </button>

        {advancedOpen ? (
          <AdvancedLibrarySection
            actionDisabled={actionDisabled}
            destinationPath={destinationPath}
            isDesktop={isDesktop}
            onChooseLearningLibrary={chooseLearningLibrary}
            onRequestMigrate={() => setPendingConfirmation("migrate")}
            receipt={receipt}
            setDestinationPath={setDestinationPath}
            setSourcePath={setSourcePath}
            sourcePath={sourcePath}
            status={status}
          />
        ) : null}

        <SettingsConfirmation
          actionDisabled={actionDisabled}
          onBackup={backupVault}
          onExit={exitWorkbench}
          onMigrate={migrateVault}
          pending={pendingConfirmation}
        />
      </div>
    </div>
  );
}
