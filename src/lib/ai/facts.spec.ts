import { describe, expect, it, vi } from 'vitest';
import { checkinFacts, gatherFacts } from './facts';
import { params, optStr, type Tool, type ToolContext } from './tools/registry';

const tool = (name: string, run: Tool['run'], kind: Tool['kind'] = 'read'): Tool => ({
	area: 'days',
	kind,
	def: { name, description: name, parameters: params({ date: optStr('Day.') }) },
	describe: () => name,
	run
});
const ctx = (): ToolContext => ({
	uid: 'u',
	today: '2026-10-31',
	cache: new Map(),
	navigate: vi.fn()
});

describe('checkinFacts', () => {
	it('gives each kind of check-in the tools it needs', () => {
		const names = (kind: 'warmup' | 'brief' | 'wrapup') =>
			checkinFacts(kind, '2026-10-31').map((s) => s.tool);
		expect(names('warmup')).toEqual([
			'schedule_snapshot',
			'read_day',
			'open_lines',
			'activity_day'
		]);
		expect(names('brief')).toEqual(['schedule_snapshot', 'read_day', 'finance_summary']);
		expect(names('wrapup')).toEqual([
			'read_day',
			'schedule_snapshot',
			'routine_stats',
			'find_transactions'
		]);
		expect(checkinFacts('warmup', '2026-10-31')[0].input).toEqual({
			from: '2026-10-31',
			to: '2026-11-07'
		});
		expect(checkinFacts('warmup', '2026-10-31')[3].input).toEqual({ date: '2026-10-30' });
	});
});

describe('gatherFacts', () => {
	it('runs the sources, skips tools it may not use and reports failures', async () => {
		const tools = [
			tool('read_day', async (_c, i) => ({ date: i.date, text: 'gym' })),
			tool('routine_stats', async () => {
				throw new Error('offline');
			}),
			tool('append_line', async () => 'x', 'write')
		];
		const block = await gatherFacts(ctx(), tools, [
			{ label: "Today's page", tool: 'read_day', input: { date: '2026-10-31' } },
			{ label: 'Routines', tool: 'routine_stats', input: { date: null } },
			{ label: 'Money', tool: 'finance_summary', input: { month: null } },
			{ label: 'Not a read', tool: 'append_line', input: { date: null } }
		]);
		expect(block).toContain(
			`## Today's page — read_day({"date":"2026-10-31"})\n{"date":"2026-10-31","text":"gym"}`
		);
		expect(block).toContain("(couldn't load: offline — look it up with routine_stats)");
		expect(block).not.toContain('finance_summary');
		expect(block).not.toContain('Not a read');
		expect(block.startsWith('<facts>')).toBe(true);
	});

	it('is empty when none of its tools are available', async () => {
		expect(await gatherFacts(ctx(), [], checkinFacts('brief', '2026-10-31'))).toBe('');
	});
});
