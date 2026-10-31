import { newFollowupId } from '../../db';
import { change } from '../../ops/change';
import { params, str, type Tool } from './registry';

const WHEN = new Intl.DateTimeFormat('en-GB', {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	hour: 'numeric',
	minute: '2-digit'
});

/** The longest it can look ahead. */
const MAX_AHEAD = 7 * 86_400_000;

export const scheduleCheckin: Tool = {
	area: 'assistant',
	kind: 'write',
	small: true,
	label: 'Schedule a time to check back',
	def: {
		name: 'schedule_checkin',
		description:
			"Schedule yourself to look into something again later, on your own — e.g. after a class to see whether it happened, or the evening before a deadline. The result lands in the owner's Inbox. Within the next 7 days.",
		parameters: params({
			when: str('Local date and time, YYYY-MM-DDTHH:MM.'),
			why: str(
				'What to look at then, in one sentence ("Check whether the DBMS lab was marked done").'
			)
		})
	},
	describe: () => 'Scheduling a time to check back',
	async plan(ctx, input) {
		const when = String(input.when);
		const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(when);
		if (!m) throw new Error('when should look like 2026-10-31T15:00.');
		const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
		const now = Date.now();
		if (at <= now) throw new Error('That time has passed; pick a later one.');
		if (at - now > MAX_AHEAD) throw new Error('At most 7 days ahead.');
		const why = String(input.why).replace(/\s+/g, ' ').trim();
		if (!why) throw new Error('why is empty.');
		return {
			changes: [
				change('followup', null, {
					id: newFollowupId(ctx.uid),
					at,
					why,
					status: 'pending',
					claimedAt: 0
				})
			],
			summary: `Check back ${WHEN.format(at)}: ${why.length > 60 ? `${why.slice(0, 59)}…` : why}`
		};
	}
};

export const FOLLOWUP_TOOLS = [scheduleCheckin];
