import {
	acquireProviderPermit,
	ProviderCircuitOpenError,
	recordProviderFailure,
	recordProviderSuccess,
} from "../../platform/resilience/provider-circuit";

type Json = Record<string, unknown>;

export interface DeepSeekMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface DeepSeekResult {
	content: string;
	promptTokens: number;
	completionTokens: number;
}

export class AiTemporarilyUnavailableError extends Error {
	readonly retryAfterSeconds: number;

	constructor(code = "ai_temporarily_unavailable", retryAfterSeconds = 60) {
		super(code);
		this.name = "AiTemporarilyUnavailableError";
		this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
	}
}

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const RETRYABLE_HTTP = new Set([408, 409, 429]);

function configuredNumber(value: string | undefined): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

async function runtimeAiEnabled(env: Env): Promise<boolean> {
	if (env.AI_ASSISTANT_ENABLED !== "true") return false;
	const row = await env.orderak_db.prepare("SELECT value_json FROM settings WHERE key='ai_enabled'")
		.first<{ value_json: string }>().catch(() => null);
	if (!row) return true;
	try { return JSON.parse(row.value_json) === true; } catch { return false; }
}

export async function deepSeekEnabled(env: Env): Promise<boolean> {
	return Boolean(env.DEEPSEEK_API_KEY) && await runtimeAiEnabled(env);
}

async function budgetConfiguration(env: Env): Promise<{ budget: number; inputRate: number; outputRate: number }> {
	const budget = configuredNumber(env.AI_MONTHLY_BUDGET_MICRO_USD);
	const inputRate = configuredNumber(env.DEEPSEEK_INPUT_MICRO_USD_PER_MILLION);
	const outputRate = configuredNumber(env.DEEPSEEK_OUTPUT_MICRO_USD_PER_MILLION);
	if (!budget || !inputRate || !outputRate) {
		console.error(JSON.stringify({ signal: "ai_budget_not_configured", provider: "deepseek" }));
		throw new AiTemporarilyUnavailableError("ai_budget_not_configured", 300);
	}
	return { budget, inputRate, outputRate };
}

async function currentMonthSpend(env: Env): Promise<number> {
	const row = await env.orderak_db.prepare(
		`SELECT COALESCE(SUM(estimated_cost_microusd),0) AS spent
		 FROM ai_provider_usage_events
		 WHERE provider='deepseek' AND created_at>=datetime('now','start of month')
		 AND created_at<datetime('now','start of month','+1 month')`,
	).first<{ spent: number }>();
	return Number(row?.spent ?? 0);
}

async function hashIdempotency(value: string): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordUsage(
	env: Env,
	organizationId: string | null,
	idempotencyKey: string,
	promptTokens: number,
	completionTokens: number,
	configuration: { budget: number; inputRate: number; outputRate: number },
): Promise<void> {
	const cost = Math.ceil(
		(promptTokens * configuration.inputRate + completionTokens * configuration.outputRate) / 1_000_000,
	);
	const key = `deepseek:${await hashIdempotency(idempotencyKey)}`;
	await env.orderak_db.prepare(
		`INSERT OR IGNORE INTO ai_provider_usage_events(
		 idempotency_key,organization_id,provider,prompt_tokens,completion_tokens,estimated_cost_microusd)
		 VALUES(?,?,'deepseek',?,?,?)`,
	).bind(key, organizationId, promptTokens, completionTokens, cost).run();
	const spent = await currentMonthSpend(env);
	const percent = Math.floor((spent * 100) / configuration.budget);
	const month = new Date().toISOString().slice(0, 7);
	for (const threshold of [50, 80, 100]) {
		if (percent < threshold) continue;
		const inserted = await env.orderak_db.prepare(
			`INSERT OR IGNORE INTO ai_budget_alerts(provider,budget_month,threshold_percent)
			 VALUES('deepseek',?,?)`,
		).bind(month, threshold).run();
		if ((inserted.meta.changes ?? 0) === 1) {
			console.error(JSON.stringify({
				signal: "ai_budget_threshold",
				provider: "deepseek",
				threshold_percent: threshold,
				spent_microusd: spent,
				budget_microusd: configuration.budget,
			}));
		}
	}
}

export async function callDeepSeek(
	env: Env,
	input: {
		organizationId: string | null;
		idempotencyKey: string;
		model: string;
		messages: DeepSeekMessage[];
		responseFormat?: Json;
	},
): Promise<DeepSeekResult> {
	if (!await deepSeekEnabled(env) || !env.DEEPSEEK_API_KEY) {
		throw new AiTemporarilyUnavailableError("ai_temporarily_unavailable", 60);
	}
	const configuration = await budgetConfiguration(env);
	if (await currentMonthSpend(env) >= configuration.budget) {
		console.error(JSON.stringify({ signal: "ai_budget_exhausted", provider: "deepseek" }));
		throw new AiTemporarilyUnavailableError("ai_budget_exhausted", 3600);
	}

	let permit;
	try {
		permit = await acquireProviderPermit(env, "deepseek");
	} catch (error) {
		if (error instanceof ProviderCircuitOpenError) {
			throw new AiTemporarilyUnavailableError("ai_temporarily_unavailable", error.retryAfterSeconds);
		}
		throw error;
	}

	let response: Response;
	try {
		response = await fetch(DEEPSEEK_URL, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
			body: JSON.stringify({
				model: input.model,
				messages: input.messages,
				response_format: input.responseFormat,
				max_tokens: 512,
				stream: false,
			}),
			signal: AbortSignal.timeout(20_000),
		});
	} catch (error) {
		await recordProviderFailure(env, permit);
		console.error(JSON.stringify({
			signal: "ai_provider_failure",
			provider: "deepseek",
			kind: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "connection",
		}));
		throw new AiTemporarilyUnavailableError();
	}

	if (RETRYABLE_HTTP.has(response.status) || response.status >= 500) {
		await recordProviderFailure(env, permit);
		const retryAfter = Number(response.headers.get("retry-after"));
		console.error(JSON.stringify({ signal: "ai_provider_failure", provider: "deepseek", http_status: response.status }));
		throw new AiTemporarilyUnavailableError(
			"ai_temporarily_unavailable",
			Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
		);
	}
	await recordProviderSuccess(env, permit);
	if (!response.ok) {
		console.error(JSON.stringify({ signal: "ai_provider_failure", provider: "deepseek", http_status: response.status }));
		throw new AiTemporarilyUnavailableError();
	}

	const body = await response.json<{
		choices?: { message?: { content?: string } }[];
		usage?: { prompt_tokens?: number; completion_tokens?: number };
	}>();
	const content = body.choices?.[0]?.message?.content?.trim();
	if (!content) throw new AiTemporarilyUnavailableError();
	const promptTokens = Math.max(0, Number(body.usage?.prompt_tokens ?? 0));
	const completionTokens = Math.max(0, Number(body.usage?.completion_tokens ?? 0));
	await recordUsage(
		env,
		input.organizationId,
		input.idempotencyKey,
		promptTokens,
		completionTokens,
		configuration,
	);
	return { content, promptTokens, completionTokens };
}
