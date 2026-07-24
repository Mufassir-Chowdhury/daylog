<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import { deleteNote, saveNote } from '$lib/db';

	let { data } = $props();

	const uid = session.user!.uid;
	const id = $derived(data.note.id);

	// Overridable deriveds: reset on navigation, locally editable in between.
	let title = $derived(data.note.title);
	let content = $derived(data.note.content);
	let tagsInput = $derived(data.note.tags.join(', '));

	let saveState: 'saved' | 'pending' = $state('saved');
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let pending: { id: string; title: string; content: string; tags: string[] } | null = null;
	let deleting = $state(false);

	function parseTags(raw: string): string[] {
		return [
			...new Set(
				raw
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean)
			)
		];
	}

	function onInput() {
		pending = { id, title, content, tags: parseTags(tagsInput) };
		saveState = 'pending';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 600);
	}

	function flush() {
		clearTimeout(saveTimer);
		if (!pending) return;
		saveNote(uid, pending);
		pending = null;
		saveState = 'saved';
	}

	async function remove() {
		const ok = confirm("Delete this note? This can't be undone.");
		if (!ok) return;
		deleting = true;
		try {
			await deleteNote(uid, id);
			await goto(resolve('/notes'));
		} catch {
			alert('Could not delete note — please try again.');
			deleting = false;
		}
	}

	beforeNavigate(flush);
</script>

<svelte:window onvisibilitychange={() => document.hidden && flush()} />

<div class="flex items-center justify-between gap-3">
	<a href={resolve('/notes')} class="text-sm text-mute hover:text-ink">← Notes</a>
	<div class="flex items-center gap-3">
		<span class="text-xs text-faint">{saveState === 'saved' ? 'saved' : '…'}</span>
		<button
			type="button"
			onclick={remove}
			disabled={deleting}
			class="text-sm text-faint hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
		>
			Delete
		</button>
	</div>
</div>

<div class="mt-4 space-y-3 rounded-card border border-line bg-card p-4 shadow-card">
	<input
		type="text"
		bind:value={title}
		oninput={onInput}
		placeholder="Title"
		class="w-full rounded-ctl border-line bg-card text-lg font-bold text-ink"
	/>
	<textarea
		bind:value={content}
		oninput={onInput}
		rows={Math.max(8, content.split('\n').length + 1)}
		placeholder="Write your note…"
		class="w-full rounded-ctl border-line bg-card text-sm leading-relaxed text-ink"></textarea>
	<label class="block">
		<span class="text-xs font-semibold tracking-wide text-mute uppercase">Tags</span>
		<input
			type="text"
			bind:value={tagsInput}
			oninput={onInput}
			placeholder="comma, separated, tags"
			class="mt-1 w-full rounded-ctl border-line bg-card text-sm text-ink"
		/>
	</label>
</div>
