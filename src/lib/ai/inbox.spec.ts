import { describe, expect, it } from 'vitest';
import { pendingItems, staleItems, type InboxItem } from './inbox';

const DAY = 86_400_000;
const NOW = 100 * DAY;

const card = (over: Partial<InboxItem>): InboxItem => ({
	id: 'x',
	kind: 'proposal',
	source: 'chat',
	title: '',
	body: '',
	tool: 'set_task_status',
	details: [],
	changes: [],
	status: 'pending',
	signalKey: '',
	priority: 0,
	createdAt: NOW - DAY,
	expiresAt: NOW + DAY,
	...over
});

describe('inbox', () => {
	it('shows pending, unexpired cards by priority then newest', () => {
		const items = [
			card({ id: 'old', createdAt: NOW - 2 * DAY }),
			card({ id: 'new', createdAt: NOW - 1000 }),
			card({ id: 'urgent', priority: 2, createdAt: NOW - 3 * DAY }),
			card({ id: 'done', status: 'applied' }),
			card({ id: 'expired', expiresAt: NOW - 1 })
		];
		expect(pendingItems(items, NOW).map((i) => i.id)).toEqual(['urgent', 'new', 'old']);
	});

	it('clears settled cards after a month and expired ones a month after expiry', () => {
		const items = [
			card({ id: 'recent', status: 'dismissed' }),
			card({ id: 'settled', status: 'applied', createdAt: NOW - 31 * DAY }),
			card({ id: 'waiting', createdAt: NOW - 31 * DAY, expiresAt: NOW + DAY }),
			card({ id: 'expired', expiresAt: NOW - 31 * DAY })
		];
		expect(staleItems(items, NOW).map((i) => i.id)).toEqual(['settled', 'expired']);
	});
});
