import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerLive } from '../live';
import { change } from './change';
import { commit } from './commit';

const db = vi.hoisted(() => ({
	saveNote: vi.fn(async () => {}),
	savePerson: vi.fn(async () => {}),
	saveTask: vi.fn(async () => {}),
	deleteTask: vi.fn(async () => {}),
	saveMemory: vi.fn(async () => {}),
	deleteMemory: vi.fn(async () => {})
}));
vi.mock('../db', () => db);
vi.mock('../capture', () => ({ editDayLines: vi.fn(async () => {}) }));

beforeEach(() => {
	for (const fn of Object.values(db)) fn.mockClear();
});

const note = { id: 'n1', title: 'Ideas', content: 'a', tags: [] };

describe('commit', () => {
	it('writes notes and people straight to the database when no page has them open', async () => {
		await commit('u', [
			change('note', note, { ...note, content: 'a\nb' }),
			change('person', { handle: 'rahim' }, { handle: 'rahim', bio: 'x' })
		]);
		expect(db.saveNote).toHaveBeenCalledWith('u', { ...note, content: 'a\nb' });
		expect(db.savePerson).toHaveBeenCalledWith('u', { handle: 'rahim', name: '', bio: 'x' });
	});

	it('hands them to an open page instead, which saves them itself', async () => {
		const onNote = vi.fn();
		const onPerson = vi.fn();
		const offNote = registerLive('note', 'n1', onNote);
		const offPerson = registerLive('person', 'rahim', onPerson);
		await commit('u', [
			change('note', note, { ...note, content: 'a\nb' }),
			change('person', { handle: 'rahim' }, { handle: 'rahim', bio: 'x' })
		]);
		offNote();
		offPerson();
		expect(onNote).toHaveBeenCalledWith({ ...note, content: 'a\nb' });
		expect(onPerson).toHaveBeenCalledWith({ handle: 'rahim', name: '', bio: 'x' });
		expect(db.saveNote).not.toHaveBeenCalled();
		expect(db.savePerson).not.toHaveBeenCalled();
	});

	it('creates and deletes', async () => {
		const task = { id: 't', text: 'x' } as never;
		await commit('u', [change('task', null, task), change('task', task, null)]);
		expect(db.saveTask).toHaveBeenCalled();
		expect(db.deleteTask).toHaveBeenCalledWith('u', 't');
	});

	it('remembers and forgets', async () => {
		const memory = { id: 'm', text: 'Prefers mornings', kind: 'preference', updatedAt: 1 } as const;
		await commit('u', [change('memory', null, memory)]);
		expect(db.saveMemory).toHaveBeenCalledWith('u', memory);
		await commit('u', [change('memory', memory, null)]);
		expect(db.deleteMemory).toHaveBeenCalledWith('u', 'm');
	});
});
