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

export default function () {
  const response = http.get(`${baseUrl}/api/v1/theme`, {
    headers: { "X-Request-ID": `k6-${__VU}-${__ITER}` },
    tags: { operation: "get_v1_theme" },
  });
  check(response, {
    "no unexpected 5xx": (res) => res.status < 500,
    "request id is returned by Worker": (res) => baseUrl.includes(":4010") || Boolean(res.headers["X-Request-Id"] || res.headers["X-Request-ID"]),
  });
}
