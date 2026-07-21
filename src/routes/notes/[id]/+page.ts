import { authReady } from '$lib/auth.svelte';
import { loadNote } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const user = await authReady();
	if (!user) return { note: { id: params.id, title: '', content: '', tags: [] } };
	return { note: await loadNote(user.uid, params.id) };
};
