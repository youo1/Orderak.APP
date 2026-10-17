import { describe, expect, it } from "vitest";
import operationsSource from "../src/domains/admin/admin-operations.ts?raw";
import controlPlaneSource from "../src/domains/admin/admin-control-plane.ts?raw";
import emailRepositorySource from "../src/integrations/email/repository.ts?raw";

describe("non-query limit handling stays unchanged", () => {
	it("keeps the operations backfill request-body limit parsing", () => {
		expect(operationsSource).toContain("Math.min(500, Math.max(1, Number(body.limit) || 100))");
	});

	it("keeps verifyAuditArchives' own clamp and default", () => {
		expect(controlPlaneSource).toMatch(/export async function verifyAuditArchives\(env: AdminWorkerEnv, limit = 20\)/);
		expect(controlPlaneSource).toContain(".bind(Math.min(100, Math.max(1, limit)))");
	});

	it("keeps the email repository clamps", () => {
		const clamps = emailRepositorySource.match(/Math\.min\(500, Math\.max\(1, limit\)\)/g) ?? [];
		expect(clamps.length).toBe(2);
	});
});
