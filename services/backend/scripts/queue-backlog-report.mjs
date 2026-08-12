#!/usr/bin/env node
// ============================================================
// Report Cloudflare Queue backlog from the GraphQL Analytics API.
//
// WHY THIS EXISTS
//   The rollback-trigger table in docs/guides/staging-production-workflow.md
//   carries a numeric bound for error rate and latency, and an admitted gap
//   for queue backlog: `wrangler queues info` reports producers and consumers
//   but not depth, so there was no measured number to set a trigger from. The
//   stand-in was "any message in a DLQ", which is a real signal but a much
//   later one — by the time a message dead-letters, the backlog that caused it
//   has already happened.
//
//   Depth lives only in the GraphQL Analytics API, which needs an
//   Account Analytics:Read token. This reads it.
//
// WHAT IT REPORTS
//   Per queue, over the window: average backlog in messages and in bytes.
//
//   The dataset exposes `avg` only — there is no `max`. An average over the
//   window hides a short spike, so any threshold derived from this detects a
//   sustained plateau rather than a burst. That limit belongs to the metric,
//   not to this script, and is stated here so a trigger built on it is never
//   mistaken for a peak alarm.
//
// EXIT CODE
//   Non-zero only when --max-avg-messages is given and a queue's average
//   exceeds it, so the same script serves as a report while a baseline is
//   being established and as a gate once a number is chosen.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_ANALYTICS_TOKEN=... \
//     node scripts/queue-backlog-report.mjs [--hours 24] [--max-avg-messages N]
// ============================================================

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN;

if (!account || !token) {
	console.error("FAIL: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_TOKEN are both required.");
	console.error("The token needs Account Analytics:Read — the deploy and backup tokens do not carry it.");
	process.exit(2);
}

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : Number(args[index + 1]);
};
const hours = readFlag("--hours", 24);
const maxAvgMessages = readFlag("--max-avg-messages", null);

const until = new Date();
const since = new Date(until.getTime() - hours * 3600 * 1000);

// queueBacklogAdaptiveGroups — SINGULAR "queue". Taken from Cloudflare's own
// documentation at developers.cloudflare.com/queues/observability/metrics/,
// after a third-party schema dump's plural "queuesBacklogAdaptiveGroups" was
// rejected with `unknown field`.
//
// The dataset exposes `avg` only — there is no `max`. That is a real limit on
// what this can measure: an average over the window hides a short spike
// entirely, so a threshold set from it is a plateau detector, not a spike
// detector. Recorded rather than worked around, because pretending to have a
// peak would be worse than not having one.
const query = `
query Backlog($account: String!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      queueBacklogAdaptiveGroups(
        limit: 1000
        filter: { datetime_geq: $since, datetime_leq: $until }
      ) {
        dimensions { queueId }
        avg { messages bytes }
      }
    }
  }
}`;

const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
	method: "POST",
	headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
	body: JSON.stringify({ query, variables: { account, since: since.toISOString(), until: until.toISOString() } }),
});

if (!response.ok) {
	console.error(`FAIL: GraphQL request returned HTTP ${response.status}.`);
	console.error(await response.text());
	process.exit(1);
}

const payload = await response.json();
if (payload.errors?.length) {
	console.error("FAIL: GraphQL reported errors.");
	for (const error of payload.errors) console.error(`  - ${error.message}`);

	// An unknown field means the dataset is named something else on this
	// account. Guessing again is how you burn another run, so ask the schema
	// what queue datasets actually exist and print them. Published field names
	// drift between Cloudflare's docs, third-party schema dumps, and what a
	// given account is entitled to; introspection is the only source that is
	// true here and now.
	if (payload.errors.some((error) => /unknown field/i.test(error.message ?? ""))) {
		const introspection = await fetch("https://api.cloudflare.com/client/v4/graphql", {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({
				query: `{ __type(name: "Account") { fields { name } } }`,
			}),
		});
		const schema = await introspection.json().catch(() => null);
		const fields = schema?.data?.__type?.fields?.map((field) => field.name) ?? [];
		const queueFields = fields.filter((name) => /queue/i.test(name));
		console.error("");
		console.error(queueFields.length
			? `Queue datasets this account actually exposes:\n${queueFields.map((name) => `  - ${name}`).join("\n")}`
			: `Schema introspection returned ${fields.length} account field(s) and none matched /queue/. The token may lack Account Analytics:Read, or this account has no Queues analytics entitlement.`);
	}
	process.exit(1);
}

const groups = payload.data?.viewer?.accounts?.[0]?.queueBacklogAdaptiveGroups ?? [];

console.log(`Queue backlog over the last ${hours}h (${since.toISOString()} .. ${until.toISOString()})`);
if (groups.length === 0) {
	// Not an error. A queue with no traffic in the window produces no rows at
	// all, which for a pre-launch environment is the expected reading — and is
	// itself the finding: there is no organic load to derive a threshold from.
	console.log("  no backlog samples in the window — no queue carried traffic");
	process.exit(0);
}

let worst = 0;
for (const group of groups) {
	const mean = group.avg?.messages ?? 0;
	const bytes = group.avg?.bytes ?? 0;
	worst = Math.max(worst, mean);
	console.log(`  ${String(group.dimensions?.queueId ?? "unknown").padEnd(36)} avg=${String(mean).padStart(8)} msgs   avg=${bytes} bytes`);
}

console.log(`\nhighest average backlog across all queues: ${worst} message(s)`);

if (maxAvgMessages !== null && worst > maxAvgMessages) {
	console.error(`FAIL: average backlog ${worst} exceeds the configured bound of ${maxAvgMessages}.`);
	process.exit(1);
}
