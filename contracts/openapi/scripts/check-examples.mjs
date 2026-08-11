import fs from "node:fs";
import path from "node:path";
import { openapiRoot } from "./route-inventory.mjs";

/**
 * Every operation must document examples for its success case and for the three error
 * shapes a client has to handle: validation, rate limiting, and retryable failure.
 *
 * "Success" is whatever the operation actually declares
 * ----------------------------------------------------
 * This used to look only at `responses["200"].content["application/json"]`, which quietly
 * assumed every endpoint returns 200 with a JSON body. That held until the first honest
 * non-JSON operation appeared: GET /api/theme.css always answers 302 with a Location
 * header and no body at all, and GET /api/theme/{file} answers 200 with text/css. Both
 * were then reported as "missing required examples" - not because documentation was
 * missing, but because the checker could not describe them.
 *
 * A rule that fails correct specs teaches people to weaken the rule. So success is now
 * defined as the operation's own 2xx or 3xx response, and:
 *
 *   - a response with no content at all (a redirect) needs no example, because there is
 *     no body to give an example of. It must still declare its headers, which the
 *     redocly ruleset checks.
 *   - a response whose body is not JSON needs no `examples` map either: an example of a
 *     stylesheet is the stylesheet, and inlining one into the contract would duplicate
 *     generated output that changes with every design-system revision.
 *   - a JSON success response still requires examples, exactly as before.
 *
 * The error-shape requirements are unchanged and unconditional.
 */
const JSON_MEDIA = "application/json";
const PROBLEM_MEDIA = "application/problem+json";

/** The operation's declared success response, preferring 2xx over 3xx. */
function successResponse(responses) {
	const codes = Object.keys(responses ?? {});
	const twoXX = codes.find((code) => /^2\d\d$/.test(code));
	const threeXX = codes.find((code) => /^3\d\d$/.test(code));
	const code = twoXX ?? threeXX;
	return code ? { code, response: responses[code] } : null;
}

function successDocumented(responses) {
	const success = successResponse(responses);
	if (!success) return "declares no 2xx or 3xx response";

	const content = success.response?.content;
	// A bodyless response - a redirect, or 204 - has nothing to exemplify.
	if (!content || Object.keys(content).length === 0) return null;

	const json = content[JSON_MEDIA];
	// Non-JSON bodies (text/css, images) are not describable by a JSON example map.
	if (!json) return null;

	return json.examples ? null : `${success.code} ${JSON_MEDIA} has no examples`;
}

function problemDocumented(responses, code) {
	const examples = responses?.[code]?.content?.[PROBLEM_MEDIA]?.examples;
	return examples ? null : `${code} ${PROBLEM_MEDIA} has no examples`;
}

const failures = [];
for (const surface of ["seller", "admin", "integrations"]) {
	const spec = JSON.parse(fs.readFileSync(path.join(openapiRoot, "src", `${surface}-v1.json`), "utf8"));
	for (const [routePath, pathItem] of Object.entries(spec.paths)) {
		for (const method of ["get", "post", "put", "patch", "delete"]) {
			const operation = pathItem[method];
			if (!operation) continue;
			const reasons = [
				successDocumented(operation.responses),
				problemDocumented(operation.responses, "400"),
				problemDocumented(operation.responses, "429"),
				problemDocumented(operation.responses, "503"),
			].filter(Boolean);
			if (reasons.length > 0) failures.push(`${method.toUpperCase()} ${routePath}: ${reasons.join("; ")}`);
		}
	}
}

if (failures.length) {
	console.error(`Operations missing required examples:\n${failures.map((line) => `  ${line}`).join("\n")}`);
	process.exit(1);
}
console.log("Every operation documents its success case plus validation, rate-limit, and retryable examples.");
