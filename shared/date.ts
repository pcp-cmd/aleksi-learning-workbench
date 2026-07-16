export type ReviewFeedback = "forgot" | "fuzzy" | "known" | "fluent";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export const REVIEW_INTERVAL_DAYS: Record<ReviewFeedback, 1 | 3 | 7 | 14> = {
  forgot: 1,
  fuzzy: 3,
  known: 7,
  fluent: 14
};

function parseDateOnly(value: string): {
  year: number;
  monthIndex: number;
  day: number;
} {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (match === null) {
    throw new Error("Expected a YYYY-MM-DD date");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Expected a valid YYYY-MM-DD date");
  }

  return {
    year,
    monthIndex: month - 1,
    day
  };
}

export function addDays(dateOnly: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new Error("Days must be an integer");
  }

  const parsed = parseDateOnly(dateOnly);
  const date = new Date(
    Date.UTC(parsed.year, parsed.monthIndex, parsed.day + days)
  );

  return date.toISOString().slice(0, 10);
}

export function nextReviewDate(
  reviewedDate: string,
  feedback: ReviewFeedback
): string {
  return addDays(reviewedDate, REVIEW_INTERVAL_DAYS[feedback]);
}

export function utcDateOnly(isoUtcMilliseconds: string): string {
  return new Date(isoUtcMilliseconds).toISOString().slice(0, 10);
}
