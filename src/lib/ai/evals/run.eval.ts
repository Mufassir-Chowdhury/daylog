/**
 * `npm run eval:ai` — runs the eval cases against a real provider and the
 * sample week, and writes a report to read (.eval-out/). Never part of
 * `npm test`: every run costs money. Changes are recorded, never applied.
 *
 *   ANTHROPIC_API_KEY=… npm run eval:ai
 *   EVAL_PROVIDER=gemini GEMINI_API_KEY=… npm run eval:ai
 *   EVAL_ONLY=1,7,22 EVAL_MODEL=claude-sonnet-5-5 npm run eval:ai
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAgent } from '../agent';
import { runCheckin } from '../checkin';
import { DEFAULT_CONFIG, DEFAULT_CHECKINS, permissionFor, WEEKLY_REVIEW } from '../config';
import { DEFAULT_DEVICE_PREFS, saveDevicePrefs } from '../device';
import { loadAdapter } from '../index';
import { memoryBlock } from '../memory';
import { contextBlock } from '../prompt';
import { ALL_TOOLS } from '../tools';
import type { Proposal } from '../tools/registry';
import { saveKey } from '../transport';
import type { Adapter, ProviderId, ToolCall } from '../types';
import { CHAT_CASES, CHECKIN_CASES } from './cases';
import { memory, NOW, TODAY } from './fixture';

vi.mock('../../db', async () => (await import('./fixture')).db);
// Check-ins leave cards and a review note; record them instead.
const left = vi.hoisted(() => ({
	cards: [] as { title: string; tool: string; kind: string; body: string }[]
}));
vi.mock('../inbox.svelte', () => ({
	putItem: (_uid: string, item: { title: string; tool: string; kind: string; body: string }) =>
		left.cards.push(item),
	inbox: { items: [] }
}));
vi.mock('../../ops/commit', () => ({ commit: async () => {} }));

const provider = (process.env.EVAL_PROVIDER ?? 'anthropic') as ProviderId;
const key = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
const only = (process.env.EVAL_ONLY ?? '')
	.split(',')
	.map((s) => Number(s.trim()))
	.filter(Boolean);
const picked = <T extends { id: number }>(cases: T[]) =>
	only.length ? cases.filter((c) => only.includes(c.id)) : cases;

const report: string[] = [];
let adapter: Adapter;
const model = process.env.EVAL_MODEL ?? DEFAULT_DEVICE_PREFS.models[provider].chat;
const backgroundModel =
	process.env.EVAL_BACKGROUND_MODEL ?? DEFAULT_DEVICE_PREFS.models[provider].background;

/** The adapter, recording every tool call the model makes. */
function recording(calls: ToolCall[]): Adapter {
	return {
		...adapter,
		send: async (req) => {
			const res = await adapter.send(req);
			calls.push(...res.calls);
			return res;
		}
	};
}

const show = (call: ToolCall) => `${call.name}(${JSON.stringify(call.input)})`;

/** Runs a case; a failure (a rejected key, a rate limit) still goes in the report. */
async function noted(title: string, run: () => Promise<void>): Promise<void> {
	try {
		await run();
	} catch (e) {
		report.push(`## ✗ ${title}`, '', `Failed: ${e instanceof Error ? e.message : String(e)}`, '');
		throw e;
	}
}

describe.skipIf(!key)(`assistant evals on ${provider}`, () => {
	beforeAll(async () => {
		await saveKey(provider, key!);
		saveDevicePrefs({
			...DEFAULT_DEVICE_PREFS,
			provider,
			models: {
				...DEFAULT_DEVICE_PREFS.models,
				[provider]: { chat: model, background: backgroundModel }
			},
			dailyTokens: { chat: 1e9, background: 1e9 }
		});
		adapter = await loadAdapter(provider);
		report.push(
			`# Assistant evals — ${provider}`,
			'',
			`Chat model ${model}, background model ${backgroundModel}. Sample week: Thu ${TODAY}, 10:00.`,
			''
		);
	});

	afterAll(() => {
		if (!report.length) return;
		mkdirSync('.eval-out', { recursive: true });
		const path = `.eval-out/report-${provider}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
		writeFileSync(path, report.join('\n'));
		console.log(`\nReport: ${path}`);
	});

	for (const c of picked(CHAT_CASES))
		it(`#${c.id} ${c.say}`, { timeout: 180_000 }, () =>
			noted(`#${c.id} — “${c.say}”`, async () => {
				const calls: ToolCall[] = [];
				const proposals: { tool: string; summary: string; applied: boolean }[] = [];
				const result = await runAgent({
					adapter: recording(calls),
					model,
					slot: 'chat',
					kind: 'chat',
					prefs: { ...DEFAULT_DEVICE_PREFS, dailyTokens: { chat: 1e9, background: 1e9 } },
					tools: ALL_TOOLS,
					ctx: {
						uid: 'eval',
						today: TODAY,
						cache: new Map(),
						navigate: () => {},
						propose: async ({ tool, summary }: Proposal) => {
							const applied = permissionFor(DEFAULT_CONFIG, tool.def.name, !!tool.small) === 'auto';
							proposals.push({ tool: tool.def.name, summary, applied });
							return applied
								? `Done: ${summary}. It's applied; the owner can undo it.`
								: `Not applied yet: “${summary}” is shown to the owner as a card to apply or dismiss.`;
						}
					},
					history: [],
					message: [
						contextBlock({
							now: NOW,
							config: DEFAULT_CONFIG,
							address: 'Mufassir',
							view: `Day page for ${TODAY} (/day/${TODAY})`
						}),
						memoryBlock(memory),
						c.say
					].join('\n\n')
				});

				const names = calls.map((x) => x.name);
				const missing = [
					...(c.all ?? []).filter((t) => !names.includes(t)),
					...(c.any && !c.any.some((t) => names.includes(t)) ? [`one of ${c.any.join(' / ')}`] : [])
				];
				const unwanted = c.noChanges ? proposals.map((p) => p.tool) : [];
				const ok = !missing.length && !unwanted.length;
				report.push(
					`## ${ok ? '✓' : '✗'} #${c.id} — “${c.say}”`,
					'',
					`Good: ${c.good}`,
					'',
					'Tool calls:',
					...(calls.length ? calls.map((x) => `- \`${show(x)}\``) : ['- (none)']),
					'',
					...(proposals.length
						? [
								'Changes:',
								...proposals.map((p) => `- ${p.applied ? 'applied' : 'card'}: ${p.summary}`),
								''
							]
						: []),
					`Reply (${result.stop}):`,
					'',
					...result.text.split('\n').map((l) => `> ${l}`),
					'',
					...(missing.length ? [`Missing: ${missing.join(', ')}`, ''] : []),
					...(unwanted.length
						? [`Should not have changed anything: ${unwanted.join(', ')}`, '']
						: [])
				);
				expect.soft(missing, 'tools it should have called').toEqual([]);
				expect.soft(unwanted, 'changes it should not have planned').toEqual([]);
			})
		);

	for (const c of picked(CHECKIN_CASES))
		it(`#${c.id} check-in: ${c.kind}`, { timeout: 300_000 }, () =>
			noted(`#${c.id} — ${c.kind} check-in`, async () => {
				left.cards = [];
				const checkin =
					c.kind === 'review' ? WEEKLY_REVIEW : DEFAULT_CHECKINS.find((x) => x.kind === c.kind)!;
				const { brief, proposals } = await runCheckin('eval', checkin, 'Mufassir Chowdhury', NOW);
				const tools = proposals.map((p) => p.tool);
				const missing = c.proposes.filter((t) => !tools.includes(t));
				report.push(
					`## ${brief && !missing.length ? '✓' : '✗'} #${c.id} — ${checkin.label}`,
					'',
					`Good: ${c.good}`,
					'',
					...(proposals.length
						? ['Cards:', ...proposals.map((p) => `- ${p.tool}: ${p.title}`), '']
						: ['Cards: (none)', '']),
					'Brief:',
					'',
					...(brief?.body ?? '(none)').split('\n').map((l) => `> ${l}`),
					'',
					...(missing.length ? [`Missing cards: ${missing.join(', ')}`, ''] : [])
				);
				expect.soft(brief, 'a brief').not.toBeNull();
				expect.soft(missing, 'cards it should have left').toEqual([]);
			})
		);
});

describe.runIf(!key)('assistant evals', () => {
	it('needs a key', () => {
		console.log(
			`\nNo key for ${provider}. Set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'} (and EVAL_PROVIDER=gemini for Gemini).\n`
		);
		expect(key).toBeUndefined();
	});
});
