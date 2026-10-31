<script lang="ts">
	import { captureCandidates, type CaptureKind } from '$lib/ai/capture';
	import { doneContent, extractMentions, parseDay } from '$lib/parse';

	let { name }: { name: string } = $props();

	let text = $state(
		[
			'09:00AM DM class in 304',
			'call @mom about the weekend',
			'gave @rahim 500',
			'DBMS exam on nov 12',
			'~~buy milk~~'
		].join('\n')
	);

	const OFFER: Record<CaptureKind, string> = {
		money: 'record it in Finance',
		cancel: 'mark the class or event',
		deadline: 'add it as a deadline'
	};

	/** What daylog makes of each line, in the order written. */
	const lines = $derived.by(() => {
		const offers = new Map(captureCandidates(text).map((c) => [c.line, c.kind]));
		const { timed } = parseDay(text);
		return text
			.split('\n')
			.filter((raw) => raw.trim())
			.map((raw) => {
				const line = raw.trim();
				const time = timed.find((t) => t.raw.trim() === line)?.timeLabel ?? null;
				return {
					line,
					done: doneContent(raw) !== null,
					time,
					people: extractMentions(raw),
					offer: offers.get(line) ?? null
				};
			});
	});
</script>

<div class="grid gap-4 md:grid-cols-2">
	<label class="block">
		<span class="text-xs font-medium text-mute">Type some lines, as on a day page</span>
		<textarea
			bind:value={text}
			rows="7"
			spellcheck="false"
			class="mt-1 block w-full resize-y rounded-ctl border-line bg-canvas font-mono text-sm text-ink"
		></textarea>
	</label>
	<div aria-live="polite">
		<span class="text-xs font-medium text-mute">How daylog reads them</span>
		<ul class="mt-1 space-y-1.5">
			{#each lines as l, i (i)}
				<li class="rounded-ctl border border-line bg-card px-3 py-2 text-sm">
					<p class="truncate text-ink" class:line-through={l.done} class:text-faint={l.done}>
						{l.line}
					</p>
					<p class="mt-0.5 flex flex-wrap gap-1.5 text-xs">
						{#if l.done}
							<span class="rounded-full bg-green-500/15 px-2 text-green-700 dark:text-green-300"
								>done</span
							>
						{/if}
						{#if l.time}
							<span class="rounded-full bg-amber-500/15 px-2 text-amber-700 dark:text-amber-300"
								>on the schedule at {l.time} · reminder on the desktop</span
							>
						{/if}
						{#each l.people as handle (handle)}
							<span class="rounded-full bg-accent/10 px-2 text-accent">@{handle}'s page</span>
						{/each}
						{#if l.offer && !l.done}
							<span class="rounded-full bg-teal-500/15 px-2 text-teal-700 dark:text-teal-300"
								>{name} offers to {OFFER[l.offer]}</span
							>
						{/if}
						{#if !l.done && !l.time && !l.people.length && !l.offer}
							<span class="text-faint">a plain line</span>
						{/if}
					</p>
				</li>
			{/each}
		</ul>
	</div>
</div>
