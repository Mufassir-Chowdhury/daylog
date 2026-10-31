<script lang="ts">
	import { page } from '$app/state';
	import { assistant, openAssistant } from '$lib/ai/assistant.svelte';
	import HelpLineDemo from '$lib/components/HelpLineDemo.svelte';
	import { dateKey } from '$lib/date';
	import { desktop } from '$lib/desktop';
	import {
		CHECKLIST,
		codeParts,
		named,
		searchTopics,
		SECTIONS,
		TOPICS,
		type HelpAction,
		type SectionId
	} from '$lib/help';
	import { dayHref, go } from '$lib/nav';
	import { openPalette } from '$lib/palette.svelte';

	const name = $derived(assistant.name);
	const say = (text: string) => named(text, name);

	let query = $state('');
	/** The section in view; null = all. Starts from the link's #section, if any. */
	let section: SectionId | null = $state(
		(SECTIONS.find((s) => s.id === page.url.hash.slice(1))?.id as SectionId) ?? null
	);

	const visible = $derived(
		searchTopics(
			TOPICS.filter((t) => !t.desktop || desktop),
			query,
			name
		).filter((t) => query.trim() || section === null || t.section === section)
	);
	const grouped = $derived(
		SECTIONS.map((s) => ({ ...s, topics: visible.filter((t) => t.section === s.id) })).filter(
			(s) => s.topics.length
		)
	);

	function pick(id: SectionId | null) {
		section = id;
		query = '';
		history.replaceState(history.state, '', id ? `#${id}` : location.pathname);
	}

	function tryIt(action: HelpAction) {
		if (action.kind === 'ask') openAssistant(action.value);
		else if (action.kind === 'palette') openPalette(action.value);
		else go(action.value === '/day' ? dayHref(dateKey()) : action.value);
	}

	// ——— Getting started, ticked by hand and kept in this browser.
	const CHECK_KEY = 'daylog.help.checklist';
	function loadChecked(): string[] {
		try {
			return JSON.parse(localStorage.getItem(CHECK_KEY) ?? '[]');
		} catch {
			return [];
		}
	}
	let checked: string[] = $state(loadChecked());
	function toggle(id: string) {
		checked = checked.includes(id) ? checked.filter((c) => c !== id) : [...checked, id];
		try {
			localStorage.setItem(CHECK_KEY, JSON.stringify(checked));
		} catch {
			// Private window: the ticks just won't be remembered.
		}
	}
	const progress = $derived(CHECKLIST.filter((c) => checked.includes(c.id)).length);

	const chip = (on: boolean) =>
		`rounded-full border px-3 py-1 text-sm ${
			on
				? 'border-accent/50 bg-accent/10 text-accent'
				: 'border-line bg-card text-mute hover:border-accent/40 hover:text-ink'
		}`;
</script>

<svelte:head>
	<title>Help · daylog</title>
</svelte:head>

{#snippet rich(text: string)}
	{#each codeParts(say(text)) as part, i (i)}{#if part.code}<code
				class="rounded bg-tint px-1 py-0.5 text-[0.85em] text-ink">{part.text}</code
			>{:else}{part.text}{/if}{/each}
{/snippet}

<div class="mx-auto max-w-4xl space-y-6">
	<header class="space-y-3">
		<h1 class="font-display text-2xl font-bold tracking-tight text-ink">Help</h1>
		<p class="text-mute">
			Everything daylog does, what {name} can do for you, and how to get the most from both.
		</p>
		<input
			type="search"
			bind:value={query}
			placeholder="Search the guide — “deadline”, “undo”, “quick bar”…"
			aria-label="Search the guide"
			class="block w-full rounded-ctl border-line bg-card text-ink"
		/>
		<nav aria-label="Sections" class="flex flex-wrap gap-2">
			<button type="button" class={chip(section === null && !query)} onclick={() => pick(null)}>
				All
			</button>
			{#each SECTIONS as s (s.id)}
				<button
					type="button"
					class={chip(section === s.id && !query)}
					aria-pressed={section === s.id}
					onclick={() => pick(s.id)}
				>
					{say(s.label)}
				</button>
			{/each}
		</nav>
	</header>

	{#if !query && section === null}
		<section
			aria-labelledby="start-heading"
			class="rounded-card border border-line bg-card p-4 shadow-card"
		>
			<div class="flex items-baseline justify-between gap-3">
				<h2 id="start-heading" class="font-display text-lg font-bold text-ink">Getting started</h2>
				<span class="text-sm text-faint">{progress} of {CHECKLIST.length}</span>
			</div>
			<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-tint" aria-hidden="true">
				<div
					class="h-full rounded-full bg-accent-fill transition-[width]"
					style:width="{(progress / CHECKLIST.length) * 100}%"
				></div>
			</div>
			<ul class="mt-3 grid gap-1.5 sm:grid-cols-2">
				{#each CHECKLIST as item (item.id)}
					<li class="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							id="check-{item.id}"
							checked={checked.includes(item.id)}
							onchange={() => toggle(item.id)}
							class="rounded border-line bg-card text-accent-fill"
						/>
						<label
							for="check-{item.id}"
							class="min-w-0 flex-1"
							class:line-through={checked.includes(item.id)}
							class:text-faint={checked.includes(item.id)}>{say(item.label)}</label
						>
						{#if item.id === 'ask'}
							<button
								type="button"
								onclick={() => openAssistant("What's up today?")}
								class="text-xs font-medium text-accent hover:underline">Ask</button
							>
						{:else if item.href}
							<button
								type="button"
								onclick={() => tryIt({ label: '', kind: 'go', value: item.href! })}
								class="text-xs font-medium text-accent hover:underline">Go</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#each grouped as group (group.id)}
		<section aria-labelledby="h-{group.id}" class="space-y-3">
			<h2
				id="h-{group.id}"
				class="scroll-mt-20 text-xs font-semibold tracking-wide text-mute uppercase"
			>
				{say(group.label)}
			</h2>
			{#if group.id === 'day' && !query}
				<div class="rounded-card border border-line bg-card p-4 shadow-card">
					<HelpLineDemo {name} />
				</div>
			{/if}
			{#each group.topics as topic (topic.id)}
				<article class="rounded-card border border-line bg-card p-4 shadow-card">
					<h3 class="font-medium text-ink">{say(topic.title)}</h3>
					<p class="mt-0.5 text-sm text-mute">{@render rich(topic.summary)}</p>
					<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-ink marker:text-faint">
						{#each topic.points as point, i (i)}<li>{@render rich(point)}</li>{/each}
					</ul>
					{#if topic.tries?.length}
						<div class="mt-3 flex flex-wrap gap-2">
							{#each topic.tries as action (action.label)}
								<button
									type="button"
									onclick={() => tryIt(action)}
									class="rounded-ctl border border-line px-3 py-1 text-sm hover:border-accent/50 {action.kind ===
									'ask'
										? 'text-accent'
										: 'text-mute hover:text-ink'}"
								>
									{action.kind === 'ask' ? `Ask: “${say(action.value)}”` : say(action.label)}
								</button>
							{/each}
						</div>
					{/if}
				</article>
			{/each}
		</section>
	{:else}
		<p class="text-mute">
			Nothing matches “{query}”. Try another word, or
			<button
				type="button"
				onclick={() => openAssistant(query)}
				class="font-medium text-accent hover:underline">ask {name}</button
			>.
		</p>
	{/each}
</div>
