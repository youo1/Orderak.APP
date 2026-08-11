import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	generateDesignSystem,
} from "../src/domains/design/design-system";

// The budget covers CI runner variance, not the generator's real cost.
//
// Eleven Backend CI runs over two days, on code that did not touch the
// generator, produced p95 values from 20.33ms to 29.33ms - a 44% spread. Three
// of those eleven landed above the old 25ms budget. The same code measured on a
// developer machine sits at 6-9ms. The absolute number is a property of whatever
// hardware GitHub hands out, and a threshold below the noise floor fails roughly
// one run in four for reasons that have nothing to do with the change under test.
//
// A gate that red-lights correct code a quarter of the time does not protect the
// generator. It teaches everyone to press re-run, which is worse than no gate,
// because it also buries the real regression when one finally arrives.
//
// 45ms is ~1.5x the worst honest observation. Within a single run the spread is
// only about 25% (p50 to p95), so what this can still catch is what it could
// always honestly catch: a change that makes the generator roughly twice as slow.
// Tightening this back toward the observed range will not add sensitivity, it
// will only restore the flake - the noise is in the environment, not the code.
//
// The percentiles below are printed on every run. If the real cost drifts, that
// shows up as movement across runs long before it reaches this ceiling.
const BUDGET_MS = 45;
const SAMPLE_COUNT = 80;

async function main(): Promise<void> {
	for (let index = 0; index < 8; index++) {
		await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
	}

	const samples: number[] = [];
	for (let index = 0; index < SAMPLE_COUNT; index++) {
		const started = process.hrtime.bigint();
		await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		samples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
	}

	samples.sort((left, right) => left - right);
	const quantile = (fraction: number): number =>
		samples[Math.ceil(samples.length * fraction) - 1];
	const p95 = quantile(0.95);

	// min and p50 alongside p95, so a run that passes still says how much of the
	// number was the generator and how much was the runner. A real regression
	// lifts all three together; a noisy neighbour lifts only the tail.
	console.log(
		`Design-system generator: min ${samples[0].toFixed(2)}ms, p50 ${quantile(0.5).toFixed(2)}ms, p95 ${p95.toFixed(2)}ms ` +
			`(${SAMPLE_COUNT} samples, budget < ${BUDGET_MS}ms on p95)`,
	);
	if (p95 >= BUDGET_MS) process.exitCode = 1;
}

void main();
