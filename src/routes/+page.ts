import { redirect } from '@sveltejs/kit';
import { dateKey } from '$lib/date';

export function load() {
	redirect(307, `/day/${dateKey()}`);
}
