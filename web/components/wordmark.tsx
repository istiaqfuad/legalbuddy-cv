/** LegalBuddy wordmark: split-tone serif, ink first half, gold second.
 * Reads as one name, lands as a brand. Works on both themes.
 */
export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-bold tracking-tight ${className}`}>
      <span className="text-stone-100">Legal</span>
      <span className="text-gold">Buddy</span>
    </span>
  );
}
