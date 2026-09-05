/**
 * Writes the two generated UX documents from their generators.
 *
 *   node tooling/ux/generate-ux-docs.mjs
 *
 * Both documents carry `generated: true` and say in their own body text that
 * they come from `verify-<name>.mjs --md`. That was true of the markdown but
 * nothing ever wrote it to disk, so the claim rested on whoever last
 * remembered to paste the output in. This script closes that gap, and
 * .github/workflows/docs-ci.yml runs it and fails on any diff, the same way it
 * already guards docs/guides/database-migrations.md.
 *
 * The renderers are left in the verifiers rather than moved here: each one
 * validates before it prints, so a map that no longer matches the catalogue
 * exits non-zero and no document is written. Regenerating cannot launder a
 * broken source past its own validator.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "..", "..");

const DOCUMENTS = [
  {
    generator: "tooling/ux/verify-feature-surface-map.mjs",
    output: "docs/ux/feature-surface-map.md",
  },
  {
    generator: "tooling/ux/verify-screen-contracts.mjs",
    output: "docs/ux/screen-contracts.md",
  },
];

let failed = false;

for (const { generator, output } of DOCUMENTS) {
  const result = spawnSync(
    process.execPath,
    [resolve(workspace, generator), "--md"],
    { cwd: workspace, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.error) {
    console.error(`FAIL — could not run ${generator}: ${result.error.message}`);
    failed = true;
    continue;
  }

  if (result.status !== 0) {
    // The verifier prints its own diagnosis to stderr. Pass it through and
    // leave the document untouched: a stale document is easier to explain
    // than one regenerated from a source that fails its own checks.
    process.stderr.write(result.stderr);
    console.error(`FAIL — ${generator} exited ${result.status}; ${output} left unchanged.`);
    failed = true;
    continue;
  }

  // console.log in the verifier already ends the payload with one newline.
  // Normalise anyway so a CRLF pipe on Windows cannot produce a document that
  // differs from the committed one on every byte of every line.
  const markdown = `${result.stdout.replaceAll("\r\n", "\n").trimEnd()}\n`;
  const outputPath = resolve(workspace, output);
  writeFileSync(outputPath, markdown, "utf8");
  console.log(`Wrote ${output} (${markdown.split("\n").length - 1} lines) from ${generator} --md.`);
}

if (failed) process.exit(1);
