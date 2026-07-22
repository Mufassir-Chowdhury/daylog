import { authReady } from '$lib/auth.svelte';
import { loadSettings } from '$lib/db';
import { applySettings } from '$lib/settings.svelte';
import type { LayoutLoad } from './$types';

// The whole app talks to Firebase from the browser, so render everything client-side.
export const ssr = false;

export const load: LayoutLoad = async () => {
	const user = await authReady();
	applySettings(user ? await loadSettings(user.uid) : {});
};
