import fs from "node:fs";

const [baselinePath, validatedPath] = process.argv.slice(2);
if (!baselinePath || !validatedPath) throw new Error("usage: node compare-schema-validation.mjs baseline.json validated.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const validated = JSON.parse(fs.readFileSync(validatedPath, "utf8"));
const baselineP95 = baseline.metrics?.http_req_duration?.values?.["p(95)"];
const validatedP95 = validated.metrics?.http_req_duration?.values?.["p(95)"];
if (!Number.isFinite(baselineP95) || !Number.isFinite(validatedP95)) throw new Error("Both k6 summaries must contain http_req_duration p(95).");
const overhead = baselineP95 === 0 ? 0 : (validatedP95 - baselineP95) / baselineP95;
console.log(JSON.stringify({ baseline_p95_ms: baselineP95, validated_p95_ms: validatedP95, overhead_percent: overhead * 100 }, null, 2));
if (overhead > 0.10 || validatedP95 >= 500) process.exit(1);
