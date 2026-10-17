import raw from "../../glossary.json";

export type GlossaryTerm = Partial<Record<"ko" | "en" | "ja" | "zh", string>>;

const LANG_KEYS = ["ko", "en", "ja", "zh"] as const;

function toTerm(v: unknown): GlossaryTerm | null {
  if (!v || typeof v !== "object") return null;
  const src = v as Record<string, unknown>;
  const term: GlossaryTerm = {};
  for (const k of LANG_KEYS) {
    const value = src[k];
    if (typeof value === "string") term[k] = value;
  }
  return term;
}

export const glossary: readonly GlossaryTerm[] = (() => {
  const terms: unknown = (raw as { terms?: unknown }).terms;
  if (!Array.isArray(terms)) return [];
  return terms.map(toTerm).filter((t): t is GlossaryTerm => t !== null);
})();
