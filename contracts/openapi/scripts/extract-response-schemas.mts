/**
 * Emit the modelled response schemas as JSON Schema, for bootstrap-specs.mjs.
 *
 * WHY A SEPARATE PROCESS
 *   The schemas live in `services/backend/src/contracts/registry.ts` so that one
 *   definition serves both the generator and the Worker. The backend compiles
 *   with `moduleResolution: "Bundler"` and writes extensionless imports, which
 *   Node's native ESM resolver rejects — it wants `./money.js` or `./money.ts`.
 *   Rewriting every import to satisfy a build script would be the tail wagging
 *   the dog, so this runs under tsx, which resolves them the way the bundler
 *   does, and hands back plain JSON.
 *
 *   Output is JSON on stdout: `{ schemas, operations }`. `schemas` becomes the
 *   spec's `components.schemas`; `operations` maps "METHOD /path" to the schema
 *   (usually a `$ref`) for that operation's success response.
 */

import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
// Dynamic import, not a static one: the registry is a .ts file under a package
// with no "type": "module", so the loader treats it as CJS and a static named
// import fails with "does not provide an export named". import() interops.
const { RESPONSE_SCHEMAS } = (await import("../../../services/backend/src/contracts/registry.ts")) as {
	RESPONSE_SCHEMAS: Record<string, { schema: unknown; example: unknown }>;
};

const app = new OpenAPIHono();
const operationIds = new Map<string, string>();

let index = 0;
for (const [key, modelled] of Object.entries(RESPONSE_SCHEMAS)) {
	const separator = key.indexOf(" ");
	const method = key.slice(0, separator).toLowerCase();
	const path = key.slice(separator + 1);
	const operationId = `extract_${index++}`;
	operationIds.set(key, operationId);
	app.openapi(
		createRoute({
			method: method as "get" | "post" | "put" | "patch" | "delete",
			path,
			operationId,
			responses: {
				200: { description: "ok", content: { "application/json": { schema: modelled.schema as never } } },
			},
		}),
		// Never served. The handler exists because .openapi() requires one; this
		// module is imported by a build script, not by a Worker.
		(c) => c.json({ ok: true }),
	);
}

const document = app.getOpenAPIDocument({ openapi: "3.1.0", info: { title: "extract", version: "1" } });

/**
 * Rewrite OpenAPI 3.0 nullability into the 3.1 form.
 *
 * zod-to-openapi emits `nullable: true` regardless of the document version it is
 * handed, and the specs here declare 3.1.2, where `nullable` was removed in
 * favour of a type union. Redocly's `struct` rule rejects the 3.0 spelling —
 * nine errors, one per nullable field, all of them correct.
 *
 * Converting here rather than avoiding nullable fields in the registry keeps the
 * Zod schemas describing the payload honestly: `buyer_name` really can be null.
 */
function toOpenApi31Nullability(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(toOpenApi31Nullability);
	if (!node || typeof node !== "object") return node;
	const source = node as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) {
		if (key === "nullable") continue;
		result[key] = toOpenApi31Nullability(value);
	}
	if (source.nullable === true && typeof source.type === "string") {
		result.type = [source.type, "null"];
	} else if (source.nullable === true) {
		// A nullable $ref or composed schema has no `type` to widen, so the union
		// has to wrap it instead.
		const { ...rest } = result;
		return { anyOf: [rest, { type: "null" }] };
	}
	return result;
}

const operations: Record<string, unknown> = {};
for (const [pathKey, pathItem] of Object.entries(document.paths ?? {})) {
	for (const [method, operation] of Object.entries(pathItem as Record<string, unknown>)) {
		const op = operation as { operationId?: string; responses?: Record<string, unknown> };
		if (!op.operationId?.startsWith("extract_")) continue;
		const key = [...operationIds.entries()].find(([, id]) => id === op.operationId)?.[0];
		if (!key) continue;
		const response = op.responses?.["200"] as { content?: Record<string, { schema?: unknown }> } | undefined;
		const schema = response?.content?.["application/json"]?.schema;
		if (schema) operations[key] = { schema: toOpenApi31Nullability(schema), example: RESPONSE_SCHEMAS[key].example };
		void method;
		void pathKey;
	}
}

process.stdout.write(JSON.stringify({
	schemas: toOpenApi31Nullability(document.components?.schemas ?? {}),
	operations,
}, null, 2));
