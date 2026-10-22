import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { handleAuthV2Routes } from "../src/domains/identity/auth-v2";
import { createSchema } from "./helpers";

const PHONE = "+201009876543";
const DEVICE_SECRET = "device-secret-with-enough-entropy";
let testEnv: TestEnv;

function freshFirebaseToken(): string {
  const payload = btoa(JSON.stringify({ auth_time: Math.floor(Date.now() / 1000) }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

async function route(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const request = new Request(`https://api.orderak.app${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.72",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const response = await handleAuthV2Routes(request, testEnv, new URL(request.url), createExecutionContext());
  if (!response) throw new Error(`route_not_handled:${path}`);
  return response;
}

beforeEach(async () => {
  await createSchema();
  testEnv = Object.create(env) as TestEnv;
  testEnv.FIREBASE_WEB_API_KEY = "test-key";
  testEnv.ONBOARDING_ENABLED = "true";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ users: [{ localId: "firebase-v2-user", phoneNumber: PHONE }] })));
});

afterEach(() => vi.unstubAllGlobals());

describe("R3a onboarding legacy category input validation", () => {
  it("rejects a non-string supplied legacy category instead of treating it as omitted", async () => {
    const started = await route("/api/v1/auth/phone/complete", {
      id_token: freshFirebaseToken(), phone: PHONE, device_secret: DEVICE_SECRET,
    });
    expect(started.status).toBe(200);
    const { onboarding_token: token } = await started.json<{ onboarding_token: string }>();

    const account = await route("/api/v1/onboarding/account", {
      full_name: "Setup Seller", age_confirmed: true, terms_accepted: true, app_version: "3.0.0",
    }, token);
    expect(account.status).toBe(200);

    const response = await route("/api/v1/onboarding/complete", {
      device_secret: DEVICE_SECRET, store_name: "Typed Category Shop", country_iso: "EG", business_category: 123,
    }, token);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_business_category" });
  });
});
