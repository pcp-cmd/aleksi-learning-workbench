export type CardSaveState =
  | "unsaved"
  | "saving"
  | "saved"
  | "modified-after-save"
  | "save-failed";

type CardSaveStateInput = {
  dirty: boolean;
  error: string | null;
  receipt: object | null;
  saving: boolean;
};

export function cardSaveState({
  dirty,
  error,
  receipt,
  saving
}: CardSaveStateInput): CardSaveState {
  if (saving) {
    return "saving";
  }
  if (error !== null) {
    return "save-failed";
  }
  if (receipt === null) {
    return "unsaved";
  }
  return dirty ? "modified-after-save" : "saved";
}

export const CARD_SAVE_STATE_LABELS: Record<CardSaveState, string> = {
  unsaved: "尚未保存",
  saving: "正在保存",
  saved: "已保存",
  "modified-after-save": "保存后有修改",
  "save-failed": "保存失败，草稿仍在"
};

export const CARD_SAVE_BUTTON_LABELS: Record<CardSaveState, string> = {
  unsaved: "保存卡片",
  saving: "正在保存",
  saved: "已保存",
  "modified-after-save": "保存修改",
  "save-failed": "重试保存"
};
