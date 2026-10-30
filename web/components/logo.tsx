/** LegalBuddy mark: scales of justice over an open book, flat gold lines.
 * Renders inline so it stays crisp at any size and inherits context.
 * Wrap in a dark rounded badge via `badge` for light backgrounds.
 */
export default function Logo({
  size = 32,
  badge = false,
  label = "LegalBuddy logo",
}: {
  size?: number;
  badge?: boolean;
  label?: string;
}) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="#C9A227"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <circle cx="32" cy="8" r="2.4" fill="#C9A227" stroke="none" />
      <path d="M32 11 V44" />
      <path d="M14 18 H50" />
      <circle cx="14" cy="18" r="1.8" fill="#C9A227" stroke="none" />
      <circle cx="32" cy="18" r="1.8" fill="#C9A227" stroke="none" />
      <circle cx="50" cy="18" r="1.8" fill="#C9A227" stroke="none" />
      <path d="M14 18 L9.5 31 M14 18 L18.5 31" />
      <path d="M8 31 Q14 37.5 20 31" />
      <path d="M50 18 L45.5 31 M50 18 L54.5 31" />
      <path d="M44 31 Q50 37.5 56 31" />
      <path d="M21 46 Q26.5 43 32 46 Q37.5 43 43 46 V52 Q37.5 49 32 52 Q26.5 49 21 52 Z" />
      <path d="M32 46 V52" />
    </svg>
  );
  if (!badge) return mark;
  return (
    <span
      className="inline-flex items-center justify-center rounded-xl bg-stone-950"
      style={{ width: size, height: size }}
    >
      <span style={{ transform: "scale(0.82)" }}>{mark}</span>
    </span>
  );
}
