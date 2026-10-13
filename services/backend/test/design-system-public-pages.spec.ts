import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { callWorker, createSchema } from "./helpers";
import { contrastRatio, invalidateDesignSystemCache, loadActiveDesignSystem } from "../src/domains/design/design-system";
import { renderCategoryPage, renderProductPage, renderStorePage } from "../src/domains/catalog/catalog";
import { handlePublicRoutes } from "../src/entrypoints/public-router";
import publicWorker from "../src/entrypoints/public-worker";

/**
 * Plan item B8 (part 2): the landing page, the storefront pages and the
 * content pages read colours directly from the generated snapshot's standard
 * light roles (primary, onPrimaryContainer, primaryContainer, background,
 * surface, onSurface, onSurfaceVariant, error), not from revision.legacyTheme.
 *
 * Every pinned value below equals today's literal output except the landing
 * page's --g2, which intentionally moves from legacyTheme.primary_strong
 * ("#002929", the hand-picked LEGACY_DEFAULT_THEME constant still rendered
 * today) to the snapshot's onPrimaryContainer ("#054F50"). Reading
 * primary_strong from primaryContainer instead (legacyProjection's own
 * mapping) would instead yield "#B0EEEE", which is why that mapping is
 * rejected for this role: white .btn:hover text on a surface that light
 * reads below WCAG AA. onPrimaryContainer is the corrected source and is
 * asserted to clear 4.5:1 for white text below.
 *
 * This test does not assert revision.legacyTheme against legacyProjection():
 * that premise does not hold once these pages source roles directly, and
 * legacyProjection()/LEGACY_DEFAULT_THEME/the /api/v1/theme field are
 * unchanged by this task.
 */

const PRIMARY = "#014D4E";
const PRIMARY_STRONG_TODAY = "#002929";
const PRIMARY_STRONG_AFTER = "#054F50";
const CANVAS = "#F3FBFC";
const INK = "#151D1E";
const MUTED = "#3B494B";
const SURFACE = "#F3FBFC";
const DANGER = "#BA1A1A";

const STORE = {
	id: "11111111-1111-1111-1111-111111111111",
	public_identifier: "teststore",
	store_name: "Test Store",
	description: null,
	cover_url: null,
	logo_url: null,
	whatsapp: null,
	email: null,
	website: null,
	address: null,
	status: "active",
};
const CATEGORY = { id: "cat-1", category_code: "cat1", name: "Category" };
const PRODUCT = {
	id: "prod-1",
	product_code: "prod1",
	name: "Product",
	description: null,
	price_minor: 1000,
	currency: "EGP",
	stock: 5,
	available: 1,
	image_url: null,
};

describe("B8: Worker pages render standard light roles directly, with one intentional colour change", () => {
	beforeEach(async () => {
		await createSchema();
		invalidateDesignSystemCache();
	});

	it("white text on the new landing --g2 clears 4.5:1 contrast", async () => {
		expect(contrastRatio("#FFFFFF", PRIMARY_STRONG_AFTER)).toBeGreaterThanOrEqual(4.5);
	});

	it("renders landing, store, category, product, terms and privacy with the pinned colours, --g2 excepted", async () => {
		// Sanity: confirms this suite runs against the revision these literals were
		// pinned from, so a fixture change fails loudly here instead of silently.
		const revision = await loadActiveDesignSystem(env);
		expect(revision.snapshot.schemes.standard.light.primary).toBe(PRIMARY);
		expect(revision.snapshot.schemes.standard.light.background).toBe(CANVAS);
		expect(revision.snapshot.schemes.standard.light.onSurface).toBe(INK);
		expect(revision.snapshot.schemes.standard.light.onSurfaceVariant).toBe(MUTED);
		expect(revision.snapshot.schemes.standard.light.surface).toBe(SURFACE);
		expect(revision.snapshot.schemes.standard.light.error).toBe(DANGER);
		// The intentional change: onPrimaryContainer, not primaryContainer
		// ("#B0EEEE", legacyProjection's mapping) and not legacyTheme.primary_strong
		// ("#002929", today's rendered value).
		expect(revision.snapshot.schemes.standard.light.onPrimaryContainer).toBe(PRIMARY_STRONG_AFTER);
		expect(revision.snapshot.schemes.standard.light.primaryContainer).not.toBe(PRIMARY_STRONG_AFTER);
		expect(revision.legacyTheme.primary_strong).toBe(PRIMARY_STRONG_TODAY);

		const landing = await (await callWorker(publicWorker, new Request("https://orderak.app/"), env)).text();
		expect(landing).toContain(`<meta name="theme-color" content="${PRIMARY}">`);
		expect(landing).toContain(
			`:root{--g:${PRIMARY};--g2:${PRIMARY_STRONG_AFTER};--bg:${CANVAS};--tx:${INK};--muted:${MUTED};--card:${SURFACE}}`,
		);
		expect(landing).not.toContain(`--g2:${PRIMARY_STRONG_TODAY}`);

		const store = await (await renderStorePage(env, STORE, "ar")).text();
		expect(store).toContain(`<meta name="theme-color" content="${PRIMARY}">`);
		expect(store).toContain(`:root{--g:${PRIMARY};--bg:${CANVAS};--tx:${INK};--mut:${MUTED}}`);
		expect(store).toContain(`.form-error{color:${DANGER};`);

		const category = await (await renderCategoryPage(env, STORE, CATEGORY, "ar")).text();
		expect(category).toContain(`<meta name="theme-color" content="${PRIMARY}">`);
		expect(category).toContain(`:root{--g:${PRIMARY};--bg:${CANVAS};--tx:${INK};--mut:${MUTED}}`);

		const product = await (await renderProductPage(env, STORE, PRODUCT, "ar")).text();
		expect(product).toContain(`<meta name="theme-color" content="${PRIMARY}">`);
		expect(product).toContain(`:root{--g:${PRIMARY};--bg:${CANVAS};--tx:${INK};--mut:${MUTED}}`);

		const termsUrl = new URL("https://orderak.app/terms");
		const termsResponse = await handlePublicRoutes(new Request(termsUrl), env, termsUrl);
		const terms = await termsResponse!.text();
		expect(terms).toContain(`color:${INK};line-height:1.7`);
		expect(terms).toContain(`h1{color:${PRIMARY};font-size:24px}`);

		const privacyUrl = new URL("https://orderak.app/privacy");
		const privacyResponse = await handlePublicRoutes(new Request(privacyUrl), env, privacyUrl);
		const privacy = await privacyResponse!.text();
		expect(privacy).toContain(`color:${INK};line-height:1.7`);
		expect(privacy).toContain(`h1{color:${PRIMARY};font-size:24px}`);
	});
});
