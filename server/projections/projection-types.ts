export type ProjectionStatus = "fresh" | "stale";

export type ProjectionOutcome = {
  projectionStatus: ProjectionStatus;
  projectionErrorId: string | null;
};

export type SaveOutcome<T> = T & ProjectionOutcome;

export type ProjectionHealth = Readonly<{
  schemaVersion: 1;
  projection: string;
  status: ProjectionStatus;
  attempts: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastSuccessfulRebuildAt: string | null;
  errorId: string | null;
  category: string | null;
  updatedAt: string;
}>;
