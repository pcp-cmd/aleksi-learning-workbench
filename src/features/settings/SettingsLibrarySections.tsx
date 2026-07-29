import type { Dispatch, SetStateAction } from "react";
import { SaveReceipt } from "../../components/SaveReceipt";
import { StatusDot } from "../../components/StatusDot";

export type VaultStatus = {
  path: string;
  initialized: boolean;
  writable: boolean;
  readOnlyReason: string | null;
  lastSaveAt: string | null;
};

export type PendingConfirmation = "migrate" | "backup" | "exit" | null;

type ChooseLearningLibrary = (
  label: string,
  updatePath: (path: string) => void
) => void;

type PathSetter = Dispatch<SetStateAction<string>>;

function writableLabel(status: VaultStatus | null): string {
  if (status === null) {
    return "未配置";
  }
  return status.writable ? "可写" : "只读";
}

export function LibraryLocationSection({
  actionDisabled,
  initializePath,
  isDesktop,
  onChooseLearningLibrary,
  onInitialize,
  onRequestBackup,
  onSelect,
  recommendedVaultPath,
  selectPath,
  setInitializePath,
  setSelectPath,
  status
}: Readonly<{
  actionDisabled: boolean;
  initializePath: string;
  isDesktop: boolean;
  onChooseLearningLibrary: ChooseLearningLibrary;
  onInitialize: () => void;
  onRequestBackup: () => void;
  onSelect: () => void;
  recommendedVaultPath: string;
  selectPath: string;
  setInitializePath: PathSetter;
  setSelectPath: PathSetter;
  status: VaultStatus | null;
}>) {
  return (
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

      <div className="settings-form-grid settings-form-grid--library">
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
                  onChooseLearningLibrary(
                    "选择新学习库位置",
                    setInitializePath
                  )
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
          onClick={onInitialize}
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
                  onChooseLearningLibrary("选择现有学习库", setSelectPath)
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
          onClick={onSelect}
          type="button"
        >
          更换学习库
        </button>

        <button
          className="button"
          disabled={actionDisabled}
          onClick={onRequestBackup}
          type="button"
        >
          备份学习库
        </button>
      </div>
    </section>
  );
}

export function AdvancedLibrarySection({
  actionDisabled,
  destinationPath,
  isDesktop,
  onChooseLearningLibrary,
  onRequestMigrate,
  receipt,
  setDestinationPath,
  setSourcePath,
  sourcePath,
  status
}: Readonly<{
  actionDisabled: boolean;
  destinationPath: string;
  isDesktop: boolean;
  onChooseLearningLibrary: ChooseLearningLibrary;
  onRequestMigrate: () => void;
  receipt: { at: string | null; label: string; path: string | null };
  setDestinationPath: PathSetter;
  setSourcePath: PathSetter;
  sourcePath: string;
  status: VaultStatus | null;
}>) {
  return (
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

      <div className="settings-form-grid settings-form-grid--migration">
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
                onClick={() =>
                  onChooseLearningLibrary("选择迁移来源", setSourcePath)
                }
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
                  onChooseLearningLibrary("选择迁移目标", setDestinationPath)
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
          onClick={onRequestMigrate}
          type="button"
        >
          迁移学习库
        </button>
      </div>
    </section>
  );
}

export function SettingsConfirmation({
  actionDisabled,
  onBackup,
  onExit,
  onMigrate,
  pending
}: Readonly<{
  actionDisabled: boolean;
  onBackup: () => void;
  onExit: () => void;
  onMigrate: () => void;
  pending: PendingConfirmation;
}>) {
  if (pending === null) {
    return null;
  }
  const content = {
    backup: {
      ariaLabel: "确认备份",
      button: "确认备份",
      message: "备份会在当前学习库旁边创建时间戳副本，不会改变当前学习库。",
      onConfirm: onBackup
    },
    exit: {
      ariaLabel: "确认退出",
      button: "确认退出",
      message: "退出会停止本地服务；学习库中的已保存内容不会被删除。",
      onConfirm: onExit
    },
    migrate: {
      ariaLabel: "确认迁移",
      button: "确认迁移",
      message: "迁移会复制来源学习库到目标目录，并在成功后选择目标学习库。",
      onConfirm: onMigrate
    }
  }[pending];

  return (
    <section className="settings-confirm" aria-label={content.ariaLabel}>
      <p>{content.message}</p>
      <button
        className="button"
        disabled={actionDisabled}
        onClick={content.onConfirm}
        type="button"
      >
        {content.button}
      </button>
    </section>
  );
}
