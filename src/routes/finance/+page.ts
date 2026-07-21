import { authReady } from '$lib/auth.svelte';
import { listAccounts, listPeople, listTransactions } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const user = await authReady();
	if (!user) return { accounts: [], txns: [], people: [] };
	const [accounts, txns, people] = await Promise.all([
		listAccounts(user.uid),
		listTransactions(user.uid),
		listPeople(user.uid)
	]);
	return { accounts, txns, people };
};
