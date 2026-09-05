/**
 * Orderak — the implementation audit, as a pure function.
 *
 * WHY THIS IS SEPARATE FROM THE VERIFIER SCRIPT
 *   The verifier existed for a year and was never itself tested. It passed a
 *   feature whose screen had no edit control, and nothing caught that because
 *   nothing exercised the verifier's own judgement — there was no way to. Its
 *   logic read the repository at module scope and called process.exit, so the
 *   only observable was "did the whole repository pass".
 *
 *   A guard that cannot be tested is a guard nobody has checked. This file holds
 *   the decisions and takes the repository as an argument, so the decisions can
 *   be exercised against fixtures that make each failure happen on purpose.
 *
 * The caller supplies an `index` describing what the repository contains:
 *   has(kind, value)       does a symbol of this kind and name resolve
 *   test(layer, file)      the source of a test file, or undefined
 *   client                 the client network source, as one string
 *   gate(env, name)        true open, false closed, null undeclared
 */

/** Levels a feature's evidence can reach, weakest first. */
export const LEVELS = ["DECLARED", "EXISTS", "REACHABLE", "BEHAVIOUR-TESTED", "INTEGRATION-TESTED"];

export const LAYERS = ["android", "backend"];

/**
 * @returns {{ problems: string[], confirmed: string[], candidates: object[],
 *             levels: object, gateClosed: object[] }}
 */
export function auditImplementation({ catalog, evidence, baseline, kinds, kindsRequiringBehaviour, index }) {
  const problems = [];
  const candidates = [];
  const confirmed = [];
  const gateClosed = [];
  const levels = { exists: [], reachable: [], behaviour: [], integration: [] };

  const featureByKey = new Map(catalog.features.map((f) => [f.key, f]));

  for (const [key, e] of Object.entries(evidence)) {
    if (!kinds.includes(e.kind)) problems.push(`${key}: unknown evidence kind "${e.kind}"`);
    if (!featureByKey.has(key)) problems.push(`${key}: evidence for a key not in the catalogue`);
  }

  // The baseline is a debt register, so it is checked as one: every entry must
  // still be a live debt. An entry that has been paid, or whose feature is gone,
  // is stale and would quietly widen the exemption if left alone.
  for (const key of Object.keys(baseline)) {
    const feature = featureByKey.get(key);
    if (!feature) {
      problems.push(`${key}: behaviour baseline names a key that is not in the catalogue`);
    } else if (feature.implementation_status !== "implemented") {
      problems.push(`${key}: behaviour baseline names a feature that is no longer implemented — remove the entry`);
    } else if (evidence[key]?.behaviour) {
      problems.push(`${key}: has behaviour evidence and is still in the baseline — remove the entry, the debt is paid`);
    }
  }

  for (const f of catalog.features) {
    const e = evidence[f.key];
    if (f.implementation_status !== "implemented") {
      if (!e) continue;
      if (!index.has(e.kind, e.value)) problems.push(`${f.key}: promotion evidence ${e.kind} "${e.value}" does not resolve`);
      else candidates.push({ key: f.key, e });
      continue;
    }

    if (!e) { problems.push(`${f.key}: marked implemented but names no evidence`); continue; }
    if (!index.has(e.kind, e.value)) { problems.push(`${f.key}: evidence ${e.kind} "${e.value}" does not resolve`); continue; }
    confirmed.push(f.key);
    levels.exists.push(f.key);

    if (e.reachable) {
      const open = index.gate("production", e.reachable);
      if (open === null) problems.push(`${f.key}: reachable gate "${e.reachable}" is not declared in wrangler.jsonc`);
      else if (open) levels.reachable.push(f.key);
      else gateClosed.push({ key: f.key, gate: e.reachable, staging: index.gate("staging", e.reachable) });
    }

    if (e.behaviour) {
      const problem = behaviourProblem(f.key, e.behaviour, index);
      if (problem) problems.push(problem);
      else levels.behaviour.push(f.key);
    } else if (kindsRequiringBehaviour.includes(e.kind) && !(f.key in baseline)) {
      problems.push(
        `${f.key}: a ${e.kind} claim marked implemented must name a behaviour test. ` +
        `Add behaviour: { layer, file, test } naming a test that asserts what it does.`,
      );
    }

    if (e.integration) {
      if (index.client.includes(e.integration)) levels.integration.push(f.key);
      else problems.push(`${f.key}: integration symbol "${e.integration}" does not appear in the Android network layer`);
    }
  }

  return { problems, confirmed, candidates, levels, gateClosed };
}

function behaviourProblem(key, b, index) {
  if (!LAYERS.includes(b.layer)) return `${key}: behaviour layer "${b.layer}" is not one of ${LAYERS.join(", ")}`;
  const source = index.test(b.layer, b.file);
  if (source === undefined) return `${key}: behaviour test file "${b.file}" is not in the ${b.layer} test corpus`;
  if (!source.includes(b.test)) return `${key}: "${b.file}" does not contain a test named "${b.test}"`;
  return null;
}
