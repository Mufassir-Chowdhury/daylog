<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import NewNotePanel from '$lib/components/NewNotePanel.svelte';
	import { deleteNote } from '$lib/db';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();

	const uid = session.user!.uid;

	// Overridable derived: refreshed by navigation, locally updated on delete.
	let notes = $derived(data.notes);
	let activeTag: string | null = $state(null);
	let search = $state('');
	let deleting: string | null = $state(null);

	const tags = $derived([...new Set(notes.flatMap((n) => n.tags))].sort());
	const visible = $derived.by(() => {
		const tag = activeTag;
		const q = search.trim().toLowerCase();
		return notes.filter(
			(n) =>
				(!tag || n.tags.includes(tag)) &&
				(!q ||
					n.title.toLowerCase().includes(q) ||
					n.content.toLowerCase().includes(q) ||
					n.tags.some((t) => t.toLowerCase().includes(q)))
		);
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
			toast('Could not delete note — please try again.', { tone: 'error' });
		} finally {
			deleting = null;
		}
	}
</script>

<svelte:head>
	<title>Notes · daylog</title>
</svelte:head>

<div class="flex items-center justify-between gap-3">
	<h1 class="font-display text-2xl font-bold tracking-tight text-ink">Notes</h1>
	<NewNotePanel {uid} />
</div>

{#if notes.length > 0}
	<input
		type="search"
		bind:value={search}
		placeholder="Search notes…"
		aria-label="Search notes"
		class="mt-4 w-full rounded-ctl border-line bg-card py-1.5 text-sm text-ink sm:max-w-sm"
	/>
{/if}

{#if tags.length > 0}
	<div class="mt-3 flex flex-wrap gap-2">
		{#each tags as tag (tag)}
			<button
				type="button"
				onclick={() => toggleTag(tag)}
				class="rounded-full border px-2.5 py-1 text-xs font-medium {activeTag === tag
					? 'border-accent-fill bg-accent-fill text-on-accent'
					: 'border-line bg-card text-mute hover:bg-tint'}"
			>
				#{tag}
			</button>
		{/each}
	</div>
{/if}

{#if visible.length === 0}
	<p class="mt-6 text-sm text-faint">
		{#if notes.length === 0}
			No notes yet — jot something down with "+ New note".
		{:else if search.trim()}
			No notes match “{search.trim()}”{activeTag ? ` in #${activeTag}` : ''}.
		{:else}
			No notes tagged #{activeTag}.
		{/if}
	</p>
{:else}
	<ul class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
		{#each visible as note (note.id)}
			<li
				class="flex items-start rounded-card border border-line bg-card p-4 shadow-card transition-colors hover:border-accent/40"
			>
				<a href={resolve('/notes/[id]', { id: note.id })} class="min-w-0 flex-1">
					<h2 class="truncate font-medium text-ink">{note.title || 'Untitled'}</h2>
					{#if note.content}
						<p class="mt-0.5 truncate text-sm text-mute">{note.content.split('\n')[0]}</p>
					{/if}
					{#if note.tags.length > 0}
						<div class="mt-2 flex flex-wrap gap-1">
							{#each note.tags as tag (tag)}
								<span class="rounded-full bg-tint px-2 py-0.5 text-xs text-mute">#{tag}</span>
							{/each}
						</div>
					{/if}
				</a>
				<button
					type="button"
					onclick={() => remove(note.id)}
					disabled={deleting !== null}
					aria-label="Delete note"
					class="ml-2 rounded-ctl px-2.5 py-1.5 text-sm text-faint hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
				>
					{deleting === note.id ? '…' : '✕'}
				</button>
			</li>
		{/each}
	</ul>
{/if}
