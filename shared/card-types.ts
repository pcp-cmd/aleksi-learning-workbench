export const PRIMARY_CARD_TYPES = [
  "concept",
  "example",
  "boundary",
  "process",
  "mistake"
] as const;

export const LEGACY_CARD_TYPES = [
  "definition",
  "counterexample",
  "proof"
] as const;

export const CARD_TYPES = [
  ...PRIMARY_CARD_TYPES,
  ...LEGACY_CARD_TYPES
] as const;

export type PrimaryCardType = (typeof PRIMARY_CARD_TYPES)[number];
export type LegacyCardType = (typeof LEGACY_CARD_TYPES)[number];
export type CardType = (typeof CARD_TYPES)[number];

export function isPrimaryCardType(value: string): value is PrimaryCardType {
  return (PRIMARY_CARD_TYPES as readonly string[]).includes(value);
}

export function isLegacyCardType(value: string): value is LegacyCardType {
  return (LEGACY_CARD_TYPES as readonly string[]).includes(value);
}

export function isCardType(value: string): value is CardType {
  return (CARD_TYPES as readonly string[]).includes(value);
}
