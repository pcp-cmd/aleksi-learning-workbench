const MATCHED_OUTER_QUOTES = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"]
] as const;

export function normalizeUserSuppliedVaultPath(input: string): string {
  const trimmed = input.trim();

  for (const [open, close] of MATCHED_OUTER_QUOTES) {
    if (
      trimmed.startsWith(open) &&
      trimmed.endsWith(close) &&
      trimmed.length >= open.length + close.length
    ) {
      return trimmed.slice(open.length, trimmed.length - close.length);
    }
  }

  return trimmed;
}
