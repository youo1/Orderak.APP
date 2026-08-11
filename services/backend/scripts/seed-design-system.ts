/**
 * One-time post-D1-migration bootstrap.
 *
 * The Worker creates revision 1 atomically from the current effective
 * theme_colors value when the active pointer is empty. Calling the public
 * endpoint after deploying migration 035 triggers that idempotent bootstrap
 * and verifies the compatibility projection.
 */
async function main() {
	const baseUrl = (process.argv[2] ?? "https://api.orderak.app").replace(/\/$/, "");
	const response = await fetch(`${baseUrl}/api/v1/theme`, {
		headers: { "cache-control": "no-cache" },
	});
	if (!response.ok) throw new Error(`Bootstrap failed: HTTP ${response.status}`);
	const body = await response.json() as Record<string, unknown>;
	if (body.schemaVersion !== 2 || !Number(body.revisionId) || typeof body.version !== "string") {
		throw new Error("Bootstrap returned an invalid schema-v2 revision");
	}
	const theme = body.theme as Record<string, unknown> | undefined;
	if (!theme || typeof theme.primary !== "string" || typeof theme.accent !== "string") {
		throw new Error("Legacy compatibility projection is missing");
	}
	console.log(`Design-system revision ${body.revisionId} is active (${body.version}).`);
}

void main();
