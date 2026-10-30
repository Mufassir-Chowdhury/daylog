import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../types';
import { geminiAdapter, toGeminiSchema } from './gemini';

const addTask: ToolDef = {
	name: 'add_task',
	description: 'Add a task to the plan.',
	parameters: {
		type: 'object',
		properties: {
			text: { type: 'string' },
			date: { type: ['string', 'null'] },
			tags: { type: 'array', items: { type: 'string' } }
		},
		required: ['text', 'date', 'tags']
	}
};

function fake(body: unknown, status = 200) {
	const seen: { url: string; json: Record<string, unknown> }[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		seen.push({ url: String(input), json: init?.body ? JSON.parse(String(init.body)) : {} });
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
	return { fetchImpl, seen };
}

const send = (
	fetchImpl: typeof fetch,
	turn: Parameters<ReturnType<typeof geminiAdapter>['send']>[0]['turn']
) =>
	geminiAdapter(fetchImpl).send({
		model: 'gemini-3.5-flash',
		system: 'You are Jarvis.',
		tools: [addTask],
		history: [],
		turn
	});

describe('toGeminiSchema', () => {
	it('uses one type per value and nullable', () => {
		expect(toGeminiSchema(addTask.parameters)).toEqual({
			type: 'object',
			properties: {
				text: { type: 'string' },
				date: { type: 'string', nullable: true },
				tags: { type: 'array', items: { type: 'string' } }
			},
			required: ['text', 'date', 'tags']
		});
	});
});

describe('geminiAdapter.send', () => {
	const reply = {
		candidates: [
			{
				content: {
					role: 'model',
					parts: [
						{ text: 'thinking about it', thought: true },
						{ text: 'On it.' },
						{
							functionCall: { name: 'add_task', args: { text: 'Grade DM', date: null, tags: [] } },
							thoughtSignature: 'abc'
						}
					]
				},
				finishReason: 'STOP'
			}
		],
		usageMetadata: {
			promptTokenCount: 500,
			candidatesTokenCount: 30,
			thoughtsTokenCount: 20,
			cachedContentTokenCount: 100
		},
		modelVersion: 'gemini-3.5-flash'
	};

	it('sends system text and tools, and reads text, calls and usage', async () => {
		const { fetchImpl, seen } = fake(reply);
		const result = await send(fetchImpl, { kind: 'user', text: 'add grading' });

		expect(seen[0].url).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'
		);
		expect(seen[0].json).toMatchObject({
			systemInstruction: { parts: [{ text: 'You are Jarvis.' }] },
			contents: [{ role: 'user', parts: [{ text: 'add grading' }] }],
			tools: [{ functionDeclarations: [{ name: 'add_task' }] }]
		});
		expect(result).toMatchObject({
			text: 'On it.',
			calls: [{ id: 'local:2', name: 'add_task', input: { text: 'Grade DM' } }],
			stop: 'tool_use',
			usage: { input: 400, output: 50, cacheRead: 100 }
		});
		// The reply is kept as returned, thought signature included.
		expect(result.messages[1]).toEqual(reply.candidates[0].content);
	});

	it('sends tool results back without made-up ids', async () => {
		const { fetchImpl, seen } = fake({
			candidates: [{ content: { role: 'model', parts: [{ text: 'Done.' }] }, finishReason: 'STOP' }]
		});
		const result = await send(fetchImpl, {
			kind: 'tool_results',
			results: [
				{ callId: 'local:2', name: 'add_task', content: 'added' },
				{ callId: 'fc_9', name: 'add_task', content: 'bad date', isError: true }
			]
		});
		expect((seen[0].json.contents as unknown[]).at(-1)).toEqual({
			role: 'user',
			parts: [
				{ functionResponse: { name: 'add_task', response: { result: 'added' } } },
				{ functionResponse: { id: 'fc_9', name: 'add_task', response: { error: 'bad date' } } }
			]
		});
		expect(result).toMatchObject({ text: 'Done.', stop: 'done' });
	});

	it('reports blocked prompts and safety stops as refusals', async () => {
		expect(
			(
				await send(fake({ promptFeedback: { blockReason: 'SAFETY' } }).fetchImpl, {
					kind: 'user',
					text: 'x'
				})
			).stop
		).toBe('refusal');
		const blocked = {
			candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'SAFETY' }]
		};
		expect((await send(fake(blocked).fetchImpl, { kind: 'user', text: 'x' })).stop).toBe('refusal');
	});

	it('maps HTTP errors', async () => {
		const bad = fake({ error: { message: 'API key not valid' } }, 403).fetchImpl;
		await expect(send(bad, { kind: 'user', text: 'x' })).rejects.toMatchObject({ kind: 'auth' });
		const odd = fake({ error: { message: 'Invalid JSON payload' } }, 400).fetchImpl;
		await expect(send(odd, { kind: 'user', text: 'x' })).rejects.toMatchObject({
			kind: 'bad_request',
			message: 'Invalid JSON payload'
		});
	});
});

describe('geminiAdapter models', () => {
	it('lists text models across pages and picks the newest pro and flash', async () => {
		const pages = [
			{
				models: [
					{
						name: 'models/gemini-3.1-pro-preview',
						displayName: 'Gemini 3.1 Pro',
						supportedGenerationMethods: ['generateContent']
					},
					{
						name: 'models/gemini-3.5-flash',
						displayName: 'Gemini 3.5 Flash',
						supportedGenerationMethods: ['generateContent']
					},
					{ name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
				],
				nextPageToken: 'p2'
			},
			{
				models: [
					{
						name: 'models/gemini-3.7-flash',
						displayName: 'Gemini 3.7 Flash',
						supportedGenerationMethods: ['generateContent']
					},
					{ name: 'models/gemini-3.7-flash-lite', supportedGenerationMethods: ['generateContent'] }
				]
			}
		];
		let call = 0;
		const urls: string[] = [];
		const fetchImpl = (async (input: RequestInfo | URL) => {
			urls.push(String(input));
			return new Response(JSON.stringify(pages[call++]));
		}) as typeof fetch;
		const adapter = geminiAdapter(fetchImpl);
		const models = await adapter.listModels();
		expect(urls[1]).toContain('pageToken=p2');
		expect(models.map((m) => m.id)).toEqual([
			'gemini-3.1-pro-preview',
			'gemini-3.5-flash',
			'gemini-3.7-flash',
			'gemini-3.7-flash-lite'
		]);
		// The defaults win while they're offered…
		expect(adapter.pickDefaults(models)).toEqual({
			chat: 'gemini-3.1-pro-preview',
			background: 'gemini-3.5-flash'
		});
		// …otherwise the newest of the family.
		expect(adapter.pickDefaults(models.filter((m) => m.id !== 'gemini-3.5-flash')).background).toBe(
			'gemini-3.7-flash'
		);
	});
});
