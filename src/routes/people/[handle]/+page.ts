import { redirect } from '@sveltejs/kit';
import { authReady } from '$lib/auth.svelte';
import { daysMentioning, listAccounts, listPersonTransactions, loadPerson } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const handle = params.handle.toLowerCase();
	if (handle !== params.handle) redirect(307, `/people/${handle}`);
	const user = await authReady();
	if (!user) return { handle, person: { handle }, days: [], txns: [], accounts: [] };
	const [person, days, txns, accounts] = await Promise.all([
		loadPerson(user.uid, handle),
		daysMentioning(user.uid, handle),
		listPersonTransactions(user.uid, handle),
		listAccounts(user.uid)
	]);
	return { handle, person, days, txns, accounts };
};
