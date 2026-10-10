<script lang="ts" module>
	import type { Note, Person } from '$lib/db';
	import type { IconName } from './Icon.svelte';

	/** A command the host adds to the palette (sign out, theme toggle, …). */
	export interface PaletteAction {
		id: string;
		label: string;
		icon: IconName;
		hint?: string;
		keywords?: string;
		run: () => void;
	}

	// Last-known people and notes, so reopening shows results before the refresh lands.
	let cachedPeople: Person[] = [];
	let cachedNotes: Note[] = [];
</script>

<script lang="ts">
	import { addDays, dateKey, humanDate, parseDateWord, relativeLabel } from '$lib/date';
	import { listNotes, listPeople, newNoteId, saveNote } from '$lib/db';
	import type { CaptureEntry } from '$lib/desktop';
	import { fuzzyScore } from '$lib/fuzzy';
	import { dayHref, NAV } from '$lib/nav';
	import { parseCapture } from '$lib/parse';
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		uid,
		query = $bindable(''),
		quick = false,
		epoch = 0,
		actions = [],
		navigate,
		capture,
		close
	}: {
		uid: string;
		query?: string;
		/** Desktop quick bar: capturing is the default and the panel is the whole window. */
		quick?: boolean;
		/** Bump to reset, refocus and refresh (the quick bar stays mounted between opens). */
		epoch?: number;
		actions?: PaletteAction[];
		navigate: (route: string) => void;
		capture: (entry: CaptureEntry) => Promise<void> | void;
		close: () => void;
	} = $props();

	interface Entry {
		id: string;
		label: string;
		detail?: string;
		hint: string;
		icon: IconName;
		score: number;
		run: () => void;
	}

	let people: Person[] = $state(cachedPeople);
	let notes: Note[] = $state(cachedNotes);
	let selected = $state(0);
	let busy = $state(false);
	/** Brief confirmation after a capture — the palette stays open for the next thought. */
	let flash = $state('');
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let input: HTMLInputElement | undefined = $state();
	let list: HTMLElement | undefined = $state();

	async function refresh() {
		try {
			const [p, n] = await Promise.all([listPeople(uid), listNotes(uid)]);
			people = cachedPeople = p;
			notes = cachedNotes = n;
		} catch {
			/* offline with a cold cache — palette still navigates and captures */
		}
	}

	$effect(() => {
		void epoch;
		selected = 0;
		refresh();
		tick().then(() => {
			input?.focus();
			input?.select();
		});
	});

	function dayLabel(key: string): string {
		return relativeLabel(key) || humanDate(key);
	}

	async function doCapture(entry: CaptureEntry) {
		busy = true;
		try {
			await capture(entry);
			query = '';
			selected = 0;
			flash = `Added to ${dayLabel(entry.date)}`;
			clearTimeout(flashTimer);
			flashTimer = setTimeout(() => (flash = ''), 1800);
		} finally {
			busy = false;
		}
	}

	async function createNote(title: string) {
		const id = newNoteId(uid);
		await saveNote(uid, { id, title, content: '', tags: [] });
		navigate(`/notes/${id}`);
	}

	const entries: Entry[] = $derived.by(() => {
		// Read the clock on every pass — the quick bar can stay open past midnight.
		const today = dateKey();
		const raw = query.trim();
		const prefix = /^[>@#]/.test(raw) ? raw[0] : '';
		const term = prefix ? raw.slice(1).trim() : raw;
		const out: Entry[] = [];

		const add = (entry: Omit<Entry, 'score'>, haystack: string, boost = 0) => {
			const score = fuzzyScore(term, haystack);
			if (score !== null) out.push({ ...entry, score: score + boost });
		};

		if (!prefix) {
			const date = parseDateWord(term, today);
			if (date) {
				out.push({
					id: `day:${date}`,
					label: humanDate(date),
					hint: relativeLabel(date) || 'Open day',
					icon: 'day',
					score: 1000,
					run: () => navigate(dayHref(date))
				});
			}
			for (const item of NAV) {
				add(
					{
						id: `nav:${item.label}`,
						label: item.label,
						hint: `g ${item.key}`,
						icon: item.icon,
						run: () => navigate(item.href())
					},
					item.label
				);
			}
			for (const [label, offset] of [
				['Tomorrow', 1],
				['Yesterday', -1]
			] as const) {
				add(
					{
						id: `nav:${label}`,
						label,
						hint: 'Day',
						icon: 'day',
						run: () => navigate(dayHref(addDays(dateKey(), offset)))
					},
					label,
					-2
				);
			}
		}

		if (!prefix || prefix === '>') {
			for (const action of actions) {
				add(
					{
						id: `act:${action.id}`,
						label: action.label,
						hint: action.hint ?? 'Action',
						icon: action.icon,
						run: action.run
					},
					`${action.label} ${action.keywords ?? ''}`,
					-1
				);
			}
			out.push({
				id: 'act:new-note',
				label: term && prefix !== '>' ? `New note “${term}”` : 'New note',
				hint: 'Action',
				icon: 'notes',
				score: term ? (prefix === '>' ? (fuzzyScore(term, 'new note') ?? -1e9) : 2) : -1,
				run: () => createNote(prefix === '>' ? '' : term)
			});
		}

		// Searching people and notes needs a term (or the @ / # prefix) — otherwise it's noise.
		if (term || prefix === '@') {
			if (!prefix || prefix === '@') {
				for (const p of people) {
					add(
						{
							id: `person:${p.handle}`,
							label: `@${p.handle}`,
							detail: p.name,
							hint: 'Person',
							icon: 'at',
							run: () => navigate(`/people/${encodeURIComponent(p.handle)}`)
						},
						`${p.handle} ${p.name ?? ''}`,
						prefix === '@' ? 0 : -3
					);
				}
			}
		}
		if (term || prefix === '#') {
			if (!prefix || prefix === '#') {
				for (const n of notes) {
					add(
						{
							id: `note:${n.id}`,
							label: n.title || 'Untitled note',
							detail: n.tags.length ? n.tags.map((t) => `#${t}`).join(' ') : undefined,
							hint: 'Note',
							icon: 'notes',
							run: () => navigate(`/notes/${n.id}`)
						},
						`${n.title} ${n.tags.join(' ')}`,
						prefix === '#' ? 0 : -3
					);
				}
			}
		}

		const entry = !prefix ? parseCapture(term, today) : null;
		if (entry) {
			out.push({
				id: 'capture',
				label: entry.line,
				hint: `Add to ${dayLabel(entry.date)}`,
				icon: 'plus',
				// The quick bar is for capturing first; in the app, a decent match wins.
				score: quick ? 1e6 : out.some((e) => e.score >= 1000) ? 0 : 9,
				run: () => doCapture(entry)
			});
		}

		return out
			.map((e, i) => [e, i] as const)
			.sort((a, b) => b[0].score - a[0].score || a[1] - b[1])
			.slice(0, 40)
			.map(([e]) => e);
	});

	function move(delta: number) {
		if (entries.length === 0) return;
		selected = (selected + delta + entries.length) % entries.length;
		tick().then(() =>
			list?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
		);
	}

	function onkeydown(e: KeyboardEvent) {
		const ctrl = e.ctrlKey || e.metaKey;
		if (e.key === 'ArrowDown' || (ctrl && e.key === 'n')) move(1);
		else if (e.key === 'ArrowUp' || (ctrl && e.key === 'p')) move(-1);
		else if (e.key === 'PageDown') move(5);
		else if (e.key === 'PageUp') move(-5);
		else if (e.key === 'Enter') {
			if (busy) return;
			const entry = parseCapture(query);
			if ((e.shiftKey || ctrl) && entry) doCapture(entry);
			else entries[selected]?.run();
		} else if (e.key === 'Escape') {
			if (query) query = '';
			else close();
		} else return;
		e.preventDefault();
	}
</script>

<div
	class="palette-panel flex max-h-full min-h-0 flex-col overflow-hidden rounded-card border border-line bg-card text-ink"
	class:palette-quick={quick}
>
	<div class="flex items-center gap-3 border-b border-line px-4">
		<span class="palette-orb" class:palette-orb-busy={busy} aria-hidden="true"></span>
		<input
			bind:this={input}
			bind:value={query}
			oninput={() => (selected = 0)}
			{onkeydown}
			type="text"
			spellcheck="false"
			autocomplete="off"
			placeholder={quick
				? 'Capture a thought, or jump anywhere…'
				: 'Search, jump to a day, or type to add a line…'}
			aria-label="Command"
			role="combobox"
			aria-expanded="true"
			aria-controls="palette-list"
			aria-activedescendant={entries[selected] ? `palette-${selected}` : undefined}
			class="h-14 min-w-0 flex-1 border-0 bg-transparent px-0 text-[17px] text-ink placeholder:text-faint focus:ring-0"
		/>
		<kbd class="hidden sm:inline">esc</kbd>
	</div>

	<div
		bind:this={list}
		id="palette-list"
		role="listbox"
		aria-label="Results"
		class="min-h-0 flex-1 overflow-y-auto p-1.5"
	>
		{#each entries as entry, i (entry.id)}
			<button
				type="button"
				id="palette-{i}"
				data-index={i}
				role="option"
				aria-selected={i === selected}
				tabindex="-1"
				onpointermove={() => (selected = i)}
				onclick={() => entry.run()}
				class="palette-row flex w-full items-center gap-3 rounded-ctl px-3 py-2 text-left text-sm"
			>
				<span class="palette-icon grid h-7 w-7 place-items-center rounded-ctl">
					<Icon name={entry.icon} size={16} />
				</span>
				<span class="min-w-0 flex-1 truncate">
					<span class="font-medium">{entry.label}</span>
					{#if entry.detail}<span class="ml-2 text-faint">{entry.detail}</span>{/if}
				</span>
				<span class="palette-hint shrink-0 text-xs text-faint">{entry.hint}</span>
			</button>
		{:else}
			<p class="px-3 py-6 text-center text-sm text-faint">Nothing matches.</p>
		{/each}
	</div>

	<div
		class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-faint"
	>
		{#if flash}
			<span class="flex items-center gap-1.5 font-medium text-accent" role="status">
				<Icon name="check" size={13} />
				{flash}
			</span>
		{:else}
			<span><kbd>↵</kbd> run</span>
			<span><kbd>⇧</kbd><kbd>↵</kbd> add to day</span>
			<span><kbd>tmr:</kbd> <kbd>fri:</kbd> pick the day</span>
			<span class="hidden sm:inline"
				><kbd>@</kbd> people · <kbd>#</kbd> notes · <kbd>&gt;</kbd> actions</span
			>
		{/if}
	</div>
</div>
