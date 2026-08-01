import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { invalidateAfterMutation } from "../../app/query-invalidation";
import { queryKeys } from "../../app/query-keys";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import {
  libraryQueryScope,
  useLibraryIdentity
} from "../../lib/library-identity";
import type { CardType } from "./card-draft";

type CardLibraryItem = {
  id: string;
  title: string;
  concept: string | null;
  type: CardType;
  typeLabel: string;
  mastery: "learning" | "due" | "mastered" | "rebuild" | "archived" | null;
  nextReview: string | null;
  createdAt: string | null;
  updatedAt: string;
  archived: boolean;
};

type CardLibraryResponse = {
  cards: CardLibraryItem[];
  pageInfo: {
    hasMore: boolean;
    nextCursor: string | null;
  };
  degraded: {
    active: boolean;
    parseErrorCount: number;
    recoveryAction: "rebuild-index" | null;
  };
};

type CardLibraryProps = {
  onEditCard: (cardId: string) => void;
  onOpenCard: (cardId: string) => void;
};

const MASTERY_LABELS: Record<string, string> = {
  learning: "学习中",
  due: "待复习",
  mastered: "已掌握",
  rebuild: "需重建",
  archived: "已归档"
};

function libraryUrl(options: {
  cursor: string | null;
  due: string;
  mastery: string;
  order: string;
  query: string;
  sort: string;
  type: string;
}): string {
  const params = new URLSearchParams({
    limit: "24",
    order: options.order,
    sort: options.sort
  });
  if (options.cursor !== null) params.set("cursor", options.cursor);
  if (options.query.trim() !== "") params.set("query", options.query.trim());
  if (options.type !== "") params.set("type", options.type);
  if (options.mastery !== "") params.set("mastery", options.mastery);
  if (options.due !== "") params.set("due", options.due);
  return `/api/cards/library?${params.toString()}`;
}

export function CardLibrary({ onEditCard, onOpenCard }: CardLibraryProps) {
  const identity = useLibraryIdentity();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [mastery, setMastery] = useState("");
  const [due, setDue] = useState("");
  const [sort, setSort] = useState("updated");
  const [order, setOrder] = useState("desc");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const url = useMemo(
    () => libraryUrl({ cursor, due, mastery, order, query: search, sort, type }),
    [cursor, due, mastery, order, search, sort, type]
  );
  const library = useQuery({
    queryKey: [
      ...queryKeys.cards.library,
      url,
      ...libraryQueryScope(identity)
    ],
    queryFn: ({ signal }) =>
      apiClient.get<CardLibraryResponse>(url, { signal })
  });

  const resetPage = () => {
    setCursor(null);
    setCursorHistory([]);
  };

  const rebuildIndex = async () => {
    setActionError(null);
    setRebuilding(true);
    try {
      await apiClient.post("/api/index/rebuild", { confirmed: true });
      await queryClient.invalidateQueries({ queryKey: queryKeys.cards.all });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "重建卡片索引失败"
      );
    } finally {
      setRebuilding(false);
    }
  };

  const archiveCard = async (card: CardLibraryItem) => {
    if (!window.confirm(`确认归档“${card.title}”？原始 Markdown 会安全移动到归档区。`)) {
      return;
    }
    setActionError(null);
    setArchivingId(card.id);
    try {
      const detail = await apiClient.get<{
        card: { version: unknown };
      }>(`/api/cards/${card.id}`);
      await apiClient.post(`/api/cards/${card.id}/archive`, {
        confirmed: true,
        expectedVersion: detail.card.version
      });
      resetPage();
      await invalidateAfterMutation(queryClient, "card-saved");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "归档卡片失败");
    } finally {
      setArchivingId(null);
    }
  };

  const previousPage = () => {
    const previous = cursorHistory.at(-1) ?? null;
    setCursorHistory((history) => history.slice(0, -1));
    setCursor(previous === "" ? null : previous);
  };

  const nextPage = () => {
    const next = library.data?.pageInfo.nextCursor;
    if (next === null || next === undefined) return;
    setCursorHistory((history) => [...history, cursor ?? ""]);
    setCursor(next);
  };

  return (
    <section
      aria-labelledby="card-library-title"
      className="surface-static card-library"
      role="region"
    >
      <div className="card-library__heading">
        <div>
          <p className="eyebrow">Card Library</p>
          <h2 id="card-library-title">全部卡片</h2>
        </div>
        <StatusDot label="本地索引 · 有界查询" tone="active" />
      </div>

      <div className="card-library__filters" role="search">
        <label className="card-library__search">
          搜索标题或概念
          <input
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
            placeholder="例如：积分、紧致性"
            type="search"
            value={search}
          />
        </label>
        <label>
          卡片类型
          <select
            onChange={(event) => {
              setType(event.target.value);
              resetPage();
            }}
            value={type}
          >
            <option value="">全部类型</option>
            <option value="concept">概念卡</option>
            <option value="definition">定义卡</option>
            <option value="example">例子卡</option>
            <option value="boundary">边界卡</option>
            <option value="counterexample">反例卡</option>
            <option value="process">流程卡</option>
            <option value="mistake">错误卡</option>
            <option value="proof">证明卡</option>
          </select>
        </label>
        <label>
          掌握状态
          <select
            onChange={(event) => {
              setMastery(event.target.value);
              resetPage();
            }}
            value={mastery}
          >
            <option value="">全部状态</option>
            <option value="learning">学习中</option>
            <option value="due">待复习</option>
            <option value="mastered">已掌握</option>
            <option value="rebuild">需重建</option>
            <option value="archived">已归档</option>
          </select>
        </label>
        <label>
          到期时间
          <select
            onChange={(event) => {
              setDue(event.target.value);
              resetPage();
            }}
            value={due}
          >
            <option value="">全部日期</option>
            <option value="overdue">已逾期</option>
            <option value="today">今天</option>
            <option value="future">未来</option>
            <option value="none">未安排</option>
          </select>
        </label>
        <label>
          排序
          <select
            onChange={(event) => {
              setSort(event.target.value);
              resetPage();
            }}
            value={sort}
          >
            <option value="updated">更新时间</option>
            <option value="created">创建时间</option>
            <option value="title">标题</option>
            <option value="due">到期时间</option>
          </select>
        </label>
        <label>
          顺序
          <select
            onChange={(event) => {
              setOrder(event.target.value);
              resetPage();
            }}
            value={order}
          >
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </select>
        </label>
      </div>

      {library.data?.degraded.active ? (
        <div className="card-library__recovery" role="status">
          <div>
            <strong>卡片索引需要恢复</strong>
            <p>
              已有的可用卡片继续显示；重建只会刷新投影，不会删除权威 Markdown。
            </p>
          </div>
          <button
            className="button button-ghost"
            disabled={rebuilding}
            onClick={() => void rebuildIndex()}
            type="button"
          >
            {rebuilding ? "正在重建索引…" : "重建卡片索引"}
          </button>
        </div>
      ) : null}

      {actionError === null ? null : (
        <p className="settings-error" role="alert">
          {actionError}
        </p>
      )}
      {library.isPending ? (
        <p aria-live="polite">正在读取卡片索引…</p>
      ) : library.isError ? (
        <p className="settings-error" role="alert">
          {library.error instanceof Error
            ? library.error.message
            : "读取全部卡片失败"}
        </p>
      ) : library.data.cards.length === 0 ? (
        <div className="card-library__empty">
          <strong>没有符合当前条件的卡片</strong>
          <p>可调整筛选条件，或先从精读工作台沉淀一张卡片。</p>
        </div>
      ) : (
        <ul className="card-library__list" aria-label="卡片结果">
          {library.data.cards.map((card) => (
            <li className="card-library__item" key={card.id}>
              <button
                aria-label={`打开 ${card.title}`}
                className="card-library__open"
                onClick={() => onOpenCard(card.id)}
                type="button"
              >
                <span>
                  <strong>{card.title}</strong>
                  <small>
                    {card.typeLabel} ·{" "}
                    {MASTERY_LABELS[card.mastery ?? ""] ?? "未标记"}
                  </small>
                </span>
                <span>
                  <small>{card.concept ?? "未填写概念"}</small>
                  <time dateTime={card.updatedAt}>
                    {card.updatedAt.slice(0, 10)}
                  </time>
                </span>
              </button>
              {card.archived ? (
                <span className="card-library__archived">已归档</span>
              ) : (
                <div className="card-library__actions">
                  <button
                    aria-label={`编辑 ${card.title}`}
                    className="button button-ghost"
                    onClick={() => onEditCard(card.id)}
                    type="button"
                  >
                    编辑
                  </button>
                  <button
                    aria-label={`归档 ${card.title}`}
                    className="button button-ghost"
                    disabled={archivingId === card.id}
                    onClick={() => void archiveCard(card)}
                    type="button"
                  >
                    {archivingId === card.id ? "归档中…" : "归档"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="卡片库分页" className="card-library__pagination">
        <button
          className="button button-ghost"
          disabled={cursorHistory.length === 0}
          onClick={previousPage}
          type="button"
        >
          上一页
        </button>
        <span aria-live="polite">
          {cursorHistory.length === 0 ? "第 1 页" : `第 ${cursorHistory.length + 1} 页`}
        </span>
        <button
          className="button button-ghost"
          disabled={!library.data?.pageInfo.hasMore}
          onClick={nextPage}
          type="button"
        >
          下一页
        </button>
      </nav>
    </section>
  );
}
