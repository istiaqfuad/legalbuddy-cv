export default function ThinkingDots() {
  return (
    <span aria-hidden className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block size-1.5 rounded-full bg-stone-400 motion-safe:animate-[blink-dot_1.2s_infinite]"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}
