import { authReady } from '$lib/auth.svelte';
import { listDeadlines, listEvents, listSlots, listTasks, listWeekNotes } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const user = await authReady();
	if (!user) return { slots: [], events: [], tasks: [], deadlines: [], weekNotes: [] };
	const [slots, events, tasks, deadlines, weekNotes] = await Promise.all([
		listSlots(user.uid),
		listEvents(user.uid),
		listTasks(user.uid),
		listDeadlines(user.uid),
		listWeekNotes(user.uid)
	]);
	return { slots, events, tasks, deadlines, weekNotes };
};
