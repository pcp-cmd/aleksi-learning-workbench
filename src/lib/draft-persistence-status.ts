import { useSyncExternalStore } from "react";
import type { DraftWriteResult } from "./draft-store";

const listeners = new Set<() => void>();
let warning: string | null = null;

function publish(next: string | null): void {
  if (warning === next) return;
  warning = next;
  listeners.forEach((listener) => listener());
}

export function reportDraftWriteResult(result: DraftWriteResult): void {
  if (result.ok && result.persisted) {
    publish(null);
  } else if (result.ok) {
    publish("草稿暂时只能保留在本次运行的内存中；请尽快完成正式保存。");
  } else if (result.code === "DRAFT_TOO_LARGE") {
    publish("草稿超过本地安全存储上限；请缩短内容或立即完成正式保存。");
  } else {
    publish("草稿内容无效，未能写入本地恢复存储。");
  }
}

export function dismissDraftPersistenceWarning(): void {
  publish(null);
}

function getSnapshot(): string | null {
  return warning;
}

export function useDraftPersistenceWarning(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot,
    getSnapshot
  );
}
