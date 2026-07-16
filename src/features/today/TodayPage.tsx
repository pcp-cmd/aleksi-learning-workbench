import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../app/query-keys";
import { Link } from "react-router-dom";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";

type VaultStatus = {
  path: string;
  initialized: boolean;
  writable: boolean;
  readOnlyReason: string | null;
  lastSaveAt: string | null;
};

type TodayActionKind =
  | "due-review"
  | "remediation"
  | "graph-gap"
  | "continue-reading"
  | "new-reading";

type TodayNextAction = {
  kind: TodayActionKind;
  title: string;
  reason: string;
  href: string;
  estimatedMinutes: number;
  concept: string | null;
  count: number;
};

type TodayNextResponse = {
  nextAction: TodayNextAction;
  later: Array<{
    kind: string;
    title: string;
    href: string;
  }>;
};

const ACTION_LABELS: Record<TodayActionKind, string> = {
  "due-review": "到期复习",
  remediation: "最小补救",
  "graph-gap": "关键缺口",
  "continue-reading": "继续精读",
  "new-reading": "开始新精读"
};

function useLearningLibrary() {
  return useQuery({
    queryKey: queryKeys.vault.autoPrepare,
    queryFn: async () =>
      (await apiClient.post<{ status: VaultStatus }>("/api/vault/auto-prepare"))
        .status
  });
}

function useTodayNext(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.today.next,
    queryFn: () => apiClient.get<TodayNextResponse>("/api/today/next"),
    enabled
  });
}

function actionTone(kind: TodayActionKind): "active" | "due" | "blocked" {
  if (kind === "due-review") {
    return "due";
  }
  if (kind === "remediation") {
    return "blocked";
  }
  return "active";
}

export function TodayPage() {
  const learningLibrary = useLearningLibrary();
  const hasReadyLibrary =
    learningLibrary.data?.initialized === true && learningLibrary.data.writable;
  const todayNext = useTodayNext(hasReadyLibrary);
  const loading =
    learningLibrary.isPending || (hasReadyLibrary && todayNext.isPending);
  const failed =
    learningLibrary.isError ||
    (learningLibrary.data !== undefined && !hasReadyLibrary) ||
    (hasReadyLibrary && todayNext.isError);

  if (loading) {
    return (
      <section className="route-stage today-page" aria-labelledby="today-title">
        <p className="eyebrow">Today</p>
        <h1 id="today-title">今日学习</h1>
        <p className="route-stage__summary">正在准备本地学习库。</p>
      </section>
    );
  }

  if (failed || todayNext.data === undefined) {
    return (
      <section className="route-stage today-page" aria-labelledby="today-title">
        <p className="eyebrow">Today</p>
        <h1 id="today-title">今日学习</h1>
        <div className="surface-static">
          <StatusDot label="本地学习库无法访问" tone="blocked" />
          <p>请打开设置选择其他位置或创建新的学习库。</p>
        </div>
      </section>
    );
  }

  const { nextAction, later } = todayNext.data;

  return (
    <section className="route-stage today-page" aria-labelledby="today-title">
      <p className="eyebrow">Today</p>
      <h1 id="today-title">今日学习</h1>
      <p className="route-stage__summary">
        不用先理解文件夹、路径或索引。今天只做系统排在最前面的这一步。
      </p>

      <article
        aria-label="今日唯一下一步"
        className="surface-static today-next-card"
      >
        <div className="today-next-card__status">
          <StatusDot
            label={ACTION_LABELS[nextAction.kind]}
            tone={actionTone(nextAction.kind)}
          />
          <span>{nextAction.estimatedMinutes} 分钟</span>
        </div>
        <div className="today-next-card__copy">
          <p className="today-next-card__marker">ONLY NEXT STEP</p>
          <h2>{nextAction.title}</h2>
          <p>{nextAction.reason}</p>
          {nextAction.concept === null ? null : (
            <p className="today-next-card__concept">当前概念 · {nextAction.concept}</p>
          )}
        </div>
        <Link
          aria-label={`开始：${nextAction.title}`}
          className="button today-next-card__start"
          to={nextAction.href}
        >
          开始
        </Link>
      </article>

      {later.length === 0 ? null : (
        <details className="today-later surface-static">
          <summary className="today-later__heading">
            <span id="today-later-title">稍后 · {later.length} 项支持行动</span>
            <small>完成当前一步后重新排序</small>
          </summary>
          <ul>
            {later.map((action, index) => (
              <li key={`${action.kind}-${action.title}-${index}`}>
                <span>{String(index + 2).padStart(2, "0")}</span>
                <strong>{action.title}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
