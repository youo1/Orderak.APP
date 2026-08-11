import fs from "node:fs";
import path from "node:path";
import { openapiRoot } from "./route-inventory.mjs";

function downgradeSchema(value) {
  if (Array.isArray(value)) return value.map(downgradeSchema);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (["$schema", "jsonSchemaDialect", "examples", "const", "unevaluatedProperties"].includes(key)) {
      if (key === "const") output.enum = [child];
      else if (key === "examples" && Array.isArray(child) && child.length) output.example = downgradeSchema(child[0]);
      continue;
    }
    if (key === "type" && Array.isArray(child)) {
      const nonNull = child.filter((item) => item !== "null");
      output.type = nonNull.length === 1 ? nonNull[0] : nonNull;
      if (child.includes("null")) output.nullable = true;
      continue;
    }
    output[key] = downgradeSchema(child);
  }
  return output;
}

for (const surface of ["seller", "admin", "integrations"]) {
  const source = JSON.parse(fs.readFileSync(path.join(openapiRoot, "dist", `${surface}-v1.json`), "utf8"));
  const output = downgradeSchema(source);
  output.openapi = "3.0.3";
  delete output.jsonSchemaDialect;
  fs.writeFileSync(path.join(openapiRoot, "dist", `cloudflare-${surface}-v1-oas30.json`), `${JSON.stringify(output, null, 2)}\n`);
}
console.log("Generated explicit OAS 3.0.3 projections for Cloudflare API Shield staging import.");
