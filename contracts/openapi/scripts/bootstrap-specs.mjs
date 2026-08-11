import fs from "node:fs";
import path from "node:path";
import { discoverRoutes, openapiRoot, surfaceFor } from "./route-inventory.mjs";

const publicSellerPaths = new Set([
  "/api/v1/theme",
  "/api/v1/plans",
  "/api/v1/slug/check",
  "/api/v1/catalog/business-categories",
  "/api/v1/catalog/business-subcategories",
  "/api/v1/billing/catalog"
]);
const idempotentFragments = ["/complete", "/verify", "/subscribe", "/sync", "/payment", "/rtdn"];

function operationId(method, routePath) {
  return `${method.toLowerCase()}_${routePath.replace(/^\/api\//, "").replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function problemExample(status, code, retryable = false) {
  return {
    type: `https://developers.orderak.app/problems/${code}`,
    title: code.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    status,
    code,
    detail: code === "validation_failed" ? "One or more fields are invalid." : "The request could not be completed.",
    request_id: "018f-example",
    ...(retryable ? { retryable: true } : {})
  };
}

function response(status, description, example, retryAfter = false) {
  return {
    description,
    headers: {
      "X-Request-ID": { "$ref": "./components/common.json#/headers/RequestId" },
      ...(retryAfter ? { "Retry-After": { "$ref": "./components/common.json#/headers/RetryAfter" } } : {})
    },
    content: {
      [status < 400 ? "application/json" : "application/problem+json"]: {
        schema: { "$ref": status < 400 ? "./components/common.json#/schemas/GenericSuccess" : "./components/common.json#/schemas/Problem" },
        examples: status < 400 ? {
          success: { value: example },
          empty: { value: { ok: true, items: [], has_more: false } },
          pagination: { value: { ok: true, items: [{ id: "example" }], next_cursor: "opaque-cursor", has_more: true } }
        } : { default: { value: example } }
      }
    }
  };
}

function buildOperation(route, surface) {
  const mutating = route.method !== "GET";
  const hasJsonBody = ["POST", "PUT", "PATCH"].includes(route.method);
  const isPublic = surface === "seller" && publicSellerPaths.has(route.path);
  const pathParameters = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1], in: "path", required: true, schema: { type: "string", minLength: 1 }
  }));
  const parameters = [
    { "$ref": "./components/common.json#/parameters/RequestId" },
    // Every seller operation carries the client identification headers, public
    // ones included: tooling/repository/verify-deployment-map.mjs enforces this
    // across the whole seller surface. They used to be added to the spec by hand
    // after generation, which meant regenerating silently dropped them — so the
    // generator emits them instead.
    ...(surface === "seller"
      ? [
        { "$ref": "./components/common.json#/parameters/ClientPlatform" },
        { "$ref": "./components/common.json#/parameters/AppVersion" }
      ]
      : []),
    ...pathParameters
  ];
  if (surface === "seller" && mutating && idempotentFragments.some((fragment) => route.path.includes(fragment))) {
    parameters.push({ "$ref": "./components/common.json#/parameters/IdempotencyKey" });
  }
  const security = isPublic ? [] : surface === "admin"
    ? [{ adminSession: [] }]
    : surface === "integrations"
      ? route.path.includes("google-play") ? [{ googleOidc: [] }] : [{ webhookSignature: [] }]
      : [{ sellerDevice: [] }];
  return {
    operationId: operationId(route.method, route.path),
    tags: [surface],
    summary: `${route.method} ${route.path}`,
    description: `Pre-release ${surface} v1 operation. Detailed domain schemas replace the generic bootstrap schema during API-first review.`,
    "x-owner": surface === "admin" ? "Platform Engineering" : surface === "integrations" ? "Backend Integrations" : "Seller Experience",
    "x-data-classification": isPublic ? "L0" : surface === "admin" ? "L1" : surface === "integrations" ? "L3" : "pending-review",
    "x-rate-limit": isPublic ? "edge-public-default" : `${surface}-authenticated-default`,
    "x-stability": "draft",
    security,
    parameters,
    ...(hasJsonBody ? {
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
            examples: { valid: { value: {} }, validation_failure: { value: { unexpected: "review-schema" } } }
          }
        }
      }
    } : {}),
    responses: {
      "200": response(200, "Successful response", { ok: true }),
      "400": response(400, "Validation failure", { ...problemExample(400, "validation_failed"), field_errors: { field: "invalid" } }),
      "401": response(401, "Authentication required", problemExample(401, "auth")),
      "403": response(403, "Insufficient permission", problemExample(403, "forbidden")),
      "429": response(429, "Rate limited", problemExample(429, "rate_limited", true), true),
      "503": response(503, "Retryable dependency failure", problemExample(503, "temporarily_unavailable", true), true)
    }
  };
}

const routes = discoverRoutes();
for (const surface of ["seller", "admin", "integrations"]) {
  // ALL is the sentinel for `app.all(path)`, which answers any method. It is a
  // catch-all — usually a terminating 404 — not an operation, and "all" is not
  // a valid OpenAPI path-item key, so it never reaches the spec.
  const surfaceRoutes = routes.filter(
    (route) => surfaceFor(route.path) === surface && route.method !== "ALL",
  );
  const paths = {};
  for (const route of surfaceRoutes) {
    // Where a route constrains a parameter to literal alternatives —
    // `:action{verify|retry}` — document each concrete path rather than the
    // parameterised form. Two operations named verify and retry carry more
    // contract information than one `{action}` placeholder: each gets its own
    // operationId and summary, and can describe what it actually does. The
    // canonical form is dropped in that case, since the alternatives cover it.
    const concrete = (route.variants ?? [route.path]).filter((variant) => variant !== route.path);
    for (const routePath of concrete.length > 0 ? concrete : [route.path]) {
      paths[routePath] ??= {};
      paths[routePath][route.method.toLowerCase()] = buildOperation({ ...route, path: routePath }, surface);
    }
  }
  const basePath = surface === "seller" ? "/api/v1" : surface === "admin" ? "/api/admin/v1" : "/api/integrations/v1";
  const spec = {
    openapi: "3.1.2",
    info: {
      title: `Orderak ${surface[0].toUpperCase() + surface.slice(1)} API`,
      version: "1.0.0-draft",
      description: "First pre-release production contract. Breaking changes are allowed while x-stability is draft and must be recorded in the API changelog.",
      contact: { name: "Orderak Engineering", url: "https://docs.orderak.app" },
      license: { name: "Proprietary — internal pre-release", url: "https://docs.orderak.app/legal/terms-of-service/" }
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    // Production first, then staging, then the local mock. These used to be
    // completed by hand after generation, so regenerating dropped the production
    // entry and broke the server expectations in
    // tooling/repository/verify-deployment-map.mjs.
    servers: surface === "admin"
      ? [
        { url: "https://admin.orderak.app", description: "Production" },
        { url: "https://admin.staging.orderak.app", description: "Staging" }
      ]
      : [
        { url: "https://api.orderak.app", description: "Production" },
        { url: "https://api.staging.orderak.app", description: "Staging" },
        ...(surface === "seller" ? [{ url: "http://localhost:4010", description: "Local Prism" }] : [])
      ],
    tags: [{ name: surface, description: `${surface} v1 operations` }],
    paths,
    components: {
      securitySchemes: {
        ...(surface === "seller" ? { sellerDevice: { "$ref": "./components/common.json#/securitySchemes/sellerDevice" } } : {}),
        ...(surface === "admin" ? { adminSession: { "$ref": "./components/common.json#/securitySchemes/adminSession" } } : {}),
        ...(surface === "integrations" ? {
          googleOidc: { "$ref": "./components/common.json#/securitySchemes/googleOidc" },
          webhookSignature: { "$ref": "./components/common.json#/securitySchemes/webhookSignature" }
        } : {})
      }
    },
    "x-stability": "draft",
    "x-api-prefix": basePath
  };
  fs.mkdirSync(path.join(openapiRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(openapiRoot, "src", `${surface}-v1.json`), `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`Wrote ${surface}-v1.json with ${surfaceRoutes.length} operations.`);
}
