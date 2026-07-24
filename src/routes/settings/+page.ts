import { authReady } from '$lib/auth.svelte';
import { listRoutines } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const user = await authReady();
	if (!user) return { routines: [] };
	return { routines: await listRoutines(user.uid) };
};
