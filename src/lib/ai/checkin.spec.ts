import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheckin, runDueCheckins } from './checkin';
import { DEFAULT_CHECKINS, DEFAULT_CONFIG } from './config';
import type { InboxItem } from './inbox';
import type { RunResult, SendRequest } from './types';

const db = vi.hoisted(() => ({
	loadAssistantConfig: vi.fn(),
	listMemory: vi.fn(async () => []),
	listTasks: vi.fn(async () => []),
	// What the check-in's facts read.
	listSlots: vi.fn(async () => []),
	listEvents: vi.fn(async () => []),
	listDeadlines: vi.fn(async () => []),
	listWeekNotes: vi.fn(async () => []),
	listAccounts: vi.fn(async () => []),
	listPeople: vi.fn(async () => []),
	listTransactions: vi.fn(async () => []),
	listRoutines: vi.fn(async () => []),
	listRoutineLogs: vi.fn(async () => []),
	loadRoutineLog: vi.fn(async () => ({})),
	listActivityDocs: vi.fn(async () => []),
	loadActivityConfig: vi.fn(async () => ({ categories: {} })),
	loadActivityGoals: vi.fn(async () => []),
	MANUAL_DEVICE: 'manual',
	loadDay: vi.fn(async () => 'call mom'),
	newScheduleId: () => 'task-new',
	newInboxId: vi.fn(),
	newNoteId: () => 'note-new',
	listCheckinRecords: vi.fn(async () => [] as unknown[]),
	claimCheckin: vi.fn(),
	saveCheckinRecord: vi.fn(async () => {})
}));
const keys = vi.hoisted(() => ({ anthropic: true, gemini: false }));
vi.mock('./transport', () => ({ keyStatus: async () => keys }));
const putItem = vi.hoisted(() => vi.fn<(uid: string, item: InboxItem) => void>());
const commit = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn<(req: SendRequest) => Promise<RunResult>>());

vi.mock('../db', () => db);
vi.mock('./inbox.svelte', () => ({ putItem }));
vi.mock('../ops/commit', () => ({ commit }));
vi.mock('./index', () => ({ loadAdapter: async () => ({ id: 'anthropic', send }) }));

const reply = (over: Partial<RunResult>): RunResult => ({
	text: '',
	calls: [],
	stop: 'done',
	usage: { input: 1, output: 1, cacheRead: 0 },
	model: 'm',
	messages: [],
	...over
});

const evening = DEFAULT_CHECKINS.find((c) => c.kind === 'brief')!;
const NOW = new Date(2026, 9, 30, 17, 0);

let ids = 0;
beforeEach(() => {
	db.loadAssistantConfig.mockResolvedValue(structuredClone(DEFAULT_CONFIG));
	db.newInboxId.mockImplementation(() => `card-${++ids}`);
	putItem.mockClear();
	commit.mockClear();
	send.mockReset();
	keys.anthropic = true;
	db.listCheckinRecords.mockResolvedValue([]);
	db.claimCheckin.mockReset();
	db.saveCheckinRecord.mockClear();
});

describe('runCheckin', () => {
	it('leaves a brief and turns even small additions into cards, applying nothing', async () => {
		send
			.mockResolvedValueOnce(
				reply({
					stop: 'tool_use',
					calls: [
						{
							id: 'c1',
							name: 'add_task',
							input: {
								text: 'Grade DM',
								date: null,
								until: null,
								start: null,
								end: null,
								highlight: null
							}
						}
					]
				})
			)
			.mockResolvedValueOnce(
				reply({ text: 'Good evening, Mufassir.\n- Grading DM is unplanned — card added.' })
			);

		const { brief, proposals } = await runCheckin('u1', evening, 'Mufassir Chowdhury', NOW);

		expect(commit).not.toHaveBeenCalled();
		expect(proposals).toEqual([
			expect.objectContaining({
				kind: 'proposal',
				source: 'checkin',
				title: 'Add “Grade DM” to Later',
				tool: 'add_task',
				signalKey: 'checkin:evening:2026-10-30'
			})
		]);
		expect(brief).toMatchObject({
			kind: 'brief',
			source: 'checkin',
			title: 'Evening brief · Fri 30 Oct',
			body: 'Good evening, Mufassir.\n- Grading DM is unplanned — card added.',
			signalKey: 'checkin:evening:2026-10-30',
			priority: 1
		});
		expect(putItem).toHaveBeenCalledTimes(2);
		// The tool result says it's a card, not done.
		expect(send.mock.calls[1][0].turn).toMatchObject({
			results: [{ content: expect.stringContaining("Saved as a card in the owner's Inbox") }]
		});
	});

	it('uses the background model, a fresh conversation and no ui or memory tools', async () => {
		send.mockResolvedValueOnce(reply({ text: 'All quiet.' }));
		await runCheckin('u1', evening, null, NOW);
		const req = send.mock.calls[0][0];
		expect(req.model).toBe('claude-haiku-5-5');
		expect(req.history).toEqual([]);
		const names = req.tools.map((t) => t.name);
		expect(names).toContain('schedule_snapshot');
		expect(names).toContain('move_line');
		expect(names).not.toContain('open_page');
		expect(names).not.toContain('remember');
		const text = req.turn.kind === 'user' ? req.turn.text : '';
		expect(text).toContain('# Check-in: Evening brief');
		expect(text).toContain('Tomorrow: the first class or event');
		expect(text).toContain('<memory>');
		// The evening brief starts from today and tomorrow, today's page and money.
		expect(text).toContain('<facts>');
		expect(text).toContain('## Today and tomorrow — schedule_snapshot');
		expect(text).toContain('## Money this month — finance_summary');
		expect(text).toContain("## Today's page — read_day");
	});

	it('leaves no brief when the answer is empty or refused', async () => {
		send.mockResolvedValueOnce(reply({ text: '', stop: 'refusal' }));
		expect(await runCheckin('u1', evening, null, NOW)).toEqual({ brief: null, proposals: [] });
		expect(putItem).not.toHaveBeenCalled();
	});
});

describe('runDueCheckins', () => {
	const claimed = (checkinId: string) => ({
		date: '2026-10-30',
		checkinId,
		status: 'running',
		at: NOW.getTime(),
		attempts: 1,
		device: 'd'
	});

	it('runs the due check-in, skips the missed one and records both', async () => {
		db.claimCheckin.mockImplementation(async (_u, c) => claimed(c.id));
		send.mockResolvedValueOnce(reply({ text: 'Evening.' }));
		const result = await runDueCheckins('u1', null, NOW);
		expect(result?.brief?.body).toBe('Evening.');
		expect(db.claimCheckin).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({ id: 'evening' }),
			'2026-10-30',
			expect.any(String)
		);
		expect(db.saveCheckinRecord).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({ checkinId: 'warmup', status: 'skipped' })
		);
		expect(db.saveCheckinRecord).toHaveBeenLastCalledWith(
			'u1',
			expect.objectContaining({ checkinId: 'evening', status: 'done' })
		);
	});

	it("doesn't run what another device claimed", async () => {
		db.claimCheckin.mockResolvedValue(null);
		// Each test its own day: runDueCheckins remembers today's records.
		expect(await runDueCheckins('u1', null, new Date(2026, 9, 28, 17, 0))).toBeNull();
		expect(db.claimCheckin).toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it('records a failure so it can be retried', async () => {
		db.claimCheckin.mockImplementation(async (_u, c) => claimed(c.id));
		send.mockRejectedValueOnce(new Error('offline'));
		await expect(runDueCheckins('u1', null, new Date(2026, 9, 27, 17, 0))).rejects.toThrow(
			'offline'
		);
		expect(db.saveCheckinRecord).toHaveBeenLastCalledWith(
			'u1',
			expect.objectContaining({ checkinId: 'evening', status: 'failed' })
		);
	});

	it('does nothing without a key on this device', async () => {
		keys.anthropic = false;
		expect(await runDueCheckins('u1', null, NOW)).toBeNull();
		expect(db.claimCheckin).not.toHaveBeenCalled();
	});

	it("only reads today's records when something looks due", async () => {
		const day = (time: string) => new Date(`2026-11-01T${time}:00`);
		db.claimCheckin.mockImplementation(async (_u, c, date) => ({
			...claimed(c.id),
			date
		}));
		db.listCheckinRecords.mockClear();

		expect(await runDueCheckins('u1', null, day('07:00'))).toBeNull();
		expect(db.listCheckinRecords).not.toHaveBeenCalled();

		send.mockResolvedValueOnce(reply({ text: 'Morning.' }));
		await runDueCheckins('u1', null, day('08:01'));
		expect(db.listCheckinRecords).toHaveBeenCalledTimes(1);

		// It ran, so the next minutes need no reads.
		expect(await runDueCheckins('u1', null, day('08:30'))).toBeNull();
		expect(db.listCheckinRecords).toHaveBeenCalledTimes(1);
	});
});

describe('the weekly review', () => {
	const review = DEFAULT_CHECKINS.find((c) => c.kind === 'review')!;
	const THU = new Date(2026, 9, 29, 20, 0);

	it('keeps the review as a note when notes are made without asking', async () => {
		send.mockResolvedValueOnce(reply({ text: 'Good evening.\nThis week:\n- All classes held.' }));
		const { brief } = await runCheckin('u1', review, null, THU);
		expect(brief?.title).toBe('Weekly review · Thu 29 Oct');
		expect(commit).toHaveBeenCalledWith('u1', [
			expect.objectContaining({
				kind: 'note',
				before: null,
				after: expect.objectContaining({
					id: 'note-new',
					title: 'Weekly review · Sun 25 Oct–Thu 29 Oct',
					content: 'Good evening.\nThis week:\n- All classes held.',
					tags: ['review']
				})
			})
		]);
		const text = send.mock.calls[0][0].turn;
		expect(text.kind === 'user' && text.text).toContain('"This week:" and "Next week:"');
	});

	it('asks with a card when notes need asking', async () => {
		const config = structuredClone(DEFAULT_CONFIG);
		config.permissions.create_note = 'ask';
		db.loadAssistantConfig.mockResolvedValue(config);
		send.mockResolvedValueOnce(reply({ text: 'Review.' }));
		const { proposals } = await runCheckin('u1', review, null, THU);
		expect(commit).not.toHaveBeenCalled();
		expect(proposals).toEqual([
			expect.objectContaining({
				tool: 'create_note',
				title: 'Save “Weekly review · Sun 25 Oct–Thu 29 Oct” as a note'
			})
		]);
	});
});
