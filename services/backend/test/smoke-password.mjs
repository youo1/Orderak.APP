// Local smoke test for the admin password change + break-glass reset routes.
// Run: node test/smoke-password.mjs   (requires `wrangler dev` on :8787)
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

// Ensure the owner exists (201 first run, 409 after).
await fetch(`${BASE}/api/admin/v1/auth/bootstrap`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-admin-key": KEY },
	body: JSON.stringify({ email: EMAIL, password: PASS, name: "Owner" }),
});

// Make sure we start from a known password via break-glass reset.
await fetch(`${BASE}/api/admin/v1/auth/password/reset`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-admin-key": KEY },
	body: JSON.stringify({ email: EMAIL, new_password: PASS }),
});

async function login(password) {
	const r = await fetch(`${BASE}/api/admin/v1/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: EMAIL, password }),
	});
	const cookie = r.headers.get("set-cookie")?.split(";", 1)[0] || "";
	return { status: r.status, cookie };
}

// --- change-password: happy path ---
const s1 = await login(PASS);
check("login with original password (200)", s1.status === 200, `got ${s1.status}`);

const NEWPW = "brand-new-pass-9";
const chg = await fetch(`${BASE}/api/admin/v1/auth/password`, {
	method: "POST",
	headers: { "content-type": "application/json", cookie: s1.cookie },
	body: JSON.stringify({ current_password: PASS, new_password: NEWPW }),
});
check("change password with correct current (200)", chg.status === 200, `got ${chg.status}`);

const afterOld = await login(PASS);
check("old password no longer works (401)", afterOld.status === 401, `got ${afterOld.status}`);
const afterNew = await login(NEWPW);
check("new password works (200)", afterNew.status === 200, `got ${afterNew.status}`);

// --- change-password: wrong current password is rejected without logging out (403, not 401) ---
const wrongCur = await fetch(`${BASE}/api/admin/v1/auth/password`, {
	method: "POST",
	headers: { "content-type": "application/json", cookie: afterNew.cookie },
	body: JSON.stringify({ current_password: "not-it", new_password: "whatever12" }),
});
check("wrong current password rejected (403)", wrongCur.status === 403, `got ${wrongCur.status}`);

// --- change-password: weak new password rejected (400) ---
const weak = await fetch(`${BASE}/api/admin/v1/auth/password`, {
	method: "POST",
	headers: { "content-type": "application/json", cookie: afterNew.cookie },
	body: JSON.stringify({ current_password: NEWPW, new_password: "short" }),
});
check("weak new password rejected (400)", weak.status === 400, `got ${weak.status}`);

// --- change-password: no session is unauthorized (401) ---
const noSess = await fetch(`${BASE}/api/admin/v1/auth/password`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ current_password: NEWPW, new_password: "whatever12" }),
});
check("change without session (401)", noSess.status === 401, `got ${noSess.status}`);

// --- break-glass reset: wrong key rejected (401) ---
const badKey = await fetch(`${BASE}/api/admin/v1/auth/password/reset`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-admin-key": "wrong" },
	body: JSON.stringify({ email: EMAIL, new_password: PASS }),
});
check("reset with wrong key (401)", badKey.status === 401, `got ${badKey.status}`);

// --- break-glass reset: unknown email (404) ---
const noUser = await fetch(`${BASE}/api/admin/v1/auth/password/reset`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-admin-key": KEY },
	body: JSON.stringify({ email: "nobody@orderak.app", new_password: PASS }),
});
check("reset unknown email (404)", noUser.status === 404, `got ${noUser.status}`);

// --- break-glass reset: happy path restores the original password ---
const reset = await fetch(`${BASE}/api/admin/v1/auth/password/reset`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-admin-key": KEY },
	body: JSON.stringify({ email: EMAIL, new_password: PASS }),
});
const resetBody = await j(reset);
check("break-glass reset (200)", reset.status === 200 && resetBody.ok === true, `got ${reset.status}`);
const afterReset = await login(PASS);
check("login after reset works (200)", afterReset.status === 200, `got ${afterReset.status}`);

console.log(`\n${fail === 0 ? "ALL PASSED" : "SOME FAILED"}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
