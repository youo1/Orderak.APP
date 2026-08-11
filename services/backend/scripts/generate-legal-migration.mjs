import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(backendDir, "..");
const outputName = process.argv[2] ?? "034_publish_legal_v3.sql";
if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(outputName)) {
  throw new Error("Output must be a migration filename such as 034_publish_legal_v3.sql");
}

const pages = [
  ["terms", "en", "terms-of-service.md"],
  ["terms", "ar", "terms-of-service.ar.md"],
  ["privacy", "en", "privacy-policy.md"],
  ["privacy", "ar", "privacy-policy.ar.md"],
];

const htmlEntities = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => htmlEntities[character]);

function inline(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const title = lines[0].replace(/^#\s+/, "").trim();
  const firstRule = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  const bodyLines = lines.slice(firstRule >= 0 ? firstRule + 1 : 1);
  const out = [];
  let paragraph = [];
  let list = null;

  const closeParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const raw of bodyLines) {
    const line = raw.trim();
    if (!line || line === "---") {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      closeParagraph(); closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      closeParagraph();
      const wanted = bullet ? "ul" : "ol";
      if (list !== wanted) { closeList(); out.push(`<${wanted}>`); list = wanted; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }
    if (line.startsWith(">")) continue;
    if (line.includes("|") && /^\|?\s*[-:]+/.test(line.replaceAll(" ", ""))) continue;
    paragraph.push(line.replace(/^\|/, "").replace(/\|$/, "").replaceAll("|", " — "));
  }
  closeParagraph(); closeList();
  return { title, html: out.join("\n") };
}

const sql = [
  "-- Generated from docs/legal by scripts/generate-legal-migration.mjs.",
  "-- Publishes the owner-directed bilingual auth/onboarding disclosure update as the next version.",
];

for (const [slug, lang, file] of pages) {
  const markdown = await readFile(join(repoDir, "docs", "legal", file), "utf8");
  const { title, html } = renderMarkdown(markdown);
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  sql.push(
    `UPDATE content_page_versions SET status='archived' WHERE slug=${quote(slug)} AND lang=${quote(lang)} AND status='published';`,
    `INSERT INTO content_page_versions(slug,lang,version,title,body_html,notes,status,published_at)`,
    `SELECT ${quote(slug)},${quote(lang)},COALESCE(MAX(version),0)+1,${quote(title)},${quote(html)},'Auth/onboarding and static city-catalogue disclosures updated at owner direction 2026-07-29; independent Egyptian legal review recommended','published',datetime('now')`,
    `FROM content_page_versions WHERE slug=${quote(slug)} AND lang=${quote(lang)};`,
  );
}

sql.push("");
const output = join(backendDir, "migrations", outputName);
await writeFile(output, sql.join("\n"), "utf8");
console.log(`Wrote ${output}`);
