import {
  cancelDelayingLibraryMutation,
  cancelPendingLibrarySwitch,
  retryLibrarySwitchRecovery,
  useLibraryMutationState
} from "../../lib/library-mutation-coordinator";

type LibraryMutationState = ReturnType<typeof useLibraryMutationState>;

export function LibrarySwitchRecoveryNotice({
  mutationState,
  onError
}: Readonly<{
  mutationState: LibraryMutationState;
  onError: (message: string) => void;
}>) {
  if (mutationState.delayedSwitch === null) {
    return null;
  }

  return (
    <section
      aria-live="polite"
      className="settings-switch-recovery"
      role="status"
    >
      <div>
        <p className="eyebrow">Local library safety</p>
        <h3>学习库切换等待时间较长</h3>
        {mutationState.delayingMutation !== null ? (
          <p>
            “{mutationState.delayingMutation.label}”仍在处理。为避免把保存写入错误的学习库，
            Aleksi 会等它安全结束后再继续。
          </p>
        ) : mutationState.delayedSwitch.phase === "recovering" ? (
          <p>
            本地服务暂时无法确认“
            {mutationState.delayedSwitch.label}”的最终结果。为避免把旧内容写进错误的学习库，
            保存仍保持锁定；请确认本地服务正在运行后重新连接。
          </p>
        ) : mutationState.delayedSwitch.phase === "committing" ? (
          <p>
            “{mutationState.delayedSwitch.label}”已进入本地提交阶段。此时不能中断，
            以免留下不完整的学习库状态。
          </p>
        ) : (
          <p>
            “{mutationState.delayedSwitch.label}”正在等待前一个学习库操作安全结束。
          </p>
        )}
      </div>
      <div className="settings-switch-recovery__actions">
        {mutationState.delayedSwitch.phase === "recovering" ? (
          <button
            className="button"
            onClick={() => {
              const switchId = mutationState.delayedSwitch?.id;
              if (
                switchId === undefined ||
                !retryLibrarySwitchRecovery(switchId)
              ) {
                onError("当前确认操作已更新，请查看最新状态后重试。");
              }
            }}
            type="button"
          >
            重新连接并确认切换结果
          </button>
        ) : null}
        {mutationState.delayedSwitch.cancellable ? (
          <button
            className="button button-ghost"
            onClick={() => {
              const switchId = mutationState.delayedSwitch?.id;
              if (
                switchId === undefined ||
                !cancelPendingLibrarySwitch(switchId)
              ) {
                onError("切换已进入提交阶段，不能再取消。");
              }
            }}
            type="button"
          >
            取消切换
          </button>
        ) : null}
        {mutationState.delayingMutation?.cancellable === true ? (
          <button
            className="button"
            onClick={() => {
              const mutationId = mutationState.delayingMutation?.id;
              if (
                mutationId === undefined ||
                !cancelDelayingLibraryMutation(mutationId)
              ) {
                onError("这个保存已进入提交阶段，不能安全取消。");
              }
            }}
            type="button"
          >
            取消卡住的保存并重试
          </button>
        ) : null}
      </div>
    </section>
  );
}
