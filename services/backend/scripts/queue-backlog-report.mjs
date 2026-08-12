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
//   Per queue, over the window: peak and mean backlog in messages, and peak
//   backlog in bytes. Peak is what a trigger fires on; mean is what tells you
//   whether the peak was a spike or a plateau.
//
// EXIT CODE
//   Non-zero only when --max-messages is given and a queue's peak exceeds it,
//   so the same script serves as a report while a baseline is being
//   established and as a gate once a number is chosen.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_ANALYTICS_TOKEN=... \
//     node scripts/queue-backlog-report.mjs [--hours 24] [--max-messages N]
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
const maxMessages = readFlag("--max-messages", null);

const until = new Date();
const since = new Date(until.getTime() - hours * 3600 * 1000);

// queuesBacklogAdaptiveGroups — plural "queues", and the dimension is queueID
// with a capital D. Both are easy to get wrong and the API answers a wrong
// field name with an error rather than an empty result, which is the good case.
const query = `
query Backlog($account: String!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      queuesBacklogAdaptiveGroups(
        limit: 100
        filter: { datetime_geq: $since, datetime_leq: $until }
      ) {
        dimensions { queueID }
        max { messages bytes }
        avg { messages }
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
	process.exit(1);
}

const groups = payload.data?.viewer?.accounts?.[0]?.queuesBacklogAdaptiveGroups ?? [];

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
	const peak = group.max?.messages ?? 0;
	const mean = group.avg?.messages ?? 0;
	const bytes = group.max?.bytes ?? 0;
	worst = Math.max(worst, peak);
	console.log(`  ${String(group.dimensions?.queueID ?? "unknown").padEnd(36)} peak=${String(peak).padStart(6)} msgs   mean=${String(mean).padStart(6)}   peak=${bytes} bytes`);
}

console.log(`\npeak backlog across all queues: ${worst} message(s)`);

if (maxMessages !== null && worst > maxMessages) {
	console.error(`FAIL: peak backlog ${worst} exceeds the configured bound of ${maxMessages}.`);
	process.exit(1);
}
