/**
 * The plan comparison a seller is shown.
 *
 * WHY THE SERVER BUILDS THIS AND NOT THE APP
 *   The rule that matters is BR-506: the comparison may not list a feature the
 *   app has not built. `entitlement_definitions.implementation_status` is where
 *   that fact lives, and it is corrected forward by migration rather than
 *   shipped in a build — migration 047 exists precisely because seven rows drifted.
 *   An app-side table would be a second copy of the catalogue, going stale on a
 *   schedule set by app releases, and the first thing it would go stale about is
 *   which features exist.
 *
 * WHY IT READS THE PUBLISHED REVISION AND NOT THE PLANS TABLE
 *   `plans` is the legacy billing table: four columns of limits and a
 *   multi-device boolean. `plan_revisions` + `plan_revision_entitlements` is the
 *   catalogue's own model, carries a display value per plan per entitlement, and
 *   is what the admin console edits. Reading anything else would show sellers a
 *   comparison nobody maintains.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   No prices. Play owns the price a seller sees, in their own currency, and a
 *   number from here would be a second answer that disagrees the moment Google
 *   changes a regional price or applies a promotion. The screen shows what each
 *   plan includes; Play shows what it costs.
 */

type Row = Record<string, unknown>;

export interface PlanComparisonRow {
	entitlement_key: string;
	category: string;
	name: string;
	value_type: string;
	/** Plan key to the display value that plan carries for this entitlement. */
	values: Record<string, string>;
}

export interface PlanSummary {
	plan_key: string;
	name: string;
	description: string | null;
	sort_order: number;
}

/**
 * Build the comparison from the published revision of every active plan.
 *
 * Returns an empty comparison rather than throwing when the catalogue tables
 * are unseeded: both environments run with the entitlement engine off today, and
 * a plans screen that renders nothing is a much better failure than one that
 * takes the account surface down with it.
 */
export async function planComparison(env: Env): Promise<{ plans: PlanSummary[]; rows: PlanComparisonRow[] }> {
	let plans: Row[] = [];
	let values: Row[] = [];
	try {
		const planResult = await env.orderak_db.prepare(
			`SELECT p.plan_key, p.name, p.description, p.sort_order
			   FROM subscription_plans p
			  WHERE p.active = 1
			  ORDER BY p.sort_order`,
		).all<Row>();
		plans = planResult.results ?? [];

		// Only `implemented` entitlements, and only from each plan's currently
		// published revision. A draft revision is an editor's work in progress and
		// a retired one is what a seller used to have; neither is an offer.
		const valueResult = await env.orderak_db.prepare(
			`SELECT p.plan_key, d.entitlement_key, d.category, d.name, d.value_type,
			        d.sort_order, e.display_value
			   FROM subscription_plans p
			   JOIN plan_revisions r ON r.id = p.current_revision_id AND r.status = 'published'
			   JOIN plan_revision_entitlements e ON e.revision_id = r.id
			   JOIN entitlement_definitions d ON d.entitlement_key = e.entitlement_key
			  WHERE p.active = 1
			    AND d.active = 1
			    AND d.implementation_status = 'implemented'
			  ORDER BY d.sort_order, p.sort_order`,
		).all<Row>();
		values = valueResult.results ?? [];
	} catch {
		return { plans: [], rows: [] };
	}

	const byKey = new Map<string, PlanComparisonRow>();
	for (const row of values) {
		const key = String(row.entitlement_key);
		let entry = byKey.get(key);
		if (!entry) {
			entry = {
				entitlement_key: key,
				category: String(row.category),
				name: String(row.name),
				value_type: String(row.value_type),
				values: {},
			};
			byKey.set(key, entry);
		}
		entry.values[String(row.plan_key)] = String(row.display_value);
	}

	return {
		plans: plans.map((p) => ({
			plan_key: String(p.plan_key),
			name: String(p.name),
			description: p.description == null ? null : String(p.description),
			sort_order: Number(p.sort_order ?? 0),
		})),
		rows: [...byKey.values()],
	};
}
