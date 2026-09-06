import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * One answer to "is this the same phone number", for every system that asks.
 *
 * There were three, and they disagreed in ways that decide who a customer is:
 *
 *   identity.ts     `+` prefix, 8-15 digits          — seller identity
 *   auth-v2.ts      `+` prefix, 7-15 digits          — a module-private copy
 *                                                      with a different bound
 *   catalog.ts      `replace(/\D/g, "")`             — buyer phone, `+` stripped
 *
 * The first two differ by one digit, which means a phone that signs in through
 * auth-v2 can be flagged `invalid_phone_e164` by the readiness check that reads
 * the same column. The third is the one that matters here: buyer phone is not
 * normalised at all, so `01012345678` and `+201012345678` are two different
 * people, and a customers table keyed on the raw value would inherit that
 * permanently (I-6).
 *
 * libphonenumber is the authority on validity. The regex below is a cheap shape
 * check for the stored form, not a second opinion about whether a number exists.
 */

/**
 * Storage shape for a normalised number: `+` and 8 to 15 digits.
 *
 * The 8-digit floor is identity.ts's, kept rather than auth-v2's 7: no assigned
 * E.164 number is seven digits long, so nothing real is refused by taking the
 * stricter of the two, and taking the looser one would have widened a validator
 * to accommodate a value that cannot occur.
 */
export function validE164(phone: string): boolean {
	return /^\+[1-9]\d{7,14}$/.test(phone);
}

/**
 * Values in `buyer_phone` that are not phone numbers and must never be treated
 * as one.
 *
 * The buyer-privacy erasure path writes `deleted:<20 hex>` into the column when
 * a deletion request completes, following the same convention as `expired:` and
 * `deleted:` on legal_acceptances and deletion_requests. Nothing enforced or
 * documented that as a column invariant, so every pass over the column has had
 * to know about it by luck. Anything that reads buyer_phone should call this
 * first: these rows exist for compliance reasons and normalising, merging or
 * re-identifying one would undo the erasure it records.
 */
export function isPrivacySentinel(value: string): boolean {
	return value.startsWith("deleted:") || value.startsWith("expired:");
}

/**
 * What normalisation concluded about one raw value.
 *
 * Three outcomes, not two, because "could not resolve this" and "this is not a
 * number" lead to different handling and neither may be merged with anything.
 *
 *   valid      resolves to exactly one E.164 number — safe to key on
 *   ambiguous  plausible, but not resolvable without a country it does not
 *              carry — a bare national number from a store whose own country
 *              does not explain it
 *   invalid    not a plausible number in the region offered
 *   sentinel   a privacy marker, not a number at all
 *
 * Only `valid` may be merged with another spelling. The rest are preserved
 * verbatim and flagged, because guessing which customer an unresolvable value
 * belongs to is how two people's order histories become one.
 */
export type PhoneOutcome = "valid" | "ambiguous" | "invalid" | "sentinel";

export interface NormalizedPhone {
	outcome: PhoneOutcome;
	/** The E.164 form, present only when the outcome is `valid`. */
	e164: string | null;
	/** Exactly what was stored, always — nothing is discarded by normalising. */
	raw: string;
	/**
	 * The value to key a customer on: the E.164 form when there is one, and the
	 * raw value otherwise. An unresolvable value keys only to itself, so it can
	 * never collide with another customer.
	 */
	key: string;
}

function outcome(result: Omit<NormalizedPhone, "key">): NormalizedPhone {
	return { ...result, key: result.e164 ?? result.raw };
}

/**
 * Resolve a stored buyer phone, using the store's own country as the context
 * the value itself lacks.
 *
 * `region` is the seller's `country_code`. It is the only country information
 * the system has about a buyer: the storefront's phone input is a bare
 * `type="tel"` with no pattern, stripped to digits before it is stored, so the
 * column holds any 8-to-15-digit string on earth with no prefix, no country and
 * no plausibility check. A number that parses for the store's own country is
 * resolved; one that does not is left alone rather than guessed at.
 */
export function normalizeBuyerPhone(raw: string, region?: string | null): NormalizedPhone {
	const trimmed = raw.trim();
	if (isPrivacySentinel(trimmed)) {
		return outcome({ outcome: "sentinel", e164: null, raw: trimmed });
	}
	if (trimmed === "") {
		return outcome({ outcome: "invalid", e164: null, raw: trimmed });
	}

	// Already in international form: it carries its own country and needs no
	// region to resolve.
	if (trimmed.startsWith("+")) {
		const parsed = parsePhoneNumberFromString(trimmed);
		if (parsed?.isValid() && validE164(parsed.number)) {
			return outcome({ outcome: "valid", e164: parsed.number, raw: trimmed });
		}
		return outcome({ outcome: "invalid", e164: null, raw: trimmed });
	}

	const country = (region ?? "").trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(country)) {
		// A national number with no country to read it against. It may well be a
		// real number; there is simply nothing here that says whose.
		return outcome({ outcome: "ambiguous", e164: null, raw: trimmed });
	}

	const parsed = parsePhoneNumberFromString(trimmed, country as CountryCode);
	if (parsed?.isValid() && validE164(parsed.number)) {
		return outcome({ outcome: "valid", e164: parsed.number, raw: trimmed });
	}

	// Plausible length, but not a valid number for the one country available.
	// Ambiguous rather than invalid: it may be a perfectly good number from
	// somewhere else, and calling it invalid would be a claim this cannot make.
	const digits = trimmed.replace(/\D/g, "");
	if (digits.length >= 8 && digits.length <= 15) {
		return outcome({ outcome: "ambiguous", e164: null, raw: trimmed });
	}
	return outcome({ outcome: "invalid", e164: null, raw: trimmed });
}

/**
 * The key a customer row is addressed by, for one raw stored value.
 *
 * Shorthand for the common case; the full outcome is what callers need when
 * they have to decide whether merging is allowed.
 */
export function customerKeyFor(raw: string, region?: string | null): string {
	return normalizeBuyerPhone(raw, region).key;
}
