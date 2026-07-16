const NODES = [
  [20, 5],
  [34, 15],
  [29, 32],
  [11, 32],
  [6, 15]
] as const;

export function FlywheelBrandMark() {
  return (
    <svg
      aria-hidden="true"
      className="flywheel-brand-mark"
      focusable="false"
      viewBox="0 0 40 40"
    >
      <path
        d="M20 5.5C29 5.5 35.3 12.2 35.3 20.2c0 8.8-6.6 15.1-15.3 15.1S4.7 29 4.7 20.2c0-4.2 1.7-8 4.7-10.8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <path d="M7.2 6.9 10 9.5 6.3 10.3Z" fill="currentColor" />
      {NODES.map(([cx, cy], index) => (
        <circle
          className={`flywheel-brand-mark__node flywheel-brand-mark__node--${index + 1}`}
          cx={cx}
          cy={cy}
          key={`${cx}-${cy}`}
          r="2.7"
        />
      ))}
      <circle className="flywheel-brand-mark__core" cx="20" cy="20" r="4.2" />
    </svg>
  );
}
