/// <reference types="vite/client" />
// Vite's client types, for the two things specs use from the bundler rather
// than from the Workers runtime: `?raw` imports and `import.meta.glob`. Both
// are used to read source files as text, which is how the guards that assert
// something about the *shape* of the code are written — the Workers pool
// resolves __dirname to a path its filesystem shim cannot open, so node:fs is
// not available to them.
//
// Referenced here rather than added to tsconfig's `types` array, which is
// pinned to the pool types for the reason documented in test/tsconfig.json.

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
