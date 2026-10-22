<script lang="ts">
	import {
		CATEGORIES,
		CATEGORY_COLOR,
		CATEGORY_LABEL,
		formatDuration,
		formatTime,
		type ActivityCategory,
		type ActivitySpan
	} from '$lib/activity';
	import { fromKey } from '$lib/date';

	/**
	 * Time added by hand — a meeting, reading on paper, a laptop that wasn't
	 * tracking. It counts like recorded time and replaces whatever was recorded
	 * in the same minutes.
	 */
	let {
		date,
		entries,
		options,
		categoryOf,
		onadd,
		ondelete
	}: {
		date: string;
		/** This day's manual entries. */
		entries: ActivitySpan[];
		/** Apps, sites and earlier manual labels, so new time can count towards them. */
		options: { key: string; label: string }[];
		categoryOf: (key: string) => ActivityCategory;
		onadd: (span: ActivitySpan, category: ActivityCategory) => void;
		ondelete: (id: string) => void;
	} = $props();

	let start = $state('');
	let end = $state('');
	let what = $state('');
	let note = $state('');
	let category = $state<ActivityCategory>('focus');
	let error = $state('');

	const match = $derived(
		options.find((o) => o.label.toLowerCase() === what.trim().toLowerCase()) ?? null
	);

	// Picking something known suggests its current category.
	$effect(() => {
		if (match) category = categoryOf(match.key);
	});

	function at(time: string): number {
		const [h, m] = time.split(':').map(Number);
		const d = fromKey(date);
		d.setHours(h, m, 0, 0);
		return d.getTime();
	}

	function add(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const label = what.trim();
		if (!start || !end || !label) {
			error = 'Pick a start, an end and what it was.';
			return;
		}
		const s = at(start);
		const t = at(end);
		if (t <= s) {
			error = 'The end has to be after the start (split time past midnight across two days).';
			return;
		}
		const span: ActivitySpan = {
			s,
			e: t,
			exe: match?.label ?? label,
			app: match?.label ?? label,
			subject: match?.key ?? `manual:${label.toLowerCase()}`,
			manual: true,
			id: crypto.randomUUID()
		};
		if (note.trim()) span.title = note.trim();
		onadd(span, category);
		start = end;
		end = '';
		note = '';
	}

	const field = 'rounded-ctl border-line bg-card py-1.5 text-sm text-ink';
	const sorted = $derived([...entries].sort((a, b) => a.s - b.s));
</script>

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2 class="mb-1 text-xs font-semibold tracking-wide text-mute uppercase">Add time by hand</h2>
	<p class="mb-3 text-xs text-faint">
		For time the tracker missed or got wrong — it replaces anything recorded in those minutes and
		counts towards your goals.
	</p>
	<form onsubmit={add} class="flex flex-wrap items-end gap-2">
		<label class="text-xs text-mute">
			From
			<input type="time" bind:value={start} class="{field} block" />
		</label>
		<label class="text-xs text-mute">
			To
			<input type="time" bind:value={end} class="{field} block" />
		</label>
		<label class="min-w-40 flex-1 text-xs text-mute">
			What
			<input
				bind:value={what}
				list="activity-manual-options"
				placeholder="Reading, Meeting, Visual Studio Code…"
				class="{field} block w-full"
			/>
		</label>
		<datalist id="activity-manual-options">
			{#each options as o (o.key)}<option value={o.label}></option>{/each}
		</datalist>
		<label class="text-xs text-mute">
			Counts as
			<select bind:value={category} class="{field} block">
				{#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_LABEL[c]}</option>{/each}
			</select>
		</label>
		<label class="min-w-32 flex-1 text-xs text-mute">
			Note <span class="text-faint">(optional)</span>
			<input bind:value={note} class="{field} block w-full" />
		</label>
		<button
			type="submit"
			class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
		>
			Add
		</button>
	</form>
	{#if error}<p class="mt-2 text-sm text-[var(--t-down)]">{error}</p>{/if}

	{#if sorted.length}
		<ul class="mt-3 space-y-1 border-t border-line pt-3">
			{#each sorted as entry (entry.id)}
				<li class="flex items-center gap-2 text-sm">
					<span
						class="h-2 w-2 shrink-0 rounded-full"
						style:background={CATEGORY_COLOR[categoryOf(entry.subject ?? '')]}
					></span>
					<span class="w-36 shrink-0 whitespace-nowrap text-faint tabular-nums">
						{formatTime(entry.s)} – {formatTime(entry.e)}
					</span>
					<span class="min-w-0 flex-1 truncate text-ink">
						{entry.app}
						{#if entry.title}<span class="text-faint">· {entry.title}</span>{/if}
					</span>
					<span class="text-mute tabular-nums">{formatDuration(entry.e - entry.s)}</span>
					<button
						type="button"
						onclick={() => entry.id && ondelete(entry.id)}
						aria-label="Remove {entry.app} at {formatTime(entry.s)}"
						class="rounded-ctl px-1.5 text-faint hover:bg-tint hover:text-ink"
					>
						×
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
