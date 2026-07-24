import { redirect } from '@sveltejs/kit';
import { authReady } from '$lib/auth.svelte';
import { dateKey, isValidKey } from '$lib/date';
import {
	listAccounts,
	listDayTransactions,
	listLongTermTasks,
	listPeople,
	listRoutines,
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
			routineValues: {}
		};
	const [text, people, longTerm, accounts, txns, routines, routineValues] = await Promise.all([
		loadDay(user.uid, params.date),
		listPeople(user.uid),
		listLongTermTasks(user.uid),
		listAccounts(user.uid),
		listDayTransactions(user.uid, params.date),
		listRoutines(user.uid),
		loadRoutineLog(user.uid, params.date)
	]);
	return { date: params.date, text, people, longTerm, accounts, txns, routines, routineValues };
};
