/**
 * Claude through the official SDK. The SDK's `fetch` is the transport's, so the
 * key is added on the way out (browser) or by the desktop shell — the SDK only
 * ever sees a placeholder.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODELS } from '../device';
import { providerFetch } from '../transport';
import {
	AiError,
	errorForStatus,
	type Adapter,
	type ModelInfo,
	type RunResult,
	type Schema,
	type SendRequest,
	type ToolDef
} from '../types';

type MessageParam = Anthropic.Beta.BetaMessageParam;

/**
 * Strict tool schemas: every object closed and every property required (our
 * schemas already list them all; optional values are nullable instead).
 */
export function toClaudeSchema(s: Schema): Record<string, unknown> {
	const out: Record<string, unknown> = { type: s.type };
	if (s.description) out.description = s.description;
	if (s.enum) {
		const nullable = Array.isArray(s.type) && s.type.includes('null');
		out.enum = nullable ? [...s.enum, null] : s.enum;
	}
	if (s.properties) {
		out.properties = Object.fromEntries(
			Object.entries(s.properties).map(([k, v]) => [k, toClaudeSchema(v)])
		);
		out.required = Object.keys(s.properties);
		out.additionalProperties = false;
	}
	if (s.items) out.items = toClaudeSchema(s.items);
	return out;
}

function toClaudeTool(tool: ToolDef): Anthropic.Beta.BetaTool {
	return {
		name: tool.name,
		description: tool.description,
		strict: true,
		input_schema: toClaudeSchema(tool.parameters) as Anthropic.Beta.BetaTool.InputSchema
	};
}

function userMessage(req: SendRequest): MessageParam {
	if (req.turn.kind === 'user') return { role: 'user', content: req.turn.text };
	return {
		role: 'user',
		// All results of one reply go back in a single message.
		content: req.turn.results.map((r) => ({
			type: 'tool_result' as const,
			tool_use_id: r.callId,
			content: r.content,
			...(r.isError ? { is_error: true } : {})
		}))
	};
}

function mapError(e: unknown): AiError {
	if (e instanceof AiError) return e;
	if (e instanceof Anthropic.APIConnectionError) {
		const cause = (e as { cause?: unknown }).cause;
		if (cause instanceof AiError) return cause;
		return new AiError('network', 'Could not reach Anthropic — check your connection.');
	}
	if (e instanceof Anthropic.APIError && e.status) return errorForStatus(e.status, e.message);
	return new AiError('network', e instanceof Error ? e.message : String(e));
}

/** The default if it's offered, else the newest model of the family, else the first one. */
function pick(models: ModelInfo[], preferred: string, family: RegExp): string {
	if (models.some((m) => m.id === preferred)) return preferred;
	return models.find((m) => family.test(m.id))?.id ?? models[0]?.id ?? preferred;
}

export function anthropicAdapter(fetchImpl: typeof fetch = providerFetch('anthropic')): Adapter {
	const client = new Anthropic({
		apiKey: 'added-by-transport',
		dangerouslyAllowBrowser: true,
		fetch: fetchImpl,
		maxRetries: 1
	});
	const defaults = DEFAULT_MODELS.anthropic;

	return {
		id: 'anthropic',
		defaults,

		async send(req: SendRequest): Promise<RunResult> {
			const user = userMessage(req);
			let res: Anthropic.Beta.BetaMessage;
			try {
				res = await client.beta.messages.create({
					model: req.model,
					max_tokens: req.maxTokens ?? 16000,
					// A false-positive safety decline is retried on another model in the same call;
					// models without fallbacks just run alone.
					betas: ['server-side-fallback-2026-07-01'],
					fallbacks: 'default',
					// Tools and system text are fixed, so they're cached across calls.
					cache_control: { type: 'ephemeral' },
					system: req.system,
					tools: req.tools.map(toClaudeTool),
					messages: [...(req.history as MessageParam[]), user]
				});
			} catch (e) {
				throw mapError(e);
			}

			const calls = res.content.flatMap((b) =>
				b.type === 'tool_use'
					? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }]
					: []
			);
			const text = res.content
				.flatMap((b) => (b.type === 'text' ? [b.text] : []))
				.join('\n')
				.trim();
			const stop =
				res.stop_reason === 'refusal'
					? 'refusal'
					: res.stop_reason === 'max_tokens'
						? 'max_tokens'
						: calls.length > 0
							? 'tool_use'
							: 'done';
			return {
				text,
				calls,
				stop,
				usage: {
					input: res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0),
					output: res.usage.output_tokens,
					cacheRead: res.usage.cache_read_input_tokens ?? 0
				},
				model: res.model,
				// The whole reply goes back unchanged — thinking and fallback blocks included.
				messages: [user, { role: 'assistant', content: res.content }]
			};
		},

		async listModels(): Promise<ModelInfo[]> {
			try {
				const out: ModelInfo[] = [];
				for await (const m of client.models.list({ limit: 100 }))
					out.push({ id: m.id, label: m.display_name });
				return out;
			} catch (e) {
				throw mapError(e);
			}
		},

		pickDefaults: (models) => ({
			chat: pick(models, defaults.chat, /^claude-opus/),
			background: pick(models, defaults.background, /^claude-haiku/)
		})
	};
}
