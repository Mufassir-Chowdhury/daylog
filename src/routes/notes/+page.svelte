<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import NewNotePanel from '$lib/components/NewNotePanel.svelte';
	import { deleteNote } from '$lib/db';

	let { data } = $props();

	const uid = session.user!.uid;

	// Overridable derived: refreshed by navigation, locally updated on delete.
	let notes = $derived(data.notes);
	let activeTag: string | null = $state(null);
	let deleting: string | null = $state(null);

	const tags = $derived([...new Set(notes.flatMap((n) => n.tags))].sort());
	const visible = $derived.by(() => {
		const tag = activeTag;
		return tag ? notes.filter((n) => n.tags.includes(tag)) : notes;
	});

	function toggleTag(tag: string) {
		activeTag = activeTag === tag ? null : tag;
	}

	async function remove(id: string) {
		const ok = confirm('Delete this note?');
		if (!ok) return;
		deleting = id;
		try {
			await deleteNote(uid, id);
			notes = notes.filter((n) => n.id !== id);
		} catch {
			alert('Could not delete note — please try again.');
		} finally {
			deleting = null;
		}
	}
</script>

<div class="flex items-center justify-between gap-3">
	<h1 class="text-xl font-bold text-gray-900">Notes</h1>
	<NewNotePanel {uid} />
</div>

{#if tags.length > 0}
	<div class="mt-4 flex flex-wrap gap-2">
		{#each tags as tag (tag)}
			<button
				type="button"
				onclick={() => toggleTag(tag)}
				class="rounded-full border px-2.5 py-1 text-xs font-medium {activeTag === tag
					? 'border-blue-600 bg-blue-600 text-white'
					: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}"
			>
				#{tag}
			</button>
		{/each}
	</div>
{/if}

{#if visible.length === 0}
	<p class="mt-6 text-sm text-gray-400">
		{#if notes.length === 0}
			No notes yet — jot something down with "+ New note".
		{:else}
			No notes tagged #{activeTag}.
		{/if}
	</p>
{:else}
	<ul class="mt-4 space-y-3">
		{#each visible as note (note.id)}
			<li class="flex items-start rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<a href={resolve('/notes/[id]', { id: note.id })} class="min-w-0 flex-1">
					<h2 class="truncate font-medium text-gray-900">{note.title || 'Untitled'}</h2>
					{#if note.content}
						<p class="mt-0.5 truncate text-sm text-gray-500">{note.content.split('\n')[0]}</p>
					{/if}
					{#if note.tags.length > 0}
						<div class="mt-2 flex flex-wrap gap-1">
							{#each note.tags as tag (tag)}
								<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
									>#{tag}</span
								>
							{/each}
						</div>
					{/if}
				</a>
				<button
					type="button"
					onclick={() => remove(note.id)}
					disabled={deleting !== null}
					aria-label="Delete note"
					class="ml-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
				>
					{deleting === note.id ? '…' : '✕'}
				</button>
			</li>
		{/each}
	</ul>
{/if}
