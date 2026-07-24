import { authReady } from '$lib/auth.svelte';
import { listRoutineLogs, listRoutines } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const user = await authReady();
	if (!user) return { routines: [], logs: [] };
	const [routines, logs] = await Promise.all([listRoutines(user.uid), listRoutineLogs(user.uid)]);
	return { routines, logs };
};
