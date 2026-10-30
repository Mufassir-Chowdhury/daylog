/**
 * The assistant's view of an AI provider. Claude and Gemini each get an adapter
 * (`providers/`) that turns these shapes into their own API calls, so the rest
 * of the assistant never sees a provider format.
 */

export type ProviderId = 'anthropic' | 'gemini';

export const PROVIDERS: { id: ProviderId; label: string; keyHint: string; keyUrl: string }[] = [
	{
		id: 'anthropic',
		label: 'Claude (Anthropic)',
		keyHint: 'sk-ant-…',
		keyUrl: 'https://platform.claude.com/settings/keys'
	},
	{
		id: 'gemini',
		label: 'Gemini (Google)',
		keyHint: 'AIza…',
		keyUrl: 'https://aistudio.google.com/apikey'
	}
];

/** Which job a call is for: talking with you, or working on its own in the background. */
export type ModelSlot = 'chat' | 'background';

/**
 * A JSON Schema both providers accept: objects, strings, numbers, integers,
 * booleans, arrays and enums. Optional values are `type: [x, 'null']` and
 * still listed in `required`; no `oneOf`, `$ref` or `additionalProperties`
 * (the adapters add what each provider needs).
 */
export interface Schema {
	type: string | string[];
	description?: string;
	enum?: (string | number)[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
}

export interface ToolDef {
	name: string;
	description: string;
	parameters: Schema & { type: 'object' };
}

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResult {
	callId: string;
	name: string;
	content: string;
	isError?: boolean;
}

/** What goes into the conversation next: your words, or the answers to its tool calls. */
export type Turn = { kind: 'user'; text: string } | { kind: 'tool_results'; results: ToolResult[] };

export interface SendRequest {
	model: string;
	system: string;
	tools: ToolDef[];
	/**
	 * Earlier messages in the provider's own format, exactly as returned in
	 * `RunResult.messages`. Never edited: both providers need their reasoning
	 * data sent back unchanged.
	 */
	history: unknown[];
	turn: Turn;
	maxTokens?: number;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
}

export interface RunResult {
	text: string;
	calls: ToolCall[];
	/** `tool_use`: run `calls` and send their results; `refusal`: the provider declined. */
	stop: 'done' | 'tool_use' | 'max_tokens' | 'refusal';
	usage: Usage;
	/** Model that actually answered (it can differ after a refusal fallback). */
	model: string;
	/** The user turn and the reply, in the provider's format — append both to the history. */
	messages: unknown[];
}

export interface ModelInfo {
	id: string;
	label: string;
}

export interface Adapter {
	id: ProviderId;
	/** Used until the models list has been fetched with your key. */
	defaults: Record<ModelSlot, string>;
	send(req: SendRequest): Promise<RunResult>;
	listModels(): Promise<ModelInfo[]>;
	/** The best chat and background picks from a models list. */
	pickDefaults(models: ModelInfo[]): Record<ModelSlot, string>;
}

export type AiErrorKind = 'no_key' | 'auth' | 'rate_limit' | 'bad_request' | 'server' | 'network';

export class AiError extends Error {
	constructor(
		readonly kind: AiErrorKind,
		message: string
	) {
		super(message);
		this.name = 'AiError';
	}
}

/** Plain-language message for an HTTP status from a provider. */
export function errorForStatus(status: number, detail: string): AiError {
	if (status === 401 || status === 403)
		return new AiError('auth', 'The API key was rejected — check it in Settings.');
	if (status === 429)
		return new AiError('rate_limit', 'Rate limited or out of credit — try again later.');
	if (status >= 500) return new AiError('server', `The provider had a problem (${status}).`);
	return new AiError('bad_request', detail || `Request failed (${status}).`);
}
