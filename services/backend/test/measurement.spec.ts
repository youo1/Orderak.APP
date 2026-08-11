import { afterEach, describe, expect, it, vi } from "vitest";
import { flushLatencySamples, measured, recordLatency } from "../src/platform/observability/measurement";

/**
 * The buffer used to hold samples across requests and emit only once fifty had
 * accumulated. Worker isolates are evicted without warning, so every partial
 * batch was lost — and lost unevenly: a busy isolate reached fifty and
 * reported, a quiet one never did. These pin the two properties that make the
 * data trustworthy: nothing is emitted before it is asked for, and nothing is
 * held back once it is.
 */
describe("latency measurement", () => {
	afterEach(() => {
		flushLatencySamples();
		vi.restoreAllMocks();
	});

	it("emits a single sample on flush — no minimum batch size", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		recordLatency("db", "read", 1.5);
		expect(log).not.toHaveBeenCalled();

		flushLatencySamples();
		expect(log).toHaveBeenCalledTimes(1);

		const payload = JSON.parse(log.mock.calls[0][0] as string);
		expect(payload).toMatchObject({ signal: "latency_samples", count: 1 });
		expect(payload.samples[0]).toMatchObject({ op: "db", outcome: "read", ms: 1.5 });
	});

	it("batches everything recorded since the last flush into one line", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		for (let i = 0; i < 7; i++) recordLatency("cache", i % 2 ? "hit" : "miss", i);

		flushLatencySamples();
		expect(log).toHaveBeenCalledTimes(1);
		expect(JSON.parse(log.mock.calls[0][0] as string).count).toBe(7);
	});

	it("empties the buffer, so a second flush does not repeat samples", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		recordLatency("db", "read", 2);
		flushLatencySamples();
		flushLatencySamples();
		expect(log).toHaveBeenCalledTimes(1);
	});

	it("is a no-op when nothing was recorded", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		flushLatencySamples();
		expect(log).not.toHaveBeenCalled();
	});

	it("measured() records the operation and returns its result", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const { result } = await measured("db", "geo_search", async () => "rows");
		expect(result).toBe("rows");

		flushLatencySamples();
		const payload = JSON.parse(log.mock.calls[0][0] as string);
		expect(payload.samples[0]).toMatchObject({ op: "db", outcome: "geo_search" });
		expect(payload.samples[0].ms).toBeGreaterThanOrEqual(0);
	});
});
