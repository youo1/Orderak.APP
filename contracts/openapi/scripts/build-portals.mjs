import fs from "node:fs";
import path from "node:path";
import { openapiRoot } from "./route-inventory.mjs";

const build = path.join(openapiRoot, "portal-build");
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(path.join(build, "internal", "specs"), { recursive: true });
fs.mkdirSync(path.join(build, "public", "specs"), { recursive: true });
for (const surface of ["seller", "admin", "integrations"]) {
  fs.copyFileSync(path.join(openapiRoot, "dist", `${surface}-v1.json`), path.join(build, "internal", "specs", `${surface}-v1.json`));
}
fs.copyFileSync(path.join(openapiRoot, "dist", "public-v1.json"), path.join(build, "public", "specs", "public-v1.json"));
for (const portal of ["internal", "public"]) {
  fs.copyFileSync(path.join(openapiRoot, "portal", portal, "index.html"), path.join(build, portal, "index.html"));
}
console.log("Built internal Swagger UI and public Redoc portal artifacts.");
