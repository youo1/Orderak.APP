import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];

// This walks the filesystem rather than git's index, so it also sees untracked and
// gitignored content. node_modules was already excluded for that reason; Python
// virtualenvs need the same treatment. Without .venv, a local `multi-agent/.venv`
// made this fail on broken links inside third-party package documentation - files
// that are gitignored, absent in CI, and not ours to fix. The check passed in CI and
// failed only on a developer machine, which is the least useful way for a check to fail.
const SKIP_DIRECTORIES = [
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "build",
  "dist",
  "site",
  "portal-build",
  "archive",
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRECTORIES.includes(entry.name)) return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

for (const file of walk(root).filter((candidate) => candidate.endsWith(".md"))) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (!target || target.startsWith("#") || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    target = decodeURIComponent(target.split("#")[0]);
    if (!target) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
      failures.push(`${path.relative(root, file)} -> ${target}`);
    }
  }
}

if (failures.length) {
  console.error("Broken local Markdown links:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Local Markdown file links resolve.");
