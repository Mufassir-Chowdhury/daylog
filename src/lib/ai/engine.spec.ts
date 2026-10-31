import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import type { Signal } from './detectors';
import type { InboxItem } from './inbox';

const db = vi.hoisted(() => ({
	loadAssistantConfig: vi.fn(),
	loadDay: vi.fn(async () => ''),
	listDeadlines: vi.fn(async () => []),
	listTasks: vi.fn(async () => []),
	listSlots: vi.fn(async () => []),
	listTransactions: vi.fn(async () => []),
	listEvents: vi.fn(async () => [] as unknown[]),
	listSignalKeys: vi.fn(async () => new Set<string>()),
	claimSignal: vi.fn(async () => true),
	pruneSignals: vi.fn(async () => {}),
	listFollowups: vi.fn(async () => [] as unknown[]),
	claimFollowup: vi.fn(),
	saveFollowup: vi.fn(async () => {}),
	loadFeedback: vi.fn(async () => ({}))
}));
const desktop = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('../desktop', () => ({ desktop }));
const bg = vi.hoisted(() => ({
	backgroundRun: vi.fn(),
	saveBrief: vi.fn((_uid: string, b: Record<string, unknown>) => ({ ...b, kind: 'brief' }))
}));
const inbox = vi.hoisted(() => ({ items: [] as Partial<InboxItem>[] }));
vi.mock('../db', () => db);
vi.mock('./background', () => bg);
vi.mock('./inbox.svelte', () => ({ inbox }));
vi.mock('./checkin', () => ({ runDueCheckins: vi.fn(async () => null) }));
vi.mock('./transport', () => ({ keyStatus: async () => ({ anthropic: true, gemini: false }) }));

const { notifyAbout, resetEngine, runCapture, runDueFollowups, runPrep, runSignals, SCAN_EVERY } =
	await import('./engine');

const NOW = new Date(2026, 9, 31, 11, 0);
const signal = (key: string, over: Partial<Signal> = {}): Signal => ({
	key,
	type: key.split(':')[0],
	title: `About ${key}`,
	about: `Look at ${key}`,
	priority: 1,
	...over
});
const proposal = (title: string) => ({ kind: 'proposal', title }) as InboxItem;

beforeEach(() => {
	resetEngine();
	inbox.items = [];
	db.loadAssistantConfig.mockResolvedValue(structuredClone(DEFAULT_CONFIG));
	db.listSignalKeys.mockResolvedValue(new Set());
	db.claimSignal.mockClear().mockResolvedValue(true);
	db.listFollowups.mockResolvedValue([]);
	db.claimFollowup.mockReset();
	db.saveFollowup.mockClear();
	bg.backgroundRun.mockReset();
	bg.saveBrief.mockClear();
	db.loadFeedback.mockResolvedValue({});
	desktop.notify.mockClear();
});

describe('runSignals', () => {
	it('runs each new signal once and returns its cards', async () => {
		bg.backgroundRun.mockResolvedValue({
			text: 'Proposed two tasks.',
			truncated: false,
			proposals: [proposal('Add “Draft intro”'), proposal('Add “Proofread”')]
		});
		db.listSignalKeys.mockResolvedValue(new Set(['deadline:old']));
		const cards = await runSignals('u1', null, NOW, [
			() => [signal('deadline:old'), signal('deadline:new')]
		]);
		expect(db.claimSignal).toHaveBeenCalledTimes(1);
		expect(db.claimSignal).toHaveBeenCalledWith('u1', 'deadline:new', 'deadline');
		expect(bg.backgroundRun).toHaveBeenCalledWith(
			expect.objectContaining({ signalKey: 'deadline:new', priority: 1 })
		);
		expect(bg.backgroundRun.mock.calls[0][0].message).toContain('Look at deadline:new');
		// Cards speak for themselves: no extra note.
		expect(cards.map((c) => c.title)).toEqual(['Add “Draft intro”', 'Add “Proofread”']);
		expect(bg.saveBrief).not.toHaveBeenCalled();
	});

	it('leaves a note when it proposed nothing but found something, none for NOTHING', async () => {
		bg.backgroundRun
			.mockResolvedValueOnce({
				text: 'Already planned in a note.',
				truncated: false,
				proposals: []
			})
			.mockResolvedValueOnce({ text: 'NOTHING', truncated: false, proposals: [] });
		const cards = await runSignals('u1', null, NOW, [
			() => [signal('a:1', { priority: 2 }), signal('b:1')]
		]);
		expect(cards).toEqual([
			expect.objectContaining({ title: 'About a:1', body: 'Already planned in a note.' })
		]);
	});

	it("hands a signal's facts to its run", async () => {
		bg.backgroundRun.mockResolvedValue({ text: 'NOTHING', truncated: false, proposals: [] });
		const facts = [{ label: 'Free time', tool: 'free_time', input: { from: null } }];
		await runSignals('u1', null, NOW, [() => [signal('deadline:d', { facts })]]);
		expect(bg.backgroundRun.mock.calls[0][0].facts).toBe(facts);
	});

	it('scans at most every 30 minutes and not in quiet hours', async () => {
		bg.backgroundRun.mockResolvedValue({ text: 'NOTHING', truncated: false, proposals: [] });
		const detector = vi.fn(() => [signal('a:1')]);
		await runSignals('u1', null, NOW, [detector]);
		await runSignals('u1', null, new Date(NOW.getTime() + SCAN_EVERY - 1), [detector]);
		expect(detector).toHaveBeenCalledTimes(1);

		resetEngine();
		await runSignals('u1', null, new Date(2026, 9, 31, 3, 0), [detector]);
		expect(detector).toHaveBeenCalledTimes(1);
	});

	it('stops at the daily limit on unprompted cards', async () => {
		const config = structuredClone(DEFAULT_CONFIG);
		config.maxCardsPerDay = 1;
		db.loadAssistantConfig.mockResolvedValue(config);
		bg.backgroundRun.mockResolvedValue({ text: '', truncated: false, proposals: [proposal('x')] });
		await runSignals('u1', null, NOW, [() => [signal('a:1'), signal('b:1')]]);
		expect(bg.backgroundRun).toHaveBeenCalledTimes(1);

		resetEngine();
		inbox.items = [{ source: 'checkin', signalKey: 'deadline:z', createdAt: NOW.getTime() - 1000 }];
		await runSignals('u1', null, NOW, [() => [signal('c:1')]]);
		expect(bg.backgroundRun).toHaveBeenCalledTimes(1);
	});

	it("skips a signal another device took, or one today's cards already cover", async () => {
		db.claimSignal.mockResolvedValueOnce(false);
		inbox.items = [{ tool: 'move_line', createdAt: NOW.getTime() - 3_600_000 }];
		await runSignals('u1', null, NOW, [
			() => [signal('a:1'), signal('carryover:2026-10-30', { coveredBy: 'move_line' })]
		]);
		expect(db.claimSignal).toHaveBeenCalledTimes(2);
		expect(bg.backgroundRun).not.toHaveBeenCalled();
	});
});

describe('runDueFollowups', () => {
	const followup = (over: Record<string, unknown> = {}) => ({
		id: 'f1',
		at: NOW.getTime() - 60_000,
		why: 'See whether the lab was marked done',
		status: 'pending',
		claimedAt: 0,
		...over
	});

	it('runs a due follow-up once and leaves what it found', async () => {
		db.listFollowups.mockResolvedValue([followup()]);
		db.claimFollowup.mockImplementation(async () => followup({ status: 'running' }));
		bg.backgroundRun.mockResolvedValue({
			text: 'The lab is done.',
			truncated: false,
			proposals: []
		});
		const cards = await runDueFollowups('u1', null, NOW);
		expect(bg.backgroundRun).toHaveBeenCalledWith(
			expect.objectContaining({ signalKey: 'followup:f1' })
		);
		expect(bg.backgroundRun.mock.calls[0][0].message).toContain(
			'See whether the lab was marked done'
		);
		expect(cards).toEqual([
			expect.objectContaining({ title: 'Checked back at 10:59', body: 'The lab is done.' })
		]);
		expect(db.saveFollowup).toHaveBeenLastCalledWith(
			'u1',
			expect.objectContaining({ id: 'f1', status: 'done' })
		);
		// A minute later it's done: not run again.
		await runDueFollowups('u1', null, new Date(NOW.getTime() + 60_000));
		expect(bg.backgroundRun).toHaveBeenCalledTimes(1);
	});

	it('marks one long past as missed, and leaves future ones', async () => {
		db.listFollowups.mockResolvedValue([
			followup({ id: 'old', at: NOW.getTime() - 7 * 3_600_000 }),
			followup({ id: 'later', at: NOW.getTime() + 3_600_000 })
		]);
		expect(await runDueFollowups('u1', null, NOW)).toEqual([]);
		expect(db.saveFollowup).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({ id: 'old', status: 'missed' })
		);
		expect(db.claimFollowup).not.toHaveBeenCalled();
	});
});

describe('muting and notifying', () => {
	it("doesn't raise kinds you mostly dismiss", async () => {
		db.loadFeedback.mockResolvedValue({ deadline: { applied: 0, dismissed: 9, muted: false } });
		bg.backgroundRun.mockResolvedValue({ text: 'NOTHING', truncated: false, proposals: [] });
		await runSignals('u1', null, NOW, [() => [signal('deadline:x'), signal('carryover:y')]]);
		expect(db.claimSignal).toHaveBeenCalledTimes(1);
		expect(db.claimSignal).toHaveBeenCalledWith('u1', 'carryover:y', 'carryover');
	});

	it("doesn't raise kinds you muted", async () => {
		db.loadFeedback.mockResolvedValue({ deadline: { applied: 0, dismissed: 3, muted: true } });
		bg.backgroundRun.mockResolvedValue({ text: 'NOTHING', truncated: false, proposals: [] });
		await runSignals('u1', null, NOW, [() => [signal('deadline:x'), signal('carryover:y')]]);
		expect(db.claimSignal).toHaveBeenCalledTimes(1);
		expect(db.claimSignal).toHaveBeenCalledWith('u1', 'carryover:y', 'carryover');
	});

	it('notifies on the desktop about a check-in brief, opening today', async () => {
		const brief = {
			kind: 'brief',
			title: 'Evening brief · Sat 31 Oct',
			body: 'All quiet.',
			signalKey: 'checkin:evening:2026-10-31',
			priority: 1
		} as InboxItem;
		await notifyAbout('u1', [brief], new Date(2026, 9, 31, 17, 0));
		expect(desktop.notify).toHaveBeenCalledWith(
			'Jarvis · Evening brief · Sat 31 Oct',
			'All quiet.',
			'/day/2026-10-31'
		);
		await notifyAbout('u1', [proposal('x')], new Date(2026, 9, 31, 17, 0));
		expect(desktop.notify).toHaveBeenCalledTimes(1);
	});
});

describe('runCapture', () => {
	const lines = [
		{ line: 'gave @rahim 500', kind: 'money' as const },
		{ line: 'exam on nov 12', kind: 'deadline' as const }
	];

	it('claims each line once and returns the cards from one run', async () => {
		db.claimSignal.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		bg.backgroundRun.mockResolvedValue({
			text: 'NOTHING',
			truncated: false,
			proposals: [proposal('Record a lend of ৳500 to @rahim')]
		});
		const cards = await runCapture('u1', null, '2026-10-31', lines, NOW);
		expect(db.claimSignal).toHaveBeenCalledWith(
			'u1',
			expect.stringMatching(/^capture:2026-10-31:/),
			'capture'
		);
		const job = bg.backgroundRun.mock.calls[0][0];
		// The second line was claimed elsewhere: only the first is asked about.
		expect(job.message).toContain('- gave @rahim 500');
		expect(job.message).not.toContain('exam on nov 12');
		expect(job.signalKey).toMatch(/^capture:2026-10-31:/);
		expect(job.facts).toEqual([
			expect.objectContaining({
				tool: 'schedule_snapshot',
				input: { from: '2026-10-30', to: '2026-11-14' }
			})
		]);
		expect(cards.map((c) => c.title)).toEqual(['Record a lend of ৳500 to @rahim']);
		expect(bg.saveBrief).not.toHaveBeenCalled();
	});

	it('does nothing when muted, when day pages are hidden, or when every line was seen', async () => {
		db.loadFeedback.mockResolvedValueOnce({ capture: { applied: 0, dismissed: 0, muted: true } });
		expect(await runCapture('u1', null, '2026-10-31', lines, NOW)).toEqual([]);

		const hidden = structuredClone(DEFAULT_CONFIG);
		hidden.areas.days = false;
		db.loadAssistantConfig.mockResolvedValueOnce(hidden);
		expect(await runCapture('u1', null, '2026-10-31', lines, NOW)).toEqual([]);

		db.claimSignal.mockResolvedValue(false);
		expect(await runCapture('u1', null, '2026-10-31', lines, NOW)).toEqual([]);
		expect(bg.backgroundRun).not.toHaveBeenCalled();
	});
});

describe('runPrep', () => {
	const meeting = {
		id: 'm1',
		slotId: null,
		date: '2026-10-31',
		start: '11:30',
		end: '12:30',
		title: 'Meeting with @rahim',
		kind: 'meeting',
		room: '501',
		status: 'planned',
		note: ''
	};

	it('leaves a prep note half an hour before, once', async () => {
		db.listEvents.mockResolvedValue([meeting]);
		bg.backgroundRun.mockResolvedValue({
			text: 'Rahim owes you ৳500.',
			truncated: false,
			proposals: []
		});
		const cards = await runPrep('u1', null, NOW); // 11:00
		expect(db.claimSignal).toHaveBeenCalledWith('u1', 'prep:2026-10-31:m1', 'prep');
		expect(bg.backgroundRun.mock.calls[0][0].facts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ tool: 'get_person', input: { handle: 'rahim' } })
			])
		);
		expect(cards).toEqual([
			expect.objectContaining({ title: 'Before Meeting with @rahim', body: 'Rahim owes you ৳500.' })
		]);
		// The next minute: already handled here, no new claim.
		await runPrep('u1', null, new Date(NOW.getTime() + 60_000));
		expect(db.claimSignal).toHaveBeenCalledTimes(1);
		// The schedule was read once for both minutes.
		expect(db.listEvents).toHaveBeenCalledTimes(1);
	});

	it('stays quiet when muted, in quiet hours, or with nothing coming up', async () => {
		db.listEvents.mockResolvedValue([meeting]);
		db.loadFeedback.mockResolvedValueOnce({ prep: { applied: 0, dismissed: 0, muted: true } });
		expect(await runPrep('u1', null, NOW)).toEqual([]);
		resetEngine();
		expect(await runPrep('u1', null, new Date(2026, 9, 31, 2, 0))).toEqual([]);
		resetEngine();
		db.listEvents.mockResolvedValue([]);
		expect(await runPrep('u1', null, NOW)).toEqual([]);
		expect(bg.backgroundRun).not.toHaveBeenCalled();
	});
});
