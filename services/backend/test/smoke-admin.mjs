// Local smoke test for the admin auth + RBAC flow against `wrangler dev`.
// Run: node test/smoke-admin.mjs   (requires the dev server on :8787)
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const KEY = process.env.ADMIN_API_KEY || "local-dev-break-glass-key";
const EMAIL = "owner@orderak.app";
const PASS = "supersecret1";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
	if (cond) { pass++; console.log(`  ok   ${name}`); }
	else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}
const j = (r) => r.json().catch(() => ({}));

const boot = await fetch(`${BASE}/api/admin/v1/auth/bootstrap`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-admin-key": KEY },
	body: JSON.stringify({ email: EMAIL, password: PASS, name: "Owner" }),
});
// 201 first run, 409 if already bootstrapped — both are acceptable.
check("bootstrap owner (201 or 409)", boot.status === 201 || boot.status === 409, `got ${boot.status}`);

const badKey = await fetch(`${BASE}/api/admin/v1/auth/bootstrap`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-admin-key": "wrong" },
	body: JSON.stringify({ email: EMAIL, password: PASS }),
});
check("bootstrap rejects wrong key (401)", badKey.status === 401, `got ${badKey.status}`);

const login = await fetch(`${BASE}/api/admin/v1/auth/login`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const loginBody = await j(login);
const sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0] || "";
check("login ok with HttpOnly session cookie (200)", login.status === 200 && sessionCookie.includes("orderak_admin_session="), `got ${login.status}`);
check("login returns owner role", loginBody?.admin?.role === "owner");
check("login returns wildcard permission", Array.isArray(loginBody.permissions) && loginBody.permissions.includes("*"));

const badLogin = await fetch(`${BASE}/api/admin/v1/auth/login`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ email: EMAIL, password: "wrong-password" }),
});
check("login rejects bad password (401)", badLogin.status === 401, `got ${badLogin.status}`);

const me = await fetch(`${BASE}/api/admin/v1/auth/me`, { headers: { cookie: sessionCookie } });
const meBody = await j(me);
check("me with JWT (200)", me.status === 200 && meBody?.admin?.email === EMAIL, `got ${me.status}`);

const stats = await fetch(`${BASE}/api/admin/v1/stats`, { headers: { cookie: sessionCookie } });
check("stats with JWT (200)", stats.status === 200, `got ${stats.status}`);

const noAuth = await fetch(`${BASE}/api/admin/v1/stats`);
check("stats without auth is blocked (401/403)", noAuth.status === 401 || noAuth.status === 403, `got ${noAuth.status}`);

const forged = await fetch(`${BASE}/api/admin/v1/stats`, { headers: { cookie: "orderak_admin_session=forged" } });
check("stats rejects tampered session cookie (401)", forged.status === 401, `got ${forged.status}`);

const audit = await fetch(`${BASE}/api/admin/v1/audit`, { headers: { cookie: sessionCookie } });
check("audit log readable by owner (200)", audit.status === 200, `got ${audit.status}`);

console.log(`\n${fail === 0 ? "ALL PASSED" : "SOME FAILED"}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
