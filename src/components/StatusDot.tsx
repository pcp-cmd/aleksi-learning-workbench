export type StatusDotTone = "idle" | "active" | "due" | "blocked";

export interface StatusDotProps {
  label: string;
  tone?: StatusDotTone;
}

export function StatusDot({ label, tone = "idle" }: StatusDotProps) {
  return (
    <span className="status-dot-line">
      <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
