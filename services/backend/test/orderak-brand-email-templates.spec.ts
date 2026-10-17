import { describe, expect, it } from "vitest";
import { SEED_TEMPLATES } from "../src/integrations/email/seeds";

// Plan item B9: the legacy Orderak mark (#1DAB61 bag, #127943 bubble, #ED8936
// badge) must not remain as active brand styling anywhere outside
// docs/archive/. The default email templates are the only place in the
// backend source that hard-codes the legacy green.
describe("plan item B9: email templates drop the legacy mark colors", () => {
	it("no seed template uses the legacy green, bubble or badge-orange mark colors", () => {
		const text = JSON.stringify(SEED_TEMPLATES);
		expect(text).not.toMatch(/#1DAB61/i);
		expect(text).not.toMatch(/#127943/i);
		expect(text).not.toMatch(/#ED8936/i);
	});
});
