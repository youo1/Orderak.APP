/**
 * Environment and database resolution, shared by the operator scripts.
 *
 * WHY THIS IS ONE FILE AND NOT THREE COPIES
 *   It was three copies, and they drifted in exactly the way copies do.
 *
 *   All three parsed `--env` with `args.indexOf("--env")`, which reads the NEXT
 *   argument as the value. That form is real, but `--env=staging` is the form
 *   used elsewhere in this repository — package.json and production-deploy.yml
 *   both write it — and indexOf sees no "--env" in it at all. So
 *   `--remote --env=staging --apply` silently resolved to no environment, which
 *   means production: the customer backfill would have written rows into the
 *   production table with no prompt and no mention of it in the output.
 *
 *   play-billing-preflight went further and passed the literal "orderak-db"
 *   regardless, while correctly forwarding --env to the secrets lookup. Its own
 *   usage line advertises `--remote --env staging`, so the documented invocation
 *   checked staging's secrets against production's plans, mappings and settings
 *   and printed "No blockers" — after which an operator would open billing in an
 *   environment nothing had actually verified.
 *
 * FAILING CLOSED ON PRODUCTION
 *   Omitting --env means production. That is a reasonable default for a read and
 *   a bad one for a write, so requireWriteTarget() makes the production case say
 *   so out loud and demand --allow-production. The check is on the resolved
 *   target rather than on the flag, so it cannot be satisfied by a typo that
 *   happened to resolve to production anyway.
 */

/** Environment names that are safe to hand to a shell and to wrangler. */
const SAFE_ENVIRONMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * The `--env` value, accepting both `--env staging` and `--env=staging`.
 * Returns null when the flag is absent, which means the top-level environment.
 */
export function parseEnvironment(args) {
  let value = null;

  const equalsForm = args.find((arg) => arg.startsWith("--env="));
  if (equalsForm) value = equalsForm.slice("--env=".length);

  const index = args.indexOf("--env");
  if (index >= 0) {
    const next = args[index + 1];
    // `--env` as the last argument, or followed by another flag, is a mistake
    // rather than a request for production — the previous code read undefined
    // here and carried on against production.
    if (!next || next.startsWith("-")) {
      throw new Error("--env was given with no value. Pass `--env staging` or `--env=staging`.");
    }
    value = next;
  }

  if (value === null) return null;
  if (!SAFE_ENVIRONMENT.test(value)) {
    throw new Error(`Refusing to pass ${JSON.stringify(value)} to a shell.`);
  }
  return value;
}

/**
 * The D1 database binding name for an environment.
 *
 * Kept beside the parser so the two cannot disagree: the whole failure above was
 * one script resolving the environment correctly and the database separately.
 */
export function databaseFor(environment) {
  return environment === "staging" ? "orderak-db-staging" : "orderak-db";
}

/** True when the resolved target is production, whatever route it got there by. */
export function isProduction(environment) {
  return environment === null || environment === "production";
}

/**
 * Refuse a write to production unless it was asked for in so many words.
 *
 * `apply` is the script's own write flag, so a dry run against production stays
 * as easy as it was.
 */
export function requireWriteTarget(args, environment, apply) {
  if (!apply || !isProduction(environment)) return;
  if (args.includes("--allow-production")) return;
  throw new Error(
    "Refusing to write to PRODUCTION without --allow-production.\n" +
    "  Omitting --env means production, which is easy to do by accident and impossible to undo.\n" +
    "  For staging:    --env staging --apply\n" +
    "  For production:  --apply --allow-production",
  );
}
