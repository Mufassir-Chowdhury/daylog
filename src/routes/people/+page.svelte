<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import { deletePerson } from '$lib/db';

	let { data } = $props();

	const uid = session.user!.uid;

	// Overridable derived: refreshed by navigation, locally updated on delete.
	let people = $derived(data.people);
	let deleting: string | null = $state(null);

	async function remove(handle: string) {
		const ok = confirm(
			`Delete @${handle}? Every mention of them will be replaced with the plain text “${handle}” (no link).`
		);
		if (!ok) return;
		deleting = handle;
		try {
			await deletePerson(uid, handle);
			people = people.filter((p) => p.handle !== handle);
		} catch {
			alert(`Could not delete @${handle} — please try again.`);
		} finally {
			deleting = null;
		}
	}
</script>

<h1 class="text-xl font-bold text-gray-900">People</h1>
<p class="mt-1 text-sm text-gray-500">
	Everyone you've <span class="font-mono">@mentioned</span>. Click through for their bio and every
	note about them.
</p>

{#if people.length === 0}
	<p class="mt-6 text-sm text-gray-400">
		No one yet — mention someone in a day (e.g. <span class="font-mono">@rahim</span>) and press
		space to add them.
	</p>
{:else}
	<ul class="mt-4 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white shadow-sm">
		{#each people as person (person.handle)}
			<li class="flex items-center">
				<a
					href={resolve('/people/[handle]', { handle: person.handle })}
					class="min-w-0 flex-1 px-4 py-3 hover:bg-gray-50"
				>
					<span class="font-medium text-blue-600">@{person.handle}</span>
					{#if person.name}
						<span class="ml-2 text-sm text-gray-700">{person.name}</span>
					{/if}
					{#if person.bio}
						<p class="mt-0.5 truncate text-sm text-gray-500">{person.bio.split('\n')[0]}</p>
					{/if}
				</a>
				<button
					type="button"
					onclick={() => remove(person.handle)}
					disabled={deleting !== null}
					aria-label="Delete @{person.handle}"
					title="Delete — mentions become plain text"
					class="mx-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
				>
					{deleting === person.handle ? '…' : '✕'}
				</button>
			</li>
		{/each}
	</ul>
{/if}
