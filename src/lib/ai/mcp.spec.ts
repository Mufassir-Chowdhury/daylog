import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type AssistantConfig } from './config';
import { handleMcp, MCP_INSTRUCTIONS, PROTOCOL_VERSIONS, type McpDeps } from './mcp';
import { toolsFor, type Tool } from './tools/registry';

const readDay: Tool = {
	def: {
		name: 'read_day',
		description: 'Reads a day.',
		parameters: {
			type: 'object',
			properties: { date: { type: 'string', description: 'Day' } },
			required: ['date']
		}
	},
	area: 'days',
	kind: 'read',
	describe: () => 'Reading',
	run: async (ctx, input) => ({ date: input.date, today: ctx.today, text: 'Lab at 10' })
};

const addTask: Tool = {
	def: {
		name: 'add_task',
		description: 'Adds a task.',
		parameters: {
			type: 'object',
			properties: { title: { type: 'string', description: 'Title' } },
			required: ['title']
		}
	},
	area: 'schedule',
	kind: 'write',
	small: true,
	label: 'Add tasks',
	describe: () => 'Adding',
	plan: async (_ctx, input) => ({
		summary: `Add “${input.title}”`,
		changes: [{ kind: 'task', id: 't1', before: null, after: { id: 't1' } } as never]
	})
};

const openPage: Tool = {
	def: {
		name: 'open_page',
		description: 'Opens a page.',
		parameters: { type: 'object', properties: {}, required: [] }
	},
	area: 'ui',
	kind: 'ui',
	describe: () => 'Opening',
	run: async () => 'opened'
};

function deps(over: Partial<McpDeps> = {}, config: AssistantConfig = DEFAULT_CONFIG): McpDeps {
	return {
		uid: 'u1',
		displayName: 'Mufassir Chowdhury',
		loadConfig: async () => structuredClone(config),
		loadMemory: async () => [
			{ id: 'm1', text: 'Prefers grading on Saturdays', kind: 'preference', updatedAt: 1 }
		],
		tools: (c) => toolsFor(c, [readDay, addTask, openPage]).filter((t) => t.kind !== 'ui'),
		propose: vi.fn(async (_c, p) => `Done: ${p.summary}.`),
		now: () => new Date(2026, 9, 31, 9, 5),
		...over
	};
}

const call = (id: number, method: string, params?: Record<string, unknown>) => ({
	jsonrpc: '2.0',
	id,
	method,
	...(params ? { params } : {})
});

describe('handleMcp', () => {
	it('initializes with the asked-for version when it knows it', async () => {
		const res = (await handleMcp(
			call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} }),
			deps()
		)) as { result: Record<string, unknown> };
		expect(res.result.protocolVersion).toBe('2025-06-18');
		expect(res.result.capabilities).toEqual({ tools: { listChanged: false } });
		expect(res.result.instructions).toBe(MCP_INSTRUCTIONS);
		expect((res.result.serverInfo as { name: string }).name).toBe('daylog');
	});

	it('offers its newest version for an unknown one', async () => {
		const res = (await handleMcp(
			call(1, 'initialize', { protocolVersion: '1999-01-01' }),
			deps()
		)) as { result: { protocolVersion: string } };
		expect(res.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
	});

	it('owes nothing for notifications and responses', async () => {
		expect(
			await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps())
		).toBeNull();
		expect(await handleMcp({ jsonrpc: '2.0', id: 4, result: {} }, deps())).toBeNull();
	});

	it('answers ping and refuses unknown methods', async () => {
		expect(await handleMcp(call(2, 'ping'), deps())).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
		const res = (await handleMcp(call(3, 'resources/list'), deps())) as {
			error: { code: number };
		};
		expect(res.error.code).toBe(-32601);
	});

	it('lists the context tool and the app tools, without ui tools', async () => {
		const res = (await handleMcp(call(5, 'tools/list'), deps())) as {
			result: { tools: { name: string; inputSchema: unknown; annotations: unknown }[] };
		};
		const names = res.result.tools.map((t) => t.name);
		expect(names).toEqual(['daylog_context', 'read_day', 'add_task']);
		const read = res.result.tools[1];
		expect(read.inputSchema).toEqual(readDay.def.parameters);
		expect(read.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
		expect(res.result.tools[2]).toMatchObject({
			title: 'Add tasks',
			annotations: { readOnlyHint: false }
		});
	});

	it('leaves out areas switched off in Settings, and says why when called', async () => {
		const off = { ...DEFAULT_CONFIG, areas: { ...DEFAULT_CONFIG.areas, schedule: false } };
		const list = (await handleMcp(call(6, 'tools/list'), deps({}, off))) as {
			result: { tools: { name: string }[] };
		};
		expect(list.result.tools.map((t) => t.name)).not.toContain('add_task');
		const res = (await handleMcp(
			call(7, 'tools/call', { name: 'add_task', arguments: { title: 'Grade' } }),
			deps({}, off)
		)) as { result: { isError: boolean; content: { text: string }[] } };
		expect(res.result.isError).toBe(true);
		expect(res.result.content[0].text).toMatch(/switched off/);
	});

	it('runs a read tool with today from the computer clock', async () => {
		const res = (await handleMcp(
			call(8, 'tools/call', { name: 'read_day', arguments: { date: '2026-10-30' } }),
			deps()
		)) as { result: { isError: boolean; content: { type: string; text: string }[] } };
		expect(res.result.isError).toBe(false);
		expect(JSON.parse(res.result.content[0].text)).toEqual({
			date: '2026-10-30',
			today: '2026-10-31',
			text: 'Lab at 10'
		});
	});

	it('reports invalid input as a tool error Claude can fix', async () => {
		const res = (await handleMcp(
			call(9, 'tools/call', { name: 'read_day', arguments: {} }),
			deps()
		)) as { result: { isError: boolean; content: { text: string }[] } };
		expect(res.result.isError).toBe(true);
		expect(res.result.content[0].text).toMatch(/date is missing/);
	});

	it('hands write tools to propose with the loaded config', async () => {
		const d = deps();
		const res = (await handleMcp(
			call(10, 'tools/call', { name: 'add_task', arguments: { title: 'Grade DM' } }),
			d
		)) as { result: { content: { text: string }[] } };
		expect(res.result.content[0].text).toBe('Done: Add “Grade DM”.');
		expect(d.propose).toHaveBeenCalledWith(
			expect.objectContaining({ name: DEFAULT_CONFIG.name }),
			expect.objectContaining({ summary: 'Add “Grade DM”', tool: addTask })
		);
	});

	it('refuses an unknown tool as a protocol error', async () => {
		const res = (await handleMcp(
			call(11, 'tools/call', { name: 'delete_everything', arguments: {} }),
			deps()
		)) as { error: { code: number } };
		expect(res.error.code).toBe(-32602);
	});

	it('gives the date, form of address and memory from daylog_context', async () => {
		const res = (await handleMcp(
			call(12, 'tools/call', { name: 'daylog_context', arguments: {} }),
			deps()
		)) as { result: { content: { text: string }[] } };
		const text = res.result.content[0].text;
		expect(text).toMatch(/Saturday,? 31 October 2026/);
		expect(text).toContain('today is 2026-10-31');
		expect(text).toContain('Address the owner as: Mufassir');
		expect(text).toContain('Prefers grading on Saturdays');
	});

	it('answers a batch, skipping notifications', async () => {
		const res = await handleMcp(
			[{ jsonrpc: '2.0', method: 'notifications/initialized' }, call(13, 'ping')],
			deps()
		);
		expect(res).toEqual([{ jsonrpc: '2.0', id: 13, result: {} }]);
	});

	it('turns a failing load into an internal error', async () => {
		const res = (await handleMcp(
			call(14, 'tools/list'),
			deps({
				loadConfig: async () => {
					throw new Error('offline');
				}
			})
		)) as { error: { code: number; message: string } };
		expect(res.error).toEqual({ code: -32603, message: 'offline' });
	});
});
