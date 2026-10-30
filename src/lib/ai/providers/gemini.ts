/**
 * Gemini through its REST API (`generateContent` with function calling).
 * The key is added by the transport, like for Claude.
 */
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
	type ToolCall
} from '../types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface Part {
	text?: string;
	/** A summary of the model's reasoning — not part of the answer. */
	thought?: boolean;
	thoughtSignature?: string;
	functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
	functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

interface Content {
	role: 'user' | 'model';
	parts: Part[];
}

interface GenerateResponse {
	candidates?: { content?: Content; finishReason?: string }[];
	promptFeedback?: { blockReason?: string };
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		thoughtsTokenCount?: number;
		cachedContentTokenCount?: number;
	};
	modelVersion?: string;
}

const BLOCKED = new Set([
	'SAFETY',
	'PROHIBITED_CONTENT',
	'BLOCKLIST',
	'SPII',
	'RECITATION',
	'IMAGE_SAFETY'
]);

/** Calls without an id from Gemini get one made up here; it's never sent back. */
const LOCAL_ID = 'local:';

/** Gemini's schema dialect: one type per value, `nullable` instead of a null type. */
export function toGeminiSchema(s: Schema): Record<string, unknown> {
	const types = Array.isArray(s.type) ? s.type : [s.type];
	const out: Record<string, unknown> = { type: types.find((t) => t !== 'null') ?? 'string' };
	if (types.includes('null')) out.nullable = true;
	if (s.description) out.description = s.description;
	if (s.enum) out.enum = s.enum.map(String);
	if (s.properties) {
		out.properties = Object.fromEntries(
			Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)])
		);
		out.required = s.required ?? Object.keys(s.properties);
	}
	if (s.items) out.items = toGeminiSchema(s.items);
	return out;
}

function userContent(req: SendRequest): Content {
	if (req.turn.kind === 'user') return { role: 'user', parts: [{ text: req.turn.text }] };
	return {
		role: 'user',
		parts: req.turn.results.map((r) => ({
			functionResponse: {
				...(r.callId.startsWith(LOCAL_ID) ? {} : { id: r.callId }),
				name: r.name,
				response: r.isError ? { error: r.content } : { result: r.content }
			}
		}))
	};
}

async function failure(res: Response): Promise<AiError> {
	let detail = '';
	try {
		detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
	} catch {
		// Not JSON — the status says enough.
	}
	return errorForStatus(res.status, detail);
}

/** Version number in a model id: `gemini-3.5-flash` → 3.5. */
const version = (id: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);

/** The default if it's offered, else the newest model matching `family`, else the first. */
function pick(models: ModelInfo[], preferred: string, family: RegExp): string {
	if (models.some((m) => m.id === preferred)) return preferred;
	const matches = models.filter((m) => family.test(m.id));
	matches.sort((a, b) => version(b.id) - version(a.id));
	return matches[0]?.id ?? models[0]?.id ?? preferred;
}

export function geminiAdapter(fetchImpl: typeof fetch = providerFetch('gemini')): Adapter {
	const defaults = DEFAULT_MODELS.gemini;

	async function call(url: string, init?: RequestInit): Promise<Response> {
		let res: Response;
		try {
			res = await fetchImpl(url, init);
		} catch (e) {
			if (e instanceof AiError) throw e;
			throw new AiError('network', 'Could not reach Gemini — check your connection.');
		}
		if (!res.ok) throw await failure(res);
		return res;
	}

	return {
		id: 'gemini',
		defaults,

		async send(req: SendRequest): Promise<RunResult> {
			const user = userContent(req);
			const body = {
				systemInstruction: { parts: [{ text: req.system }] },
				contents: [...(req.history as Content[]), user],
				...(req.tools.length
					? {
							tools: [
								{
									functionDeclarations: req.tools.map((t) => ({
										name: t.name,
										description: t.description,
										parameters: toGeminiSchema(t.parameters)
									}))
								}
							]
						}
					: {}),
				generationConfig: { maxOutputTokens: req.maxTokens ?? 16000 }
			};
			const res = await call(`${BASE}/models/${encodeURIComponent(req.model)}:generateContent`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const data = (await res.json()) as GenerateResponse;

			const candidate = data.candidates?.[0];
			// Kept exactly as returned: thought signatures must go back unchanged.
			const reply: Content | null = candidate?.content
				? { ...candidate.content, role: 'model', parts: candidate.content.parts ?? [] }
				: null;
			const parts = reply?.parts ?? [];
			const calls: ToolCall[] = parts.flatMap((p, i) =>
				p.functionCall
					? [
							{
								id: p.functionCall.id ?? `${LOCAL_ID}${i}`,
								name: p.functionCall.name,
								input: p.functionCall.args ?? {}
							}
						]
					: []
			);
			const text = parts
				.flatMap((p) => (p.text && !p.thought ? [p.text] : []))
				.join('')
				.trim();
			const finish = candidate?.finishReason ?? '';
			const stop =
				data.promptFeedback?.blockReason || BLOCKED.has(finish)
					? 'refusal'
					: finish === 'MAX_TOKENS'
						? 'max_tokens'
						: calls.length > 0
							? 'tool_use'
							: 'done';
			const usage = data.usageMetadata ?? {};
			const cached = usage.cachedContentTokenCount ?? 0;
			return {
				text,
				calls,
				stop,
				usage: {
					input: (usage.promptTokenCount ?? 0) - cached,
					output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
					cacheRead: cached
				},
				model: data.modelVersion ?? req.model,
				messages: reply ? [user, reply] : [user]
			};
		},

		async listModels(): Promise<ModelInfo[]> {
			const out: ModelInfo[] = [];
			let page = '';
			do {
				const res = await call(
					`${BASE}/models?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`
				);
				const data = (await res.json()) as {
					models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
					nextPageToken?: string;
				};
				for (const m of data.models ?? []) {
					const id = m.name.replace(/^models\//, '');
					if (id.startsWith('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
						out.push({ id, label: m.displayName ?? id });
				}
				page = data.nextPageToken ?? '';
			} while (page);
			return out;
		},

		pickDefaults: (models) => ({
			// Plain text models only: not image, audio, live or lite variants.
			chat: pick(models, defaults.chat, /^gemini-[\d.]+-pro(-preview)?$/),
			background: pick(models, defaults.background, /^gemini-[\d.]+-flash(-preview)?$/)
		})
	};
}
