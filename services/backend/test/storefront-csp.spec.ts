// The storefront's script-src is a hash policy, not 'unsafe-inline'.
//
// These pages render seller-authored product text to buyers and collect a
// buyer's phone number and delivery address, so the CSP is the layer that
// contains an escaping mistake rather than relying on having found them all.
// A hash policy only holds if two things stay true, and both are easy to break
// by accident in ordinary markup edits:
//
//   * every inline script on the page is hashed, and the hash matches the bytes
//     that actually shipped;
//   * nothing on the page uses an inline event handler, which no hash covers.
//
// The second is what these tests really guard. Re-adding an `onclick` to a
// quantity button would not fail any other test in this suite: the page would
// render, the form would still take a phone number, and the button would
// silently do nothing in a real browser.
import { describe, it, expect, beforeEach } from "vitest";
import { SELF, createSchema, registerStore, authHeaders, type Registered } from "./helpers";

const SITE = "https://orderak.app";

async function seedProduct(r: Registered, appId = 1, name = "Cola"): Promise<string> {
	const res = await SELF.fetch("https://api.orderak.app/api/v1/products/sync", {
		method: "POST",
		headers: authHeaders(r),
		body: JSON.stringify({ products: [{ app_id: appId, name, price: { amount_minor: 1500, currency: "EGP" }, stock: 10, available: true }] }),
	});
	const body = (await res.json()) as { products: { product_code: string }[] };
	return body.products[0].product_code;
}

/** Every inline script element's exact content, in document order. */
function inlineScripts(html: string): string[] {
	return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
		.map((match) => match[1])
		.filter((content) => content.length > 0);
}

async function sha256Base64(content: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
	return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function directive(csp: string, name: string): string {
	return csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";
}

beforeEach(async () => {
	await createSchema();
});

describe("storefront content security policy", () => {
	it("names a hash for every inline script it serves, and no 'unsafe-inline'", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		await seedProduct(r);

		const res = await SELF.fetch(`${SITE}/${r.public_identifier}`);
		expect(res.status).toBe(200);
		const csp = res.headers.get("content-security-policy") ?? "";
		const html = await res.text();

		const scriptSrc = directive(csp, "script-src");
		expect(scriptSrc).not.toContain("'unsafe-inline'");
		// 'unsafe-hashes' would re-admit inline event handlers, which is the
		// exact thing this policy exists to exclude.
		expect(scriptSrc).not.toContain("'unsafe-hashes'");

		const scripts = inlineScripts(html);
		// The store root carries one: the order form's script. The JSON-LD data
		// block is emitted only by the product page, covered below.
		expect(scripts.length).toBe(1);
		for (const content of scripts) {
			expect(scriptSrc).toContain(`'sha256-${await sha256Base64(content)}'`);
		}
	});

	it("uses no inline event handlers, which a hash policy cannot cover", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		await seedProduct(r);
		const html = await (await SELF.fetch(`${SITE}/${r.public_identifier}`)).text();

		// Matches on* only where it is an attribute (preceded by whitespace and
		// followed by `=`), so `data-code` and prose containing "on" do not trip it.
		expect(html).not.toMatch(/\son(?:click|submit|change|input|load|error|focus|blur|mouse\w+|key\w+)\s*=/i);
		// The behaviour those handlers carried has to still be wired up.
		expect(html).toContain("data-qty-delta");
		expect(html).toContain("addEventListener('submit',send)");
	});

	it("keeps the rest of the policy, which is what limits a script that does run", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		await seedProduct(r);
		const csp = (await SELF.fetch(`${SITE}/${r.public_identifier}`)).headers.get("content-security-policy") ?? "";

		expect(csp).toContain("default-src 'none'");
		// The directive that means injected script cannot post a buyer's phone
		// number or the seller's catalogue anywhere else.
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
	});

	it("hashes the product page's JSON-LD block as well as its order script", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const code = await seedProduct(r);

		const res = await SELF.fetch(`${SITE}/${r.public_identifier}/p/${code}`);
		expect(res.status).toBe(200);
		const scriptSrc = directive(res.headers.get("content-security-policy") ?? "", "script-src");
		expect(scriptSrc).not.toContain("'unsafe-inline'");
		const html = await res.text();

		// The order form's script plus the structured-data block. The data block
		// never executes, but browsers apply script-src to script elements
		// regardless of type — an unhashed one is dropped and the page looks
		// completely normal with its SEO markup silently gone.
		expect(html).toContain('<script type="application/ld+json">');
		const scripts = inlineScripts(html);
		expect(scripts.length).toBe(2);
		for (const content of scripts) {
			expect(scriptSrc).toContain(`'sha256-${await sha256Base64(content)}'`);
		}
	});
});
