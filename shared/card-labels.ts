import {
  CARD_TYPES,
  LEGACY_CARD_TYPES,
  PRIMARY_CARD_TYPES,
  type CardType
} from "./card-types";

export type CardLabel = {
  label: string;
  shortLabel: string;
  description: string;
  isPrimary: boolean;
  isLegacy: boolean;
};

const PRIMARY_LABELS: Record<(typeof PRIMARY_CARD_TYPES)[number], CardLabel> = {
  concept: {
    label: "\u6982\u5ff5\u5361",
    shortLabel: "\u6982\u5ff5",
    description: "\u6c89\u6dc0\u6982\u5ff5\u542b\u4e49\u3001\u4e2a\u4eba\u7406\u89e3\u548c\u4f7f\u7528\u573a\u666f\u3002",
    isPrimary: true,
    isLegacy: false
  },
  example: {
    label: "\u4f8b\u5b50\u5361",
    shortLabel: "\u4f8b\u5b50",
    description: "\u8bb0\u5f55\u5178\u578b\u4f8b\u5b50\u4ee5\u652f\u6491\u8fc1\u79fb\u548c\u8bc6\u522b\u3002",
    isPrimary: true,
    isLegacy: false
  },
  boundary: {
    label: "\u8fb9\u754c\u5361",
    shortLabel: "\u8fb9\u754c",
    description: "\u62c6\u5206\u6613\u6df7\u5bf9\u8c61\u548c\u5224\u65ad\u6807\u51c6\u3002",
    isPrimary: true,
    isLegacy: false
  },
  process: {
    label: "\u6d41\u7a0b\u5361",
    shortLabel: "\u6d41\u7a0b",
    description: "\u5c06\u53ef\u91cd\u590d\u4efb\u52a1\u6c89\u6dc0\u4e3a\u6b65\u9aa4\u548c\u5173\u952e\u8f6c\u6298\u3002",
    isPrimary: true,
    isLegacy: false
  },
  mistake: {
    label: "\u9519\u8bef\u5361",
    shortLabel: "\u9519\u8bef",
    description: "\u8bb0\u5f55\u9519\u8bef\u8868\u73b0\u3001\u771f\u6b63\u539f\u56e0\u548c\u8bc6\u522b\u4fe1\u53f7\u3002",
    isPrimary: true,
    isLegacy: false
  }
};

const LEGACY_LABELS: Record<(typeof LEGACY_CARD_TYPES)[number], CardLabel> = {
  definition: {
    label: "\u5b9a\u4e49\u5361",
    shortLabel: "\u5b9a\u4e49",
    description: "\u4fdd\u7559\u7528\u4e8e\u8bfb\u53d6\u548c\u7ef4\u62a4\u65e7\u6570\u5b66\u5b9a\u4e49\u5361\u3002",
    isPrimary: false,
    isLegacy: true
  },
  counterexample: {
    label: "\u53cd\u4f8b\u5361",
    shortLabel: "\u53cd\u4f8b",
    description: "\u4fdd\u7559\u7528\u4e8e\u8bfb\u53d6\u548c\u7ef4\u62a4\u65e7\u53cd\u4f8b\u5361\u3002",
    isPrimary: false,
    isLegacy: true
  },
  proof: {
    label: "\u8bc1\u660e\u5361",
    shortLabel: "\u8bc1\u660e",
    description: "\u4fdd\u7559\u7528\u4e8e\u8bfb\u53d6\u548c\u7ef4\u62a4\u65e7\u8bc1\u660e\u5361\u3002",
    isPrimary: false,
    isLegacy: true
  }
};

export const CARD_LABELS = Object.fromEntries(
  CARD_TYPES.map((type) => [
    type,
    type in PRIMARY_LABELS
      ? PRIMARY_LABELS[type as keyof typeof PRIMARY_LABELS]
      : LEGACY_LABELS[type as keyof typeof LEGACY_LABELS]
  ])
) as Record<CardType, CardLabel>;
