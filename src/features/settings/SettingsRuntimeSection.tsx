import { StatusDot } from "../../components/StatusDot";

export type RuntimeCapabilities = {
  mode: string;
  identity: {
    version: string;
    buildId: string;
  };
  openLearningLibrary: boolean;
  exportDiagnostics: boolean;
  exitWorkbench: boolean;
};

export function SettingsRuntimeSection({
  actionDisabled,
  capabilities,
  isDesktop,
  lifecycleMessage,
  onExportDiagnostics,
  onOpenLearningLibrary,
  onRequestExit
}: Readonly<{
  actionDisabled: boolean;
  capabilities: RuntimeCapabilities | null;
  isDesktop: boolean;
  lifecycleMessage: string | null;
  onExportDiagnostics: () => void;
  onOpenLearningLibrary: () => void;
  onRequestExit: () => void;
}>) {
  return (
    <section className="settings-status" aria-label="应用与诊断">
      <StatusDot
        label="本地应用"
        tone={capabilities?.exitWorkbench ? "active" : "blocked"}
      />
      <dl>
        <div>
          <dt>Product</dt>
          <dd>Aleksi Workbench</dd>
        </div>
        <div>
          <dt>运行模式</dt>
          <dd>{capabilities?.mode ?? "正在读取"}</dd>
        </div>
        <div>
          <dt>版本</dt>
          <dd>{capabilities?.identity.version ?? "—"}</dd>
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
      <div className="settings-form-grid settings-form-grid--actions">
        <button
          className="button"
          disabled={
            actionDisabled || capabilities?.openLearningLibrary !== true
          }
          onClick={onOpenLearningLibrary}
          type="button"
        >
          打开本地学习库
        </button>
        {isDesktop ? (
          <button
            className="button button-ghost"
            disabled={
              actionDisabled || capabilities?.exportDiagnostics !== true
            }
            onClick={onExportDiagnostics}
            type="button"
          >
            导出诊断
          </button>
        ) : (
          <a
            aria-disabled={capabilities?.exportDiagnostics !== true}
            className="button button-ghost"
            download
            href="/api/runtime/diagnostics"
            onClick={(event) => {
              if (capabilities?.exportDiagnostics !== true) {
                event.preventDefault();
              }
            }}
          >
            导出诊断
          </a>
        )}
        <button
          className="button button-ghost"
          disabled={actionDisabled || capabilities?.exitWorkbench !== true}
          onClick={onRequestExit}
          type="button"
        >
          退出 Aleksi Workbench
        </button>
      </div>
    </section>
  );
}
