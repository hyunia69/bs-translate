import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.js";

export type GlossaryTerm = Partial<Record<"ko" | "en" | "ja" | "zh", string>>;

/** Reads <repo>/glossary.json once at startup. Missing or malformed file => empty list. */
export function loadGlossary(file = path.join(REPO_ROOT, "glossary.json")): GlossaryTerm[] {
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as { terms?: unknown };
    return Array.isArray(json.terms) ? (json.terms as GlossaryTerm[]) : [];
  } catch {
    return [];
  }
}
