<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { newNoteId, saveNote } from '$lib/db';

	let { uid }: { uid: string } = $props();

	let expanded = $state(false);
	let title = $state('');
	let content = $state('');
	let tagsInput = $state('');
	let saving = $state(false);

	function open() {
		expanded = true;
	}

	function cancel() {
		expanded = false;
		title = '';
		content = '';
		tagsInput = '';
	}

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

	async function save() {
		if (!title.trim() && !content.trim()) return;
		saving = true;
		const id = newNoteId(uid);
		try {
			await saveNote(uid, { id, title: title.trim(), content, tags: parseTags(tagsInput) });
			cancel();
			await goto(resolve('/notes/[id]', { id }));
		} catch {
			alert('Could not save note — please try again.');
		} finally {
			saving = false;
		}
	}

	function autofocus(node: HTMLInputElement) {
		node.focus();
	}
</script>

{#if !expanded}
	<button
		type="button"
		onclick={open}
		class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
	>
		+ New note
	</button>
{:else}
	<div class="space-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
		<input
			type="text"
			bind:value={title}
			{@attach autofocus}
			placeholder="Title"
			class="w-full rounded-lg border-gray-300 text-sm font-medium"
		/>
		<textarea
			bind:value={content}
			rows="4"
			placeholder="Write your note…"
			class="w-full rounded-lg border-gray-300 text-sm leading-relaxed"></textarea>
		<input
			type="text"
			bind:value={tagsInput}
			placeholder="Tags, comma separated"
			class="w-full rounded-lg border-gray-300 text-sm"
		/>
		<div class="flex justify-end gap-2">
			<button
				type="button"
				onclick={cancel}
				disabled={saving}
				class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={save}
				disabled={saving || (!title.trim() && !content.trim())}
				class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
			>
				{saving ? 'Saving…' : 'Save note'}
			</button>
		</div>
	</div>
{/if}
