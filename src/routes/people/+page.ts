import { authReady } from '$lib/auth.svelte';
import { listPeople } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const user = await authReady();
	return { people: user ? await listPeople(user.uid) : [] };
};
