/**
 * Response schemas, keyed by the operation they describe.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE ROUTES
 *   `bootstrap-specs.mjs` generates the OpenAPI documents in Node, by reading
 *   Hono route registrations. It cannot import the Worker to ask it what a
 *   response looks like: `src/entrypoints/public-worker.ts` pulls in
 *   `cloudflare:workers`, which does not exist outside workerd. Verified
 *   2026-08-21 — the import fails with `Cannot find module 'cloudflare:workers'`.
 *
 *   So the schemas live in modules that import nothing but Zod. Node imports
 *   them directly (Node 24 strips types natively, no loader needed), the
 *   generator reads them, and the Worker imports the same definitions when a
 *   route is migrated to `app.openapi()`. One definition, two consumers, no
 *   copy that can drift.
 *
 * WHY THE MAP IS NOT THE ROUTE LIST
 *   Route discovery already works and is enforced at 100% coverage. This does
 *   not repeat it. An entry here says "this operation's success payload has
 *   this shape"; an absent entry means the payload is not modelled yet and the
 *   generator falls back to `GenericSuccess`.
 *
 *   That fallback is deliberate. 244 operations cannot be modelled by pattern:
 *   each one needs its handler read. A schema invented without reading the
 *   handler is worse than no schema, because `GenericSuccess` is visibly empty
 *   while a wrong schema looks authoritative and gets trusted by Schemathesis,
 *   the Prism mock and every generated client.
 */

import { z } from "@hono/zod-openapi";
import { MoneySchema } from "../platform/money/money";

/** Every success response carries `ok: true`; the payload extends it. */
const ok = <T extends z.ZodRawShape>(shape: T) => z.object({ ok: z.literal(true), ...shape });

// ---------------------------------------------------------------------------
// Seller surface
// ---------------------------------------------------------------------------

export const OrderItemSchema = z
	.object({
		product_id: z.string().nullable(),
		product_code: z.string().nullable(),
		product_name: z.string(),
		qty: z.number().int().nonnegative(),
		// The line takes the order's currency; see ADR-009 on why it does not
		// carry one of its own.
		price: MoneySchema,
	})
	.openapi("OrderItem");

export const OrderSchema = z
	.object({
		id: z.string(),
		order_no: z.number().int(),
		buyer_phone: z.string(),
		buyer_name: z.string().nullable(),
		status: z.string(),
		pay_method: z.string(),
		total: MoneySchema,
		note: z.string().nullable(),
		created_at: z.string().nullable(),
		items: z.array(OrderItemSchema),
	})
	.openapi("Order");

export const ProductSchema = z
	.object({
		id: z.string(),
		product_code: z.string(),
		name: z.string(),
		slug: z.string().nullable(),
		description: z.string().nullable(),
		price: MoneySchema,
		stock: z.number().int(),
		stock_version: z.number().int(),
		available: z.boolean(),
		image_url: z.string().nullable(),
		category_code: z.string().nullable(),
	})
	.openapi("Product");

/**
 * A modelled operation carries its example with it.
 *
 * The generator used to attach three generic examples to every operation — a
 * bare `{ ok: true }`, an empty page and a paginated page — and all three
 * validated against anything, because the schema was `GenericSuccess` with
 * `additionalProperties: true`. Now that the schema is real, a generic example
 * fails Redocly's `oas3-valid-media-example`, which is the linter doing its job
 * for the first time on this operation. The example therefore lives here, next
 * to the schema it has to satisfy.
 */
export interface ModelledResponse {
	schema: z.ZodTypeAny;
	example: unknown;
}

const exampleMoney = { amount_minor: 15000, currency: "EGP" };

export const RESPONSE_SCHEMAS: Record<string, ModelledResponse> = {
	"GET /api/v1/orders": {
		schema: ok({
			orders: z.array(OrderSchema),
			has_more: z.boolean(),
			next_since: z.number().int(),
		}),
		example: {
			ok: true,
			orders: [{
				id: "018f-example", order_no: 12, buyer_phone: "+201000000000",
				buyer_name: "Mariam", status: "NEW", pay_method: "COD",
				total: exampleMoney, note: null, created_at: "2026-08-21T10:00:00Z",
				items: [{
					product_id: "018f-product", product_code: "P-0001",
					product_name: "Cola", qty: 2, price: { amount_minor: 7500, currency: "EGP" },
				}],
			}],
			has_more: false,
			next_since: 12,
		},
	},
	"PATCH /api/v1/orders/{id}/status": {
		schema: ok({
			id: z.string(),
			order_no: z.number().int(),
			status: z.enum(["NEW", "CONFIRMED", "PAID", "SHIPPED", "DONE", "CANCELLED"]),
			// False when the order already held the requested status. The call
			// still succeeds — a retried request must converge, not error — so the
			// flag is how a caller tells "I moved it" from "it was already there".
			changed: z.boolean(),
		}),
		example: { ok: true, id: "018f-example", order_no: 12, status: "CONFIRMED", changed: true },
	},
	"POST /api/v1/products/sync": {
		schema: ok({ products: z.array(ProductSchema) }),
		example: {
			ok: true,
			products: [{
				id: "018f-product", product_code: "P-0001", name: "Cola", slug: "cola",
				description: null, price: exampleMoney, stock: 10, stock_version: 1,
				available: true, image_url: null, category_code: null,
			}],
		},
	},
};
