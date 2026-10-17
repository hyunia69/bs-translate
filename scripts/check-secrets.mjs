import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "web", "dist");

if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  console.error(`check-secrets: ${dist} does not exist (build the web app first)`);
  process.exit(2);
}

function readEnvKeys() {
  const keys = [];
  for (const name of [".dev.vars", ".env.local"]) {
    const envPath = path.join(root, name);
    if (!existsSync(envPath)) continue;
    for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:OPENAI_API_KEY|chatgptkey)\s*=\s*(.*)$/.exec(raw);
      if (!m) continue;
      const value = m[1].trim().replace(/^(['"])(.*)\1$/, "$2").trim();
      if (value) keys.push(value);
    }
  }
  return keys;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const keys = readEnvKeys();
const keyPattern = /sk-[A-Za-z0-9_-]{20,}/;
const offenders = [];
let scanned = 0;

for (const file of walk(dist)) {
  scanned++;
  const text = readFileSync(file).toString("latin1");
  const reasons = [];
  if (keys.some((k) => text.includes(k))) reasons.push("contains the API key value from .dev.vars/.env.local");
  if (keyPattern.test(text)) reasons.push("matches sk-... key pattern");
  if (text.includes("OPENAI_API_KEY")) reasons.push('contains "OPENAI_API_KEY"');
  if (reasons.length) offenders.push(`${file}: ${reasons.join("; ")}`);
}

if (offenders.length) {
  console.error("check-secrets: FAIL");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`check-secrets: OK (${scanned} files scanned)`);
