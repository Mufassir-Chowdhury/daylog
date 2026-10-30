import { describe, expect, it } from 'vitest';
import { AiError, type ToolDef } from '../types';
import { anthropicAdapter, toClaudeSchema } from './anthropic';

const addTask: ToolDef = {
	name: 'add_task',
	description: 'Add a task to the plan.',
	parameters: {
		type: 'object',
		properties: {
			text: { type: 'string' },
			date: { type: ['string', 'null'], description: 'Day key, or null for Later.' },
			status: { type: ['string', 'null'], enum: ['open', 'done'] }
		},
		required: ['text', 'date', 'status']
	}
};

/** A fetch that records the request and answers with `body`. */
function fake(body: unknown, status = 200) {
	const seen: { url: string; init: RequestInit; json: Record<string, unknown> }[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		seen.push({ url, init: init ?? {}, json: init?.body ? JSON.parse(String(init.body)) : {} });
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json', 'request-id': 'req_1' }
		});
	}) as typeof fetch;
	return { fetchImpl, seen };
}

const reply = {
	id: 'msg_1',
	type: 'message',
	role: 'assistant',
	model: 'claude-opus-5-5',
	content: [
		{ type: 'thinking', thinking: '', signature: 'sig' },
		{ type: 'text', text: 'Adding that now.' },
		{ type: 'tool_use', id: 'toolu_1', name: 'add_task', input: { text: 'Grade DM', date: null } }
	],
	stop_reason: 'tool_use',
	stop_sequence: null,
	usage: {
		input_tokens: 120,
		output_tokens: 40,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 2000
	}
};

describe('toClaudeSchema', () => {
	it('closes objects, requires every property and allows null in nullable enums', () => {
		expect(toClaudeSchema(addTask.parameters)).toEqual({
			type: 'object',
			properties: {
				text: { type: 'string' },
				date: { type: ['string', 'null'], description: 'Day key, or null for Later.' },
				status: { type: ['string', 'null'], enum: ['open', 'done', null] }
			},
			required: ['text', 'date', 'status'],
			additionalProperties: false
		});
	});
});

describe('anthropicAdapter.send', () => {
	it('sends strict tools, cached prefix and refusal fallback, and reads the reply', async () => {
		const { fetchImpl, seen } = fake(reply);
		const result = await anthropicAdapter(fetchImpl).send({
			model: 'claude-opus-5-5',
			system: 'You are Jarvis.',
			tools: [addTask],
			history: [],
			turn: { kind: 'user', text: 'add grading DM to later' }
		});

		const { url, json } = seen[0];
		expect(url).toBe('https://api.anthropic.com/v1/messages');
		expect(json).toMatchObject({
			model: 'claude-opus-5-5',
			fallbacks: 'default',
			cache_control: { type: 'ephemeral' },
			system: 'You are Jarvis.',
			messages: [{ role: 'user', content: 'add grading DM to later' }]
		});
		expect((json.tools as { strict: boolean }[])[0].strict).toBe(true);
		expect(new Headers(seen[0].init.headers).get('anthropic-beta')).toContain(
			'server-side-fallback-2026-07-01'
		);

		expect(result).toMatchObject({
			text: 'Adding that now.',
			calls: [{ id: 'toolu_1', name: 'add_task', input: { text: 'Grade DM', date: null } }],
			stop: 'tool_use',
			usage: { input: 120, output: 40, cacheRead: 2000 },
			model: 'claude-opus-5-5'
		});
		// The reply goes back whole, thinking block included.
		expect(result.messages[1]).toEqual({ role: 'assistant', content: reply.content });
	});

	it('returns all tool results in one user message', async () => {
		const { fetchImpl, seen } = fake({ ...reply, content: [], stop_reason: 'end_turn' });
		const result = await anthropicAdapter(fetchImpl).send({
			model: 'claude-opus-5-5',
			system: 's',
			tools: [],
			history: [{ role: 'user', content: 'hi' }],
			turn: {
				kind: 'tool_results',
				results: [
					{ callId: 'a', name: 'x', content: 'ok' },
					{ callId: 'b', name: 'y', content: 'no such id', isError: true }
				]
			}
		});
		expect((seen[0].json.messages as unknown[]).at(-1)).toEqual({
			role: 'user',
			content: [
				{ type: 'tool_result', tool_use_id: 'a', content: 'ok' },
				{ type: 'tool_result', tool_use_id: 'b', content: 'no such id', is_error: true }
			]
		});
		expect(result.stop).toBe('done');
	});

	it('reports refusals', async () => {
		const { fetchImpl } = fake({ ...reply, content: [], stop_reason: 'refusal' });
		const result = await anthropicAdapter(fetchImpl).send({
			model: 'claude-opus-5-5',
			system: 's',
			tools: [],
			history: [],
			turn: { kind: 'user', text: 'x' }
		});
		expect(result.stop).toBe('refusal');
	});

	it('turns a rejected key into an auth error', async () => {
		const { fetchImpl } = fake(
			{ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
			401
		);
		const send = anthropicAdapter(fetchImpl).send({
			model: 'claude-opus-5-5',
			system: 's',
			tools: [],
			history: [],
			turn: { kind: 'user', text: 'x' }
		});
		await expect(send).rejects.toMatchObject({ kind: 'auth' });
	});

	it('passes a missing key through as no_key', async () => {
		const fetchImpl = (async () => {
			throw new AiError('no_key', 'No key');
		}) as typeof fetch;
		const send = anthropicAdapter(fetchImpl).send({
			model: 'claude-opus-5-5',
			system: 's',
			tools: [],
			history: [],
			turn: { kind: 'user', text: 'x' }
		});
		await expect(send).rejects.toMatchObject({ kind: 'no_key' });
	});
});

describe('anthropicAdapter models', () => {
	it('lists models and prefers the defaults', async () => {
		const { fetchImpl } = fake({
			data: [
				{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '' },
				{ type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '' }
			],
			has_more: false,
			first_id: 'claude-opus-5-5',
			last_id: 'claude-haiku-5-5'
		});
		const adapter = anthropicAdapter(fetchImpl);
		const models = await adapter.listModels();
		expect(models).toEqual([
			{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
			{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
		]);
		expect(adapter.pickDefaults(models)).toEqual({
			chat: 'claude-opus-5-5',
			background: 'claude-haiku-5-5'
		});
		expect(adapter.pickDefaults([{ id: 'claude-opus-6', label: '' }])).toEqual({
			chat: 'claude-opus-6',
			background: 'claude-opus-6'
		});
	});
});
