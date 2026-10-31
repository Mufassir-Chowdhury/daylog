import { describe, expect, it, vi } from 'vitest';
import { checkinFacts, gatherFacts } from '../facts';
import { ALL_TOOLS } from '../tools';
import { runTool, type ToolContext } from '../tools/registry';
import { TODAY } from './fixture';

// The evals' stand-in for db.ts must cover everything the tools read: this
// runs every read tool and every check-in's facts against it, for free.
vi.mock('../../db', async () => (await import('./fixture')).db);

const ctx = (): ToolContext => ({ uid: 'eval', today: TODAY, cache: new Map(), navigate: vi.fn() });

const INPUTS: Record<string, Record<string, unknown>> = {
	read_day: { date: TODAY },
	search_days: { query: '@rahim', from: null, to: null, limit: null },
	open_lines: { before: TODAY, days: 2 },
	schedule_snapshot: { from: null, to: null },
	free_time: { from: '2026-11-01', to: '2026-11-03', min_minutes: null },
	list_people: {},
	get_person: { handle: 'rahim' },
	search_notes: { query: 'thesis' },
	read_note: { id: 'thesis' },
	list_longterm: {},
	routine_stats: { date: null },
	finance_summary: { month: null },
	find_transactions: {
		query: null,
		from: null,
		to: null,
		kind: null,
		person: 'rahim',
		limit: null
	},
	activity_day: { date: null },
	recall: { query: null }
};

describe('the eval fixture', () => {
	it('answers every read tool', async () => {
		const reads = ALL_TOOLS.filter((t) => t.kind === 'read');
		for (const tool of reads) {
			const input = INPUTS[tool.def.name];
			expect(input, `an input for ${tool.def.name}`).toBeDefined();
			const result = await runTool(reads, ctx(), { id: 'x', name: tool.def.name, input: input! });
			expect(result.isError, `${tool.def.name}: ${result.content}`).toBeFalsy();
		}
	});

	it("loads every check-in's facts", async () => {
		for (const kind of ['warmup', 'brief', 'wrapup', 'review'] as const) {
			const block = await gatherFacts(ctx(), ALL_TOOLS, checkinFacts(kind, TODAY));
			expect(block, kind).not.toContain("couldn't load");
		}
	});
});
