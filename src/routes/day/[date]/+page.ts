import { redirect } from '@sveltejs/kit';
import { authReady } from '$lib/auth.svelte';
import { dateKey, isValidKey } from '$lib/date';
import {
	listAccounts,
	listDayEvents,
	listDayTransactions,
	listDeadlines,
	listLongTermTasks,
	listPeople,
	listRoutines,
	listSlots,
	listTasks,
	loadDay,
	loadRoutineLog
} from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	if (!isValidKey(params.date)) redirect(307, `/day/${dateKey()}`);
	const user = await authReady();
	if (!user)
		return {
			date: params.date,
			text: '',
			people: [],
			longTerm: [],
			accounts: [],
			txns: [],
			routines: [],
			routineValues: {},
			slots: [],
			events: [],
			tasks: [],
			deadlines: []
		};
	const [
		text,
		people,
		longTerm,
		accounts,
		txns,
		routines,
		routineValues,
		slots,
		events,
		tasks,
		deadlines
	] = await Promise.all([
		loadDay(user.uid, params.date),
		listPeople(user.uid),
		listLongTermTasks(user.uid),
		listAccounts(user.uid),
		listDayTransactions(user.uid, params.date),
		listRoutines(user.uid),
		loadRoutineLog(user.uid, params.date),
		listSlots(user.uid),
		listDayEvents(user.uid, params.date),
		listTasks(user.uid),
		listDeadlines(user.uid)
	]);
	return {
		date: params.date,
		text,
		people,
		longTerm,
		accounts,
		txns,
		routines,
		routineValues,
		slots,
		events,
		tasks,
		deadlines
	};
};
