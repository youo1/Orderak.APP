import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, createSchema, env } from "./helpers";

/**
 * The plan comparison a seller is shown.
 *
 * The rule worth a test is BR-506: the table may not list a feature the app has
 * not built. The catalogue sold "editable customer profiles" at paid1 for months
 * while CustomerDetailsScreen had no edit control — a comparison built from
 * anything other than `implementation_status` would have advertised it, and a
 * seller would have paid for a screen that could not save.
 */

beforeEach(createSchema);

async function seedCatalogue(): Promise<void> {
	await env.orderak_db.batch([
		env.orderak_db.prepare(
			`INSERT INTO subscription_plans(id,plan_key,name,description,sort_order,active,current_revision_id)
			 VALUES('sp-free','free','Free','Starter',1,1,'rev-free'),
			       ('sp-paid1','paid1','Growth','First paid tier',2,1,'rev-paid1')`,
		),
		env.orderak_db.prepare(
			`INSERT INTO plan_revisions(id,plan_id,version,status)
			 VALUES('rev-free','sp-free',1,'published'),
			       ('rev-paid1','sp-paid1',1,'published'),
			       ('rev-draft','sp-paid1',2,'draft')`,
		),
		env.orderak_db.prepare(
			`INSERT INTO entitlement_definitions
			   (entitlement_key,category,name,value_type,implementation_status,sort_order,active)
			 VALUES('demo.built','Demo','A feature that exists','boolean','implemented',1,1),
			       ('demo.planned','Demo','A feature that does not','boolean','planned',2,1),
			       ('demo.partial','Demo','A half-built feature','boolean','partial',3,1)`,
		),
		env.orderak_db.prepare(
			`INSERT INTO plan_revision_entitlements(revision_id,entitlement_key,value_mode,display_value)
			 VALUES('rev-free','demo.built','disabled','—'),
			       ('rev-paid1','demo.built','value','Included'),
			       ('rev-free','demo.planned','disabled','—'),
			       ('rev-paid1','demo.planned','value','Included'),
			       ('rev-paid1','demo.partial','value','Included'),
			       ('rev-draft','demo.built','value','Something else entirely')`,
		),
	]);
}

type ComparisonResponse = {
	ok: boolean;
	plans: { plan_key: string; name: string }[];
	comparison: { entitlement_key: string; name: string; values: Record<string, string> }[];
};

async function fetchPlans(): Promise<ComparisonResponse> {
	// Public, as it has always been: this is the same comparison the pricing
	// page shows and it carries nothing store-specific.
	const res = await SELF.fetch(`${BASE}/api/v1/plans`);
	expect(res.status).toBe(200);
	return (await res.json()) as ComparisonResponse;
}

describe("plan comparison", () => {
	it("never lists a feature the app has not built", async () => {
		await seedCatalogue();
		const body = await fetchPlans();

		const keys = body.comparison.map((row) => row.entitlement_key);
		expect(keys).toContain("demo.built");

		// The whole point. `planned` is a feature that does not exist, and
		// `partial` is one that half does — neither may be sold, and "partial"
		// is the more dangerous of the two because it demos convincingly.
		expect(keys).not.toContain("demo.planned");
		expect(keys).not.toContain("demo.partial");
	});

	it("reads the published revision, not a draft", async () => {
		await seedCatalogue();
		const body = await fetchPlans();

		const row = body.comparison.find((r) => r.entitlement_key === "demo.built");
		expect(row?.values.paid1).toBe("Included");
		// A draft is an editor's work in progress. Showing it would let an
		// unpublished edit reach sellers before anyone published it.
		expect(row?.values.paid1).not.toBe("Something else entirely");
	});

	it("carries a value for every active plan", async () => {
		await seedCatalogue();
		const body = await fetchPlans();

		expect(body.plans.map((p) => p.plan_key)).toEqual(["free", "paid1"]);
		const row = body.comparison.find((r) => r.entitlement_key === "demo.built");
		expect(row?.values.free).toBe("—");
		expect(row?.values.paid1).toBe("Included");
	});

	it("returns an empty comparison rather than failing when nothing is seeded", async () => {
		// Both environments run the entitlement engine off, and the catalogue
		// tables may be empty. A plans screen that renders nothing is a far better
		// failure than one that takes the account surface down with it.
		const body = await fetchPlans();
		expect(body.ok).toBe(true);
		expect(body.plans).toEqual([]);
		expect(body.comparison).toEqual([]);
	});

	it("stays cacheable at the edge", async () => {
		// A comparison that changes on the scale of months. The cache header was
		// on the endpoint this replaced and is worth keeping.
		await seedCatalogue();
		const res = await SELF.fetch(`${BASE}/api/v1/plans`);
		expect(res.headers.get("cache-control")).toContain("max-age=300");
	});
});
