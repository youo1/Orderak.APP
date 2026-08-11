import { describe, expect, it } from "vitest";
import { ACTIVE_ADMIN_DOMAINS, ADMIN_SECTIONS } from "../../../contracts/typescript/admin";

describe("canonical React admin coverage registry", () => {
	it("declares every required control-plane domain with route and RBAC", () => {
		for (const domain of ["dashboard", "stores", "buyers", "privacy", "support", "deletions", "subscriptions", "plans", "coupons", "affiliate", "ads", "exports", "flags", "versions", "capabilities", "runtime", "announcements", "translations", "emails", "email-events", "inbox", "macros", "content", "jobs", "audit", "errors", "security", "admins", "settings", "theme", "roadmap", "tasks", "releases", "bugs", "manifests", "prompts", "docs", "design", "locales", "tags"]) {
			expect(ADMIN_SECTIONS.map((section) => section.key)).toContain(domain);
		}
		expect(ACTIVE_ADMIN_DOMAINS).toContain("audit_security");
		expect(new Set(ADMIN_SECTIONS.map((section) => section.path)).size).toBe(ADMIN_SECTIONS.length);
		expect(ADMIN_SECTIONS.every((section) => section.permission.includes(":"))).toBe(true);
	});
});
