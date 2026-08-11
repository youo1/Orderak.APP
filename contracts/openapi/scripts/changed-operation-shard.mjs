import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [specPath, rawShard, rawTotal, baseRef = "origin/main", mode = "all"] = process.argv.slice(2);
const shard = Number(rawShard);
const total = Number(rawTotal);
if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 0 || total < 1 || shard >= total) {
  throw new Error("Shard and total must identify a valid zero-based shard.");
}
if (!new Set(["all", "fuzz-safe"]).has(mode)) {
  throw new Error(`Unknown selection mode: ${mode}`);
}
const current = JSON.parse(fs.readFileSync(specPath, "utf8"));
let base = { paths: {} };
try {
  base = JSON.parse(
    execFileSync("git", ["show", `${baseRef}:${specPath.replaceAll("\\", "/")}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
} catch {
  // First introduction of the contract: all operations are changed.
}
const changed = [];

/**
 * An operation whose only success is a redirect cannot be validated against a mock.
 *
 * Prism invents a value for a declared Location header, so schemathesis either follows
 * it to a hostname that never existed and dies on DNS, or - with --max-redirects 0 -
 * reports "Exceeded 0 redirects" and fails anyway. Neither outcome says anything about
 * the contract; both describe the mock.
 *
 * GET /api/theme.css is the only such operation today: it always answers 302 pointing
 * at the content-addressed stylesheet. Where that redirect points is get_theme_file's
 * contract, and that operation is validated normally. The 302 itself is exercised by
 * focused Worker tests; Schemathesis follows redirects, so including it in either the
 * Prism or live suite validates the final CSS response against the wrong operation.
 *
 * Detected by shape rather than by name, so a second redirect endpoint is handled the
 * day it is added instead of failing a shard first.
 */
const succeedsOnlyByRedirect = (operation) => {
  const codes = Object.keys(operation.responses ?? {});
  return codes.some((code) => /^3\d\d$/.test(code)) && !codes.some((code) => /^2\d\d$/.test(code));
};

const hasUnconstrainedBody = (operation) =>
  Object.values(operation.requestBody?.content ?? {}).some(({ schema }) =>
    schema?.type === "object"
    && schema.additionalProperties === true
    && !schema.properties
    && !schema.oneOf
    && !schema.anyOf
    && !schema.allOf,
  );
for (const [routePath, pathItem] of Object.entries(current.paths)) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = pathItem[method];
    if (!operation) continue;
    const previous = base.paths?.[routePath]?.[method];
    if (
      JSON.stringify(previous) !== JSON.stringify(operation)
      && !succeedsOnlyByRedirect(operation)
      && (mode === "all" || !hasUnconstrainedBody(operation))
    ) {
      changed.push(operation.operationId);
    }
  }
}
const selected = changed.sort().filter((_, index) => index % total === shard);
process.stdout.write(selected.length ? `^(${selected.join("|")})$` : "(?!)");
