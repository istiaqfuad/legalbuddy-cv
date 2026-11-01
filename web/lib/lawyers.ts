/** Shared lawyer-directory constants (mirror matcher.PRACTICE_AREAS). */
export const PRACTICE_AREAS = [
  "criminal",
  "family",
  "property",
  "corporate",
  "labor",
  "tax",
  "consumer",
  "immigration",
] as const;

export const LANGUAGES = ["english", "bangla"] as const;

/** Text embedded for cosine matching: bio plus structured facts. */
export function profileText(input: {
  bio?: string | null;
  practice_areas?: string[] | null;
  languages?: string[] | null;
  city?: string | null;
}): string {
  return [
    input.bio ?? "",
    `Practices: ${(input.practice_areas ?? []).join(", ")}`,
    `Languages: ${(input.languages ?? []).join(", ")}`,
    input.city ? `Based in ${input.city}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}
