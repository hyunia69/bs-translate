import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function appendJsonl(dataDir: string, file: string, entries: object[]): Promise<void> {
  if (entries.length === 0) return;
  await mkdir(dataDir, { recursive: true });
  await appendFile(path.join(dataDir, file), entries.map((e) => JSON.stringify(e) + "\n").join(""), "utf8");
}

export async function readJsonl(dataDir: string, file: string): Promise<Record<string, unknown>[]> {
  let text: string;
  try {
    text = await readFile(path.join(dataDir, file), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* skip corrupt line */
    }
  }
  return rows;
}

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = ["savedAt", "speaker", "source", "target", "sourceText", "targetText", "engine"] as const;

export function toCsv(rows: Record<string, unknown>[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
