import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSchema } from "./helpers";
import { handlePublicRoutes } from "../src/entrypoints/public-router";

describe("content pages use the generated Cairo typeface", () => {
  it.each(["terms", "privacy"])("uses Cairo on /%s", async (slug) => {
    await createSchema();
    const url = new URL(`https://orderak.app/${slug}`);
    const response = await handlePublicRoutes(new Request(url), env, url);
    const html = await response!.text();

    expect(html).toMatch(/body\{font-family:var\(--orderak-font-family/);
  });
});
