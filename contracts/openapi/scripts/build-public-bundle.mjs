import fs from "node:fs";
import path from "node:path";
import { openapiRoot } from "./route-inventory.mjs";

const source = JSON.parse(fs.readFileSync(path.join(openapiRoot, "dist", "seller-v1.json"), "utf8"));
const output = structuredClone(source);
output.info.title = "Orderak Public Developer API";
output.info.description = "Public L0 operations approved for external documentation. Try-it-out is intentionally disabled by the portal.";
output.servers = [{ url: "https://api.orderak.app", description: "Production (available after release gate)" }];
output.paths = {};
if (output.components) delete output.components.securitySchemes;
for (const [routePath, pathItem] of Object.entries(source.paths)) {
  const allowed = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = pathItem[method];
    if (!operation) continue;
    if (operation["x-data-classification"] !== "L0") continue;
    allowed[method] = operation;
  }
  if (Object.keys(allowed).length) output.paths[routePath] = allowed;
}
const serialized = JSON.stringify(output, null, 2);
for (const forbidden of ["x-orderak-secret", "orderak_admin_session", "/api/admin/", "/api/integrations/", '"L1"', '"L2"', '"L3"', '"pending-review"']) {
  if (serialized.includes(forbidden)) throw new Error(`Public bundle leakage check failed: ${forbidden}`);
}
fs.mkdirSync(path.join(openapiRoot, "dist"), { recursive: true });
fs.writeFileSync(path.join(openapiRoot, "dist", "public-v1.json"), `${serialized}\n`);
console.log(`Public bundle contains ${Object.keys(output.paths).length} L0 paths.`);
