import { authReady } from '$lib/auth.svelte';
import { listPeople, listTransactions } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const user = await authReady();
	if (!user) return { people: [], txns: [] };
	const [people, txns] = await Promise.all([listPeople(user.uid), listTransactions(user.uid)]);
	return { people, txns };
};
