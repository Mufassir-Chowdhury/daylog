<script lang="ts">
	import { session } from '$lib/auth.svelte';
	import { saveSettings, type TransactionKind } from '$lib/db';
	import { CATEGORIES, categoryOptions } from '$lib/finance';
	import { settings } from '$lib/settings.svelte';
	import { saveFailed } from '$lib/toast.svelte';

	let {
		value = $bindable(),
		kind,
		base,
		class: cls = '',
		placeholder = 'category…',
		onkeydown
	}: {
		/** The chosen category; '' until one is picked. */
		value: string;
		kind: TransactionKind;
		/** Presets and previously used categories for this kind. */
		base: string[];
		class?: string;
		placeholder?: string;
		onkeydown?: (e: KeyboardEvent) => void;
	} = $props();

	const options = $derived.by(() => {
		const list = categoryOptions(kind, base);
		// An older entry's category may not be in the list any more — keep it selectable.
		return value && !list.includes(value) ? [value, ...list] : list;
	});

	let adding = $state(false);
	let draft = $state('');
	let input: HTMLInputElement | undefined = $state();

	function pick(next: string) {
		if (next !== '__new') return (value = next);
		draft = '';
		adding = true;
		queueMicrotask(() => input?.focus());
	}

	function add() {
		const name = draft.trim();
		if (!name) return;
		const existing = options.find((c) => c.toLowerCase() === name.toLowerCase());
		if (existing) value = existing;
		else {
			if (kind === 'income' || kind === 'expense') {
				// A name removed earlier comes back; a preset only needs un-hiding.
				settings.hiddenCategories[kind] = settings.hiddenCategories[kind].filter((c) => c !== name);
				if (!CATEGORIES[kind].includes(name) && !settings.customCategories[kind].includes(name))
					settings.customCategories[kind] = [...settings.customCategories[kind], name];
				const uid = session.user?.uid;
				if (uid) saveSettings(uid, $state.snapshot(settings)).catch(saveFailed);
			}
			value = name;
		}
		adding = false;
	}

	function keys(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			// Don't submit the surrounding transaction form — just add the category.
			e.preventDefault();
			add();
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			adding = false;
		}
	}
</script>

{#if adding}
	<span class="flex items-center gap-1">
		<input
			bind:this={input}
			type="text"
			bind:value={draft}
			onkeydown={keys}
			placeholder="new category"
			aria-label="New category"
			class={cls}
		/>
		<button
			type="button"
			onclick={add}
			class="rounded-ctl bg-accent-fill px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90"
		>
			Add
		</button>
		<button
			type="button"
			onclick={() => (adding = false)}
			aria-label="Cancel new category"
			class="rounded-ctl px-1.5 py-1 text-xs text-mute hover:bg-tint"
		>
			✕
		</button>
	</span>
{:else}
	<select {value} onchange={(e) => pick(e.currentTarget.value)} {onkeydown} class={cls}>
		<option value="" disabled>{placeholder}</option>
		{#each options as c (c)}
			<option value={c}>{c}</option>
		{/each}
		<option value="__new">+ new category…</option>
	</select>
{/if}
