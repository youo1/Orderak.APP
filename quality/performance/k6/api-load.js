import http from "k6/http";
import { check } from "k6";

const baseUrl = (__ENV.BASE_URL || "http://127.0.0.1:4010").replace(/\/$/, "");
const profile = __ENV.PROFILE || "smoke";
if (/^https:\/\/api\.orderak\.app$/i.test(baseUrl)) {
  throw new Error("Load tests are forbidden against production.");
}

const profiles = {
  smoke: {
    executor: "constant-vus",
    vus: 2,
    duration: "30s",
  },
  pilot: {
    executor: "constant-arrival-rate",
    rate: 20,
    timeUnit: "1s",
    duration: "15m",
    preAllocatedVUs: 20,
    maxVUs: 50,
  },
  spike: {
    executor: "constant-arrival-rate",
    rate: 50,
    timeUnit: "1s",
    duration: "2m",
    preAllocatedVUs: 30,
    maxVUs: 50,
  },
  soak: {
    executor: "constant-arrival-rate",
    rate: 20,
    timeUnit: "1s",
    duration: "60m",
    preAllocatedVUs: 20,
    maxVUs: 50,
  },
};

export const options = {
  discardResponseBodies: true,
  scenarios: { [profile]: profiles[profile] || profiles.smoke },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<500", "p(99)<1500"],
    checks: ["rate>0.995"],
  },
};

// GET /api/v1/theme is edge-cacheable, and in both Staging and Production it is
// served from Cloudflare's cache: 30 consecutive requests returned
// `CF-Cache-Status: HIT`. A load test against the plain URL therefore measures
// Cloudflare's CDN, not this application — the Worker is never invoked, D1 is
// never queried, and a Worker that had regressed badly would not show up at all.
//
// That is fine for the CI smoke gate, which is checking the endpoint answers.
// It is not fine for a soak whose purpose is to produce a latency number a
// rollback trigger can be set from: such a trigger must fire when the *Worker*
// regresses. So the soak appends a unique query string, which misses both the
// edge cache and the Worker's own caches.default lookup and reaches D1.
//
// Measured 2026-08-13, 20 rps for 60s per arm, same generator and network path:
//   cached URL      p95 128.9 ms
//   cache-busted    p95 131.4 ms
// A ~2.5 ms difference — the application is not the slow part.
const cacheBust = __ENV.CACHE_BUST === "1";

export default function () {
  const url = cacheBust
    ? `${baseUrl}/api/v1/theme?__k6=${__VU}-${__ITER}`
    : `${baseUrl}/api/v1/theme`;
  const response = http.get(url, {
    headers: { "X-Request-ID": `k6-${__VU}-${__ITER}` },
    tags: { operation: "get_v1_theme" },
  });
  check(response, {
    "no unexpected 5xx": (res) => res.status < 500,
    "request id is returned by Worker": (res) => baseUrl.includes(":4010") || Boolean(res.headers["X-Request-Id"] || res.headers["X-Request-ID"]),
  });
}
