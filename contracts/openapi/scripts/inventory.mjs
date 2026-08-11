import fs from "node:fs";
import path from "node:path";
import { discoverRoutes, openapiRoot, surfaceFor } from "./route-inventory.mjs";

const routes = discoverRoutes();
const report = {
  generated_at: new Date().toISOString(),
  status: "pre-release-gap-inventory",
  totals: Object.fromEntries(["seller", "admin", "integrations"].map((surface) => [surface, routes.filter((route) => surfaceFor(route.path) === surface).length])),
  routes,
};
fs.mkdirSync(path.join(openapiRoot, "reports"), { recursive: true });
fs.writeFileSync(path.join(openapiRoot, "reports", "endpoint-gap-inventory.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Inventory: ${routes.length} operations (${JSON.stringify(report.totals)})`);
