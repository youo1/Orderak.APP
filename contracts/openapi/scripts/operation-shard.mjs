import fs from "node:fs";

const [specPath, rawShard, rawTotal] = process.argv.slice(2);
const shard = Number(rawShard);
const total = Number(rawTotal);
if (!specPath || !Number.isInteger(shard) || !Number.isInteger(total) || shard < 0 || shard >= total) {
  throw new Error("usage: node operation-shard.mjs <spec> <zero-based-shard> <total>");
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const ids = [];
for (const pathItem of Object.values(spec.paths)) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    if (pathItem[method]?.operationId) ids.push(pathItem[method].operationId);
  }
}
const selected = ids.sort().filter((_, index) => index % total === shard);
process.stdout.write(selected.length ? `^(${selected.join("|")})$` : "(?!)");
