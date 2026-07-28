export type ProjectionStatus = "fresh" | "stale";

export type ProjectionOutcome = {
  projectionStatus: ProjectionStatus;
  projectionErrorId: string | null;
};

export type SaveOutcome<T> = T & ProjectionOutcome;
