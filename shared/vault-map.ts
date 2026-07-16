import {
  type CardType,
  type LegacyCardType,
  type PrimaryCardType
} from "./card-types";

export const READING_DIRECTORY = "\u0030\u0031-\u9605\u8bfb\u6750\u6599";

export const PRIMARY_CARD_DIRECTORIES = {
  concept: "\u0030\u0032-\u6982\u5ff5\u5361",
  example: "\u0030\u0033-\u4f8b\u5b50\u5361",
  boundary: "\u0030\u0034-\u8fb9\u754c\u5361",
  process: "\u0030\u0035-\u6d41\u7a0b\u5361",
  mistake: "\u0030\u0036-\u9519\u8bef\u5361"
} as const satisfies Record<PrimaryCardType, string>;

export const LEGACY_CARD_DIRECTORIES = {
  definition: "\u0030\u0032-\u5b9a\u4e49\u5361",
  counterexample: "\u0030\u0034-\u53cd\u4f8b\u5361",
  proof: "\u0030\u0035-\u8bc1\u660e\u5361"
} as const satisfies Record<LegacyCardType, string>;

export const CARD_DIRECTORIES = {
  ...PRIMARY_CARD_DIRECTORIES,
  ...LEGACY_CARD_DIRECTORIES
} as const satisfies Record<CardType, string>;

export const DIAGNOSIS_DIRECTORY = "\u0030\u0037-\u5361\u70b9\u8bca\u65ad";
export const REVIEW_DIRECTORY = "\u0030\u0038-\u590d\u4e60\u8bb0\u5f55";
export const LEGACY_REVIEW_DIRECTORY = "\u0030\u0038-\u98de\u8f6e\u590d\u4e60";
export const REVIEW_READ_DIRECTORIES = [
  REVIEW_DIRECTORY,
  LEGACY_REVIEW_DIRECTORY
] as const;
export const GRAPH_DIRECTORY = "\u0030\u0039-\u98de\u8f6e\u56fe\u8c31";
export const CODEX_TASK_DIRECTORY = "\u0031\u0030-Codex\u4efb\u52a1";
export const VERIFICATION_DIRECTORY = `${CODEX_TASK_DIRECTORY}/\u9a8c\u8bc1\u8bc1\u636e`;
export const ARCHIVE_DIRECTORY = "\u0039\u0039-\u5f52\u6863";
export const ALEKSI_DIRECTORY = ".aleksi";

export const DEFAULT_VAULT_DIRECTORIES = [
  READING_DIRECTORY,
  PRIMARY_CARD_DIRECTORIES.concept,
  PRIMARY_CARD_DIRECTORIES.example,
  PRIMARY_CARD_DIRECTORIES.boundary,
  PRIMARY_CARD_DIRECTORIES.process,
  PRIMARY_CARD_DIRECTORIES.mistake,
  DIAGNOSIS_DIRECTORY,
  REVIEW_DIRECTORY,
  CODEX_TASK_DIRECTORY,
  ARCHIVE_DIRECTORY,
  ALEKSI_DIRECTORY
] as const;

export type VaultAssetType =
  | "reading"
  | CardType
  | "diagnosis"
  | "review"
  | "codex-task";

export type ScanDirectory = {
  relativePath: string;
  assetType: VaultAssetType | null;
};

export const COMPATIBLE_SCAN_DIRECTORIES = [
  { relativePath: READING_DIRECTORY, assetType: "reading" },
  { relativePath: PRIMARY_CARD_DIRECTORIES.concept, assetType: "concept" },
  { relativePath: PRIMARY_CARD_DIRECTORIES.example, assetType: "example" },
  { relativePath: PRIMARY_CARD_DIRECTORIES.boundary, assetType: "boundary" },
  { relativePath: PRIMARY_CARD_DIRECTORIES.process, assetType: "process" },
  { relativePath: PRIMARY_CARD_DIRECTORIES.mistake, assetType: "mistake" },
  {
    relativePath: LEGACY_CARD_DIRECTORIES.definition,
    assetType: "definition"
  },
  {
    relativePath: LEGACY_CARD_DIRECTORIES.counterexample,
    assetType: "counterexample"
  },
  { relativePath: LEGACY_CARD_DIRECTORIES.proof, assetType: "proof" },
  { relativePath: DIAGNOSIS_DIRECTORY, assetType: "diagnosis" },
  { relativePath: REVIEW_DIRECTORY, assetType: "review" },
  { relativePath: LEGACY_REVIEW_DIRECTORY, assetType: "review" },
  { relativePath: CODEX_TASK_DIRECTORY, assetType: "codex-task" },
  { relativePath: ARCHIVE_DIRECTORY, assetType: null }
] as const satisfies readonly ScanDirectory[];
