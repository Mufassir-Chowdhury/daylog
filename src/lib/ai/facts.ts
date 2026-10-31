/**
 * What a check-in starts with: the read tools it would call anyway, run up
 * front, so the model begins with complete data instead of spending tool
 * rounds (and getting things wrong) finding it. Each kind of check-in has its
 * own set (docs/assistant/decisions.md → "What each check-in covers").
 * Tools of areas hidden in Settings are left out, as they would be for the model.
 */
import { addDays } from '../date';
import type { CheckinKind } from './config';
import { runTool, type Tool, type ToolContext } from './tools/registry';

export interface FactSource {
	/** What it is, for the model: "Today and the week ahead". */
	label: string;
	tool: string;
	input: Record<string, unknown>;
}

/** The facts each kind of check-in needs. */
export function checkinFacts(kind: CheckinKind, today: string): FactSource[] {
	const yesterday = addDays(today, -1);
	const tomorrow = addDays(today, 1);
	switch (kind) {
		case 'warmup':
			return [
				{
					label: 'Today and the week ahead (classes, rooms, tasks, deadlines)',
					tool: 'schedule_snapshot',
					input: { from: today, to: addDays(today, 7) }
				},
				{ label: "Today's page so far", tool: 'read_day', input: { date: today } },
				{
					label: 'Left open yesterday',
					tool: 'open_lines',
					input: { before: today, days: 1 }
				},
				{
					label: "Yesterday's computer time (for the best focus hours)",
					tool: 'activity_day',
					input: { date: yesterday }
				}
			];
		case 'brief':
			return [
				{
					label: 'Today and tomorrow',
					tool: 'schedule_snapshot',
					input: { from: today, to: tomorrow }
				},
				{ label: "Today's page", tool: 'read_day', input: { date: today } },
				{ label: 'Money this month', tool: 'finance_summary', input: { month: null } }
			];
		case 'wrapup':
			return [
				{ label: "Today's page", tool: 'read_day', input: { date: today } },
				{
					label: 'Today and tomorrow',
					tool: 'schedule_snapshot',
					input: { from: today, to: tomorrow }
				},
				{ label: 'Routines today', tool: 'routine_stats', input: { date: today } },
				{
					label: 'Money recorded today',
					tool: 'find_transactions',
					input: {
						query: null,
						from: today,
						to: today,
						kind: null,
						person: null,
						limit: 50
					}
				}
			];
	}
}

/**
 * Runs the sources with the tools this run may use and returns the `<facts>`
 * block. Sources whose tool isn't available (a hidden area) are skipped; a
 * failed one says so, so the model can look it up itself.
 */
export async function gatherFacts(
	ctx: ToolContext,
	tools: Tool[],
	sources: FactSource[]
): Promise<string> {
	const usable = sources.filter((s) =>
		tools.some((t) => t.def.name === s.tool && t.kind === 'read')
	);
	if (!usable.length) return '';
	const results = await Promise.all(
		usable.map((s, i) => runTool(tools, ctx, { id: `facts-${i}`, name: s.tool, input: s.input }))
	);
	const parts = usable.map((s, i) => {
		const r = results[i];
		const body = r.isError
			? `(couldn't load: ${r.content} — look it up with ${s.tool})`
			: r.content;
		return `## ${s.label} — ${s.tool}(${JSON.stringify(s.input)})\n${body}`;
	});
	return `<facts>\nLooked up just now; use these rather than calling the same tools again.\n\n${parts.join('\n\n')}\n</facts>`;
}
