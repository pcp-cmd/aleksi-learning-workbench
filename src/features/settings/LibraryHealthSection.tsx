import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../app/query-keys";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import { useLibraryIdentity } from "../../lib/library-identity";

type ProjectionHealth = Readonly<{
  status: "fresh" | "stale";
  attempts: number;
  category: string | null;
}>;

type CleanupHealth = Readonly<{
  status: "healthy" | "failed";
  attempts: number;
  category: string | null;
}>;

type TransactionHealth = Readonly<{
  transactionId: string;
  operation: string;
  state: "quarantined" | "unreadable" | "orphaned";
}>;

export type LibraryHealthSnapshot = Readonly<{
  blocked: boolean;
  transactions: readonly TransactionHealth[];
  projections: Readonly<{ index: ProjectionHealth | null }>;
  backupCleanup: CleanupHealth | null;
  quarantineCleanup: CleanupHealth | null;
}>;

function useLibraryHealth(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.vault.health,
    queryFn: () =>
      apiClient.get<LibraryHealthSnapshot>("/api/vault/health"),
    enabled,
    retry: false,
    staleTime: 2_000,
    refetchInterval: 5_000
  });
}

function HealthItem({
  detail,
  label,
  problem
}: Readonly<{
  detail: string;
  label: string;
  problem: boolean;
}>) {
  return (
    <div className="library-health-item">
      <StatusDot
        label={label}
        tone={problem ? "blocked" : "active"}
      />
      <p>{detail}</p>
    </div>
  );
}

export function LibraryHealthSection({
  locatorReady
}: Readonly<{ locatorReady: boolean }>) {
  const health = useLibraryHealth(locatorReady);
  const snapshot = health.data;
  const blocked = snapshot?.blocked === true;
  const indexStale = snapshot?.projections.index?.status === "stale";
  const backupFailed = snapshot?.backupCleanup?.status === "failed";
  const quarantineFailed =
    snapshot?.quarantineCleanup?.status === "failed";

  return (
    <section
      aria-label="学习库健康"
      className="settings-status library-health"
    >
      <div className="library-health__heading">
        <div>
          <p className="eyebrow">Library health</p>
          <h3>学习库健康</h3>
        </div>
        <span
          className={`library-health__summary${
            blocked ? " library-health__summary--blocked" : ""
          }`}
        >
          {blocked ? "需要处理" : "当前可用"}
        </span>
      </div>

      <div className="library-health__grid">
        <HealthItem
          detail={
            blocked
              ? "检测到未完成的本地写入。为避免覆盖内容，保存会保持锁定，直到恢复完成。"
              : health.isError
                ? "暂时无法读取写入安全状态；请确认本地服务正在运行。"
                : health.isPending && locatorReady
                  ? "正在检查未完成的本地写入。"
                  : "没有未完成事务阻塞新的保存。"
          }
          label={blocked ? "写入已暂停" : "写入安全"}
          problem={blocked || health.isError}
        />
        <HealthItem
          detail={
            locatorReady
              ? "当前设置已绑定到一个可识别的本地学习库。"
              : "请在上方创建或重新选择学习库；确认位置前不会写入学习内容。"
          }
          label={
            locatorReady ? "学习库位置已确认" : "学习库位置尚未确认"
          }
          problem={!locatorReady}
        />
        <HealthItem
          detail={
            indexStale
              ? "正文仍是权威数据；索引需要重新生成后，搜索和卡片列表才会完全更新。"
              : "没有发现待恢复的索引故障。"
          }
          label={indexStale ? "索引需要重建" : "索引正常"}
          problem={indexStale}
        />
        <HealthItem
          detail={
            backupFailed
              ? "上次备份保留清理未完成；备份和学习正文仍保留，请先导出清单再重试。"
              : "没有发现待处理的备份保留清理故障。"
          }
          label={backupFailed ? "备份清理上次失败" : "备份清理正常"}
          problem={backupFailed}
        />
        <HealthItem
          detail={
            quarantineFailed
              ? "上次隔离证据清理未完成；证据仍保留，可在备份与恢复区域重新导出后处理。"
              : "没有发现待处理的隔离证据清理故障。"
          }
          label={
            quarantineFailed ? "隔离清理上次失败" : "隔离清理正常"
          }
          problem={quarantineFailed}
        />
      </div>

      {blocked ? (
        <p className="library-health__guidance">
          此提示不能手动关闭。恢复未完成事务后，Aleksi 会自动重新检查并解除写入锁定。
        </p>
      ) : null}
    </section>
  );
}

export function LibraryWriteBlockWarning({
  onOpenSettings
}: Readonly<{ onOpenSettings: () => void }>) {
  const identity = useLibraryIdentity();
  const health = useLibraryHealth(identity !== null);

  if (health.data?.blocked !== true) {
    return null;
  }

  return (
    <aside className="library-health-banner" role="alert">
      <div>
        <strong>学习库写入已暂停</strong>
        <span>
          检测到未完成的本地事务。现有内容仍可查看，恢复完成前不会继续保存。
        </span>
      </div>
      <button className="button" onClick={onOpenSettings} type="button">
        打开设置查看恢复详情
      </button>
    </aside>
  );
}
