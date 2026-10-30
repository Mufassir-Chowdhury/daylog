import { describe, expect, it, vi } from 'vitest';
import { runAgent } from './agent';
import { recordUsage, spentToday } from './budget';
import { DEFAULT_CONFIG } from './config';
import { DEFAULT_DEVICE_PREFS } from './device';
import { contextBlock, describeView, SYSTEM_PROMPT } from './prompt';
import {
	serializeResult,
	toolsFor,
	validate,
	runTool,
	params,
	optStr,
	str,
	type Tool
} from './tools/registry';
import type { Adapter, RunResult, SendRequest } from './types';

const echo: Tool = {
	area: 'days',
	kind: 'read',
	def: {
		name: 'echo',
		description: 'Echo.',
		parameters: params({ text: str('Text.'), extra: optStr('Optional.') })
	},
	describe: (i) => `Echoing ${i.text}`,
	run: async (_ctx, input) => ({ said: input.text, extra: input.extra })
};

const ctx = () => ({ uid: 'u', today: '2026-10-30', cache: new Map(), navigate: vi.fn() });

const reply = (over: Partial<RunResult>): RunResult => ({
	text: '',
	calls: [],
	stop: 'done',
	usage: { input: 10, output: 5, cacheRead: 0 },
	model: 'm',
	messages: [],
	...over
});

/** An adapter that answers from a script and records what it was sent. */
function scripted(replies: ((req: SendRequest) => RunResult)[]) {
	const sent: SendRequest[] = [];
	const adapter: Adapter = {
		id: 'anthropic',
		defaults: { chat: 'm', background: 'm' },
		listModels: async () => [],
		pickDefaults: () => ({ chat: 'm', background: 'm' }),
		send: async (req) => {
			sent.push(structuredClone(req));
			return replies[sent.length - 1](req);
		}
	};
	return { adapter, sent };
}

const options = (adapter: Adapter, over = {}) => ({
	adapter,
	model: 'm',
	slot: 'chat' as const,
	prefs: DEFAULT_DEVICE_PREFS,
	tools: [echo],
	ctx: ctx(),
	history: ['earlier'],
	message: 'hello',
	...over
});

describe('runAgent', () => {
	it('runs tool calls, feeds results back and keeps the whole exchange', async () => {
		const { adapter, sent } = scripted([
			() =>
				reply({
					stop: 'tool_use',
					calls: [{ id: 'c1', name: 'echo', input: { text: 'hi' } }],
					messages: ['u1', 'a1']
				}),
			() => reply({ text: 'All done.', messages: ['u2', 'a2'] })
		]);
		const steps: string[] = [];
		const result = await runAgent(options(adapter, { onStep: (s: string) => steps.push(s) }));

		expect(sent[0]).toMatchObject({
			system: SYSTEM_PROMPT,
			history: ['earlier'],
			turn: { kind: 'user', text: 'hello' }
		});
		expect(sent[1].turn).toEqual({
			kind: 'tool_results',
			results: [{ callId: 'c1', name: 'echo', content: '{"said":"hi","extra":null}' }]
		});
		expect(result).toMatchObject({
			text: 'All done.',
			stop: 'done',
			steps: ['Echoing hi'],
			history: ['earlier', 'u1', 'a1', 'u2', 'a2'],
			usage: { input: 20, output: 10, cacheRead: 0 }
		});
		expect(steps).toEqual(['Echoing hi']);
	});

	it('drops the exchange when it runs out of steps', async () => {
		const loop = () =>
			reply({
				stop: 'tool_use',
				calls: [{ id: 'c', name: 'echo', input: { text: 'again' } }],
				messages: ['u', 'a']
			});
		const { adapter, sent } = scripted(Array(5).fill(loop));
		const result = await runAgent(options(adapter, { maxSteps: 2 }));
		expect(sent).toHaveLength(3);
		expect(result.stop).toBe('step_limit');
		expect(result.history).toEqual(['earlier']);
	});

	it('stops before calling when the daily budget is used up', async () => {
		recordUsage('chat', { input: 10, output: 0, cacheRead: 0 });
		const { adapter, sent } = scripted([() => reply({ text: 'x' })]);
		const prefs = { ...DEFAULT_DEVICE_PREFS, dailyTokens: { chat: 5, background: 5 } };
		await expect(runAgent(options(adapter, { prefs }))).rejects.toMatchObject({ kind: 'budget' });
		expect(sent).toHaveLength(0);
	});

	it('counts what it spends', async () => {
		const before = spentToday().chat;
		const { adapter } = scripted([() => reply({ text: 'x' })]);
		await runAgent(options(adapter));
		expect(spentToday().chat - before).toBe(15);
	});
});

describe('runTool', () => {
	it('reports unknown tools and bad input instead of throwing', async () => {
		const call = (input: Record<string, unknown>, name = 'echo') =>
			runTool([echo], ctx(), { id: 'c', name, input });
		expect(await call({}, 'nope')).toMatchObject({ isError: true });
		expect((await call({ text: 3 })).content).toBe('Invalid input: input.text should be string.');
		expect((await call({ text: 'x', bogus: 1 })).content).toContain("isn't a known field");
		// Missing nullable fields read as null.
		expect((await call({ text: 'x' })).content).toBe('{"said":"x","extra":null}');
	});

	it('turns a failing tool into an error result', async () => {
		const broken = { ...echo, run: async () => Promise.reject(new Error('No such day.')) };
		expect(await runTool([broken], ctx(), { id: 'c', name: 'echo', input: { text: 'x' } })).toEqual(
			{ callId: 'c', name: 'echo', content: 'No such day.', isError: true }
		);
	});
});

describe('validate', () => {
	const schema = params({
		n: { type: 'integer' },
		kind: { type: ['string', 'null'], enum: ['a', 'b'] },
		tags: { type: 'array', items: { type: 'string' } }
	});
	it('checks types, enums, arrays and required fields', () => {
		expect(validate(schema, { n: 1, kind: 'a', tags: ['x'] })).toBeNull();
		expect(validate(schema, { n: 1, kind: null, tags: [] })).toBeNull();
		expect(validate(schema, { n: 1.5, kind: 'a', tags: [] })).toContain('integer');
		expect(validate(schema, { n: 1, kind: 'c', tags: [] })).toContain('one of a, b');
		expect(validate(schema, { n: 1, kind: 'a', tags: [2] })).toContain('tags[0]');
		expect(validate(schema, { kind: 'a', tags: [] })).toContain('input.n is missing');
	});
});

describe('serializeResult', () => {
	it('cuts very long results with a note', () => {
		const out = serializeResult('x'.repeat(20_000));
		expect(out.length).toBeLessThan(12_100);
		expect(out).toContain('[cut');
	});
});

describe('toolsFor', () => {
	it('leaves out tools of areas switched off', () => {
		const ui = { ...echo, area: 'ui' as const };
		const config = { ...DEFAULT_CONFIG, areas: { ...DEFAULT_CONFIG.areas, days: false } };
		expect(toolsFor(config, [echo, ui])).toEqual([ui]);
	});
});

describe('prompt', () => {
	it('keeps the system prompt free of anything that changes', () => {
		expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
		expect(SYSTEM_PROMPT).not.toContain('Jarvis');
	});

	it('puts the date, name, form of address, page and hidden areas in the context', () => {
		const block = contextBlock({
			now: new Date(2026, 9, 30, 14, 5),
			config: { ...DEFAULT_CONFIG, areas: { ...DEFAULT_CONFIG.areas, finance: false } },
			address: 'Mufassir',
			view: 'Finance page (/finance)'
		});
		expect(block).toMatch(/Now: Friday,? 30 October 2026, 2:05\sPM/);
		expect(block).toContain('Your name: Jarvis');
		expect(block).toContain('Address the owner as: Mufassir');
		expect(block).toContain('Hidden from you: Finance');
	});

	it('describes the page being looked at', () => {
		expect(describeView(new URL('http://x/day/2026-10-30'))).toBe(
			'Day page for 2026-10-30 (/day/2026-10-30)'
		);
		expect(describeView(new URL('http://x/finance?month=2026-10'))).toBe(
			'Finance page (/finance?month=2026-10)'
		);
		expect(describeView(new URL('http://x/people/rahim'))).toBe(
			'Profile of @rahim (/people/rahim)'
		);
	});
});

describe('write tools in runTool', () => {
	const writer: Tool = {
		area: 'days',
		kind: 'write',
		small: true,
		label: 'Write',
		def: { name: 'write', description: 'Write.', parameters: params({ text: str('Text.') }) },
		describe: () => 'Writing',
		plan: async (_ctx, input) => ({
			summary: `Add “${input.text}”`,
			changes:
				input.text === 'same'
					? []
					: [
							{
								kind: 'dayLine',
								id: '2026-10-30',
								before: null,
								after: { date: '2026-10-30', line: String(input.text) }
							}
						]
		})
	};

	it('hands the plan to propose and returns what it says', async () => {
		const propose = vi.fn(async () => 'Done: Add “x”.');
		const result = await runTool(
			[writer],
			{ ...ctx(), propose },
			{
				id: 'c',
				name: 'write',
				input: { text: 'x' }
			}
		);
		expect(result.content).toBe('Done: Add “x”.');
		expect(propose).toHaveBeenCalledWith(
			expect.objectContaining({ tool: writer, summary: 'Add “x”', changes: expect.any(Array) })
		);
	});

	it('says when there is nothing to change', async () => {
		const propose = vi.fn();
		const result = await runTool(
			[writer],
			{ ...ctx(), propose },
			{
				id: 'c',
				name: 'write',
				input: { text: 'same' }
			}
		);
		expect(result.content).toContain('Nothing to change');
		expect(propose).not.toHaveBeenCalled();
	});

	it('refuses to write where changes are not allowed (background runs)', async () => {
		const result = await runTool([writer], ctx(), { id: 'c', name: 'write', input: { text: 'x' } });
		expect(result.isError).toBe(true);
	});
});

describe('permissions', () => {
	it('defaults small additions to auto and the rest to ask, unless set', async () => {
		const { normalizeConfig, permissionFor } = await import('./config');
		const config = normalizeConfig({
			permissions: { add_task: 'ask', move_event: 'auto', 'Bad Name': 'auto', x_y: 'maybe' }
		});
		expect(config.permissions).toEqual({ add_task: 'ask', move_event: 'auto' });
		expect(permissionFor(config, 'add_task', true)).toBe('ask');
		expect(permissionFor(config, 'move_event', false)).toBe('auto');
		expect(permissionFor(config, 'append_line', true)).toBe('auto');
		expect(permissionFor(config, 'add_transaction', false)).toBe('ask');
	});
});
