import { describe, expect, it } from "vitest";
import { hasPermission, type AdminRole } from "../src/domains/identity/auth";

/**
 * Every route gate must be reachable by somebody it was meant for.
 *
 * A permission string in a route gate looks like a control. It is only a control
 * if some role actually holds it — otherwise it is vocabulary, and the route it
 * guards is quietly narrower than whoever wrote it believed.
 *
 * `owner` holds "*", so asking "does any role hold this?" is always yes and
 * proves nothing. The question worth asking is whether any role *other than*
 * owner holds it, because that is the one whose answer can change by accident:
 * adding a gate is one line in a route file, and granting it is a different line
 * in a different file that nothing forces you to visit.
 *
 * So an owner-only gate has to be listed here, with a reason. That is not a
 * rubber stamp — it is the difference between "only the owner may do this" as a
 * decision and as an oversight. plans:manage is the case that prompted this:
 * the legacy plan routes are gated on it while the v2 entitlement surface next
 * door uses plans:draft and plans:publish, which finance holds. Whether finance
 * should be able to manage legacy plans too is a product question; that it
 * currently cannot is now at least a visible one.
 */

// Read as text at build time rather than through node:fs: the Workers test pool
// resolves __dirname to a path its filesystem shim cannot open.
const ADMIN_SOURCES = import.meta.glob("../src/domains/admin/*.ts", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

const NON_OWNER_ROLES: AdminRole[] = ["finance", "support", "readonly"];

/**
 * Gates only the owner may pass, each with the reason it is not an oversight.
 *
 * Adding to this list is a deliberate act. If a gate appears here because the
 * test failed and the list was the quickest way to green, that is the failure
 * mode this whole file exists to prevent.
 */
const OWNER_ONLY: Record<string, string> = {
	// --- The privilege graph itself ---------------------------------------
	"admins:view": "Who else holds administrative power is owner business.",
	"admins:manage": "Creating and removing administrators is the root of the privilege graph.",
	"security:view": "Security posture and step-up authorisations.",
	"security:manage": "Security posture and step-up authorisations.",

	// --- Runtime controls --------------------------------------------------
	// settings:manage includes the billing kill switch and the feature-flag
	// controls, so it gates things whose blast radius is every seller at once.
	// settings:view is owner-only alongside it; operations:view is the read
	// surface the other roles actually have.
	"settings:view": "Runtime controls, including the billing kill switch.",
	"settings:manage": "Runtime controls, including the billing kill switch.",
	"flags:manage": "Feature flags change behaviour for every seller at once.",
	"versions:manage": "Client version gates, including force_update and blocked.",
	"capabilities:manage": "Per-environment capability declarations.",

	// --- Published to sellers and buyers ------------------------------------
	"content:manage": "Legal and content pages — published text with legal weight.",
	"ads:manage": "What is shown inside sellers' apps.",

	// --- The internal project console ---------------------------------------
	// These surfaces describe the product to the people building it. They are
	// owner-only as a group; if that changes it should change as a group.
	"roadmap:manage": "Internal project console.",
	"tasks:manage": "Internal project console.",
	"screens:manage": "Internal project console.",
	"endpoints:manage": "Internal project console.",
	"prompts:manage": "Internal project console.",
	"design:manage": "Internal project console.",
	"releases:manage": "Internal project console.",
	"bugs:manage": "Internal project console.",
	"docs:manage": "Internal project console.",

	// --- Plans: two surfaces, three verbs, worth a decision ------------------
	// finance holds plans:view and plans:draft. It does not hold plans:publish,
	// which reads as a deliberate separation — drafting a price change and
	// making it live are different acts. plans:manage is the legacy surface's
	// single verb covering both, so finance cannot touch legacy plans at all.
	//
	// Neither is asserted here to be right. Both are recorded so that the next
	// person to look at plan permissions sees three verbs across two surfaces
	// rather than discovering it from a 403.
	"plans:publish": "Publishing a plan revision makes a price live; finance drafts, owner publishes.",
	"plans:manage":
		"Legacy plan create/disable, one verb covering both draft and publish. Whether finance " +
		"should hold it — as it holds plans:draft on the v2 surface — is an open product question.",
};

function gateStringsInSource(): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const [file, source] of Object.entries(ADMIN_SOURCES)) {
		for (const match of source.matchAll(/get\("gate"\)\("([a-z]+:[a-z_*]+)"\)/g)) {
			const permission = match[1];
			found.set(permission, [...(found.get(permission) ?? []), file]);
		}
	}
	return found;
}

describe("admin route gates", () => {
	const gates = gateStringsInSource();

	it("finds the gates at all", () => {
		// If the route registration style changes, the regex above stops matching
		// and every assertion below passes vacuously. This is the tripwire.
		expect(gates.size).toBeGreaterThan(40);
	});

	it("has no gate that only the owner can pass by accident", () => {
		const ownerOnly: string[] = [];
		for (const permission of gates.keys()) {
			const reachable = NON_OWNER_ROLES.some((role) => hasPermission(role, permission));
			if (!reachable && !(permission in OWNER_ONLY)) ownerOnly.push(permission);
		}
		expect(
			ownerOnly,
			`No role but owner can pass ${ownerOnly.join(", ")}. Either grant it to the role that ` +
			"needs it, or add it to OWNER_ONLY in this file with the reason it is owner business.",
		).toEqual([]);
	});

	it("keeps the owner-only list honest", () => {
		// A permission that stops being owner-only, or stops being used, should not
		// leave a stale justification behind claiming a restriction that is gone.
		const stale = Object.keys(OWNER_ONLY).filter((permission) => {
			if (!gates.has(permission)) return true;
			return NON_OWNER_ROLES.some((role) => hasPermission(role, permission));
		});
		expect(stale, `OWNER_ONLY entries no longer owner-only or no longer used: ${stale.join(", ")}`).toEqual([]);
	});

	it("owner can pass every gate", () => {
		for (const permission of gates.keys()) {
			expect(hasPermission("owner", permission), `owner cannot pass ${permission}`).toBe(true);
		}
	});
});
