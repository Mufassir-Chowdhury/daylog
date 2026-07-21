import { authReady } from '$lib/auth.svelte';
import { listNotes } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const user = await authReady();
	return { notes: user ? await listNotes(user.uid) : [] };
};
