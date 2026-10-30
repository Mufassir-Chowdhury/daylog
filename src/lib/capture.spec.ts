import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editDayLines, registerDayEditor } from './capture';

const db = vi.hoisted(() => ({
	loadDay: vi.fn(),
	saveDay: vi.fn(async () => {}),
	savePerson: vi.fn(async () => {})
}));
vi.mock('./db', () => db);

beforeEach(() => {
	for (const fn of Object.values(db)) fn.mockClear();
});

describe('editDayLines', () => {
	it('adds, changes and removes lines with one load and one save', async () => {
		db.loadDay.mockResolvedValue('gym\ncall mom');
		await editDayLines('u', '2026-10-30', [
			{ from: 'gym', to: '~~gym~~' },
			{ from: 'call mom', to: null },
			{ from: null, to: 'meet @rahim' }
		]);
		expect(db.saveDay).toHaveBeenCalledWith('u', '2026-10-30', '~~gym~~\nmeet @rahim');
		expect(db.savePerson).toHaveBeenCalledWith('u', { handle: 'rahim' });
	});

	it('goes through an open day page instead of writing behind its back', async () => {
		const append = vi.fn();
		const replace = vi.fn();
		const off = registerDayEditor('2026-10-31', { append, replace });
		await editDayLines('u', '2026-10-31', [
			{ from: null, to: 'x' },
			{ from: 'a', to: null }
		]);
		off();
		expect(append).toHaveBeenCalledWith('x');
		expect(replace).toHaveBeenCalledWith('a', null);
		expect(db.saveDay).not.toHaveBeenCalled();
	});
});
