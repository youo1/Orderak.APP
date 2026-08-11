// `@cloudflare/vitest-pool-workers` used to resolve the type of `env` from
// "cloudflare:test" through a `ProvidedEnv` interface that each project
// augmented. As of 0.18 it exports `env: Cloudflare.Env` directly and
// `ProvidedEnv` no longer exists, so augmenting it here was a silent no-op.
//
// The bindings now reach the tests through the two generated files (both
// contribute to `Cloudflare.Env`) and the secrets through the
// `declare namespace Cloudflare` block in ../src/env.d.ts.
declare global {
	/**
	 * Tests run against a single miniflare instance that binds everything both
	 * Workers declare, so specs see the union of the two surfaces. The production
	 * split into PublicWorkerEnv and AdminWorkerEnv is a trust boundary between
	 * two deployed Workers; the test runtime does not have that boundary, and
	 * pretending otherwise would only mean casting at every call site.
	 */
	type TestEnv = PublicWorkerEnv & AdminWorkerEnv;
}

export {};
