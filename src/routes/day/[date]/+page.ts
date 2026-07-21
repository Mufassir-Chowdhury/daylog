import { redirect } from '@sveltejs/kit';
import { authReady } from '$lib/auth.svelte';
import { dateKey, isValidKey } from '$lib/date';
import { listLongTermTasks, listPeople, loadDay } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	if (!isValidKey(params.date)) redirect(307, `/day/${dateKey()}`);
	const user = await authReady();
	if (!user) return { date: params.date, text: '', people: [], longTerm: [] };
	const [text, people, longTerm] = await Promise.all([
		loadDay(user.uid, params.date),
		listPeople(user.uid),
		listLongTermTasks(user.uid)
	]);
	return { date: params.date, text, people, longTerm };
};
