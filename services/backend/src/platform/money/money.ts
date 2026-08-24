/**
 * Money as an amount plus a currency — never a bare number.
 *
 * Implements ADR-009. The decision it replaces (ADR-002) stored money as
 * "integer piasters", which fused three separate facts into one: the amount,
 * the currency, and the number of minor units per major unit. That works
 * exactly as long as every market has 100 minor units. Three of the nine
 * markets `Countries.kt` already offers do not:
 *
 *   15000 minor units  =  150.00 EGP   (exponent 2)
 *   15000 minor units  =   15.000 KWD  (exponent 3)
 *
 * A hardcoded `/ 100` is not off by a rounding error in Kuwait, Bahrain and
 * Oman. It is off by a factor of ten.
 *
 * WHY THERE IS NO EXPONENT TABLE HERE
 *   `Intl.NumberFormat` already carries ISO 4217 exponents and is kept current
 *   by the runtime's ICU data. A hand-maintained table would be a second source
 *   of truth that can only ever drift away from the first, and it would drift
 *   silently — a wrong exponent produces a plausible number, not an error.
 *
 *   What is declared explicitly below is which currencies are *enabled*, which
 *   is a business decision and genuinely does belong in code.
 */

// `z` comes from @hono/zod-openapi rather than zod directly: it is the same
// Zod, already extended with `.openapi()`. Importing the bare zod here and
// calling `.openapi()` type-checks against the extended global declaration but
// throws at runtime, which is the worst combination of the two.
import { z } from "@hono/zod-openapi";

/**
 * Currencies this deployment accepts.
 *
 * ADR-009 changes the representation, not the market list: EGP is the only
 * enabled currency until the second market opens. The rest are declared so the
 * type, the validation and the tests all exercise a 3-exponent currency from
 * the first day rather than discovering it at launch.
 */
export const SUPPORTED_CURRENCIES = ["EGP", "SAR", "AED", "QAR", "KWD", "BHD", "OMR"] as const;
export const ENABLED_CURRENCIES = ["EGP"] as const;

/**
 * The currency assumed when a stored row or an inbound payload does not carry
 * one.
 *
 * Declared here so the assumption has exactly one home. It used to be a bare
 * `?? "EGP"` repeated across api-store.ts, catalog.ts and public-router.ts —
 * and in all three the SELECT feeding it never read the currency column at all,
 * so the fallback was not a fallback, it was the only value any of them ever
 * produced. A row stored as KWD came back out of the API as EGP.
 *
 * Opening a second market means changing the enabled list above, at which point
 * every remaining use of this constant is a place that has to be revisited
 * deliberately rather than one that quietly keeps answering "EGP".
 */
export const DEFAULT_CURRENCY: (typeof ENABLED_CURRENCIES)[number] = ENABLED_CURRENCIES[0];

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const CurrencySchema = z.enum(SUPPORTED_CURRENCIES);

/**
 * A monetary value. `amount_minor` is an integer count of the currency's
 * smallest unit — piasters for EGP, fils for KWD — and is meaningless without
 * the currency beside it.
 */
export const MoneySchema = z
	.object({
		amount_minor: z.number().int(),
		currency: CurrencySchema,
	})
	.openapi("Money", {
		description:
			"An amount in the currency's minor units, plus the currency. The number of minor "
			+ "units per major unit follows ISO 4217 and is not always 100: EGP has 2 decimal "
			+ "places, KWD has 3. Never divide by a constant.",
		example: { amount_minor: 15000, currency: "EGP" },
	});

export type Money = z.infer<typeof MoneySchema>;

/**
 * Minor units per major unit for a currency, read from ICU rather than declared.
 *
 * Throws on an unknown currency instead of defaulting to 2. A default here
 * would turn "we forgot to add this currency" into "every amount in this
 * currency is wrong by a factor of ten", which is the failure this module
 * exists to prevent.
 */
export function exponentOf(currency: Currency): number {
	const resolved = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions();
	const exponent = resolved.minimumFractionDigits;
	if (typeof exponent !== "number") {
		throw new Error(`No ISO 4217 exponent available for currency ${currency}`);
	}
	return exponent;
}

/** Build a Money, rejecting a non-integer amount rather than silently truncating it. */
export function money(amountMinor: number, currency: Currency): Money {
	if (!Number.isInteger(amountMinor)) {
		throw new Error(`Money amount must be an integer count of minor units, received ${amountMinor}`);
	}
	return { amount_minor: amountMinor, currency };
}

/**
 * Format for display. The locale governs digits and separators; the currency
 * governs the symbol and the number of decimal places.
 *
 * `ar-EG` renders Eastern Arabic numerals and `ar-SA` renders the Saudi riyal
 * symbol, both without any per-market branching here.
 */
export function formatMoney(value: Money, locale: string): string {
	const major = value.amount_minor / 10 ** exponentOf(value.currency);
	return new Intl.NumberFormat(locale, { style: "currency", currency: value.currency }).format(major);
}

/**
 * Parse a user-entered major-unit amount into minor units.
 *
 * Rounds rather than truncates: `4.35` in a 2-exponent currency is 435 minor
 * units, not 434. This repeats a fix already recorded in `Money.kt` — the
 * Android side hit the truncation bug first, and re-introducing it on the
 * server would be a regression against a known defect.
 *
 * Returns null for input that is not a finite number, so a caller cannot
 * mistake a parse failure for a zero amount.
 */
export function parseMoney(text: string, currency: Currency): Money | null {
	const normalized = text.replace(/[\s,٬ ]/g, "").replace(/٫/, ".");
	if (normalized === "" || !/^-?\d*\.?\d*$/.test(normalized)) return null;
	const major = Number(normalized);
	if (!Number.isFinite(major)) return null;
	return money(Math.round(major * 10 ** exponentOf(currency)), currency);
}

/** Add amounts, refusing to mix currencies rather than producing a wrong total. */
export function addMoney(left: Money, right: Money): Money {
	if (left.currency !== right.currency) {
		throw new Error(`Cannot add ${left.currency} to ${right.currency}`);
	}
	return money(left.amount_minor + right.amount_minor, left.currency);
}

/**
 * Apply a percentage, rounding half away from zero.
 *
 * The rounding mode is stated here because ADR-009 leaves it to the
 * implementation and a percentage of a 3-exponent amount is where it starts to
 * matter. Half-away-from-zero matches what `Math.round` does for positive
 * amounts and keeps refunds symmetric with charges.
 */
export function percentOf(value: Money, percent: number): Money {
	const raw = (value.amount_minor * percent) / 100;
	const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw);
	return money(rounded, value.currency);
}
