<script lang="ts">
	import {
		CATEGORIES,
		CATEGORY_LABEL,
		formatDuration,
		goalProgress,
		goalSubject,
		type ActivityCategory,
		type ActivityGoal,
		type DaySummary
	} from '$lib/activity';

	/** A day's time goals: progress from recorded time, and an editor. */
	let {
		goals,
		own,
		day,
		isToday,
		dayLabel,
		options,
		onsave,
		onreset
	}: {
		/** The goals that apply to this day (its own, or the defaults). */
		goals: ActivityGoal[];
		/** Whether the day has its own goals rather than the defaults. */
		own: boolean;
		day: DaySummary;
		isToday: boolean;
		dayLabel: string;
		/** Apps and sites seen recently, for "time in these apps" goals. */
		options: { key: string; label: string }[];
		onsave: (goals: ActivityGoal[], asDefault: boolean) => void;
		onreset: () => void;
	} = $props();

	const progress = $derived(goals.map((g) => goalProgress(g, day)));
	const metCount = $derived(progress.filter((p) => p.met).length);

	let editing = $state(false);
	let draft = $state<ActivityGoal[]>([]);
	let asDefault = $state(false);
	let filter = $state('');

	function edit() {
		draft = goals.map((g) => ({ ...g, keys: [...g.keys], names: [...g.names] }));
		asDefault = !own;
		filter = '';
		if (draft.length === 0) addGoal();
		editing = true;
	}

	function addGoal() {
		draft.push({
			id: crypto.randomUUID(),
			kind: 'category',
			category: 'focus',
			keys: [],
			names: [],
			minutes: 240,
			limit: false
		});
	}

	/** The "what" select packs kind and category into one value. */
	const whatOf = (g: ActivityGoal) => (g.kind === 'category' ? `category:${g.category}` : g.kind);

	function setWhat(g: ActivityGoal, value: string) {
		if (value.startsWith('category:')) {
			g.kind = 'category';
			g.category = value.slice(9) as ActivityCategory;
			// Distraction goals are almost always limits.
			g.limit = g.category === 'distraction';
		} else {
			g.kind = value as ActivityGoal['kind'];
		}
	}

	function toggleKey(g: ActivityGoal, option: { key: string; label: string }) {
		const i = g.keys.indexOf(option.key);
		if (i >= 0) {
			g.keys.splice(i, 1);
			g.names.splice(i, 1);
		} else {
			g.keys.push(option.key);
			g.names.push(option.label);
		}
	}

	/** Options plus any chosen apps that haven't been seen lately, so they can be unticked. */
	function choices(g: ActivityGoal) {
		const seen = new Set(options.map((o) => o.key));
		const extra = g.keys
			.map((key, i) => ({ key, label: g.names[i] ?? key }))
			.filter((o) => !seen.has(o.key));
		const all = [...extra, ...options];
		const q = filter.trim().toLowerCase();
		return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
	}

	function save() {
		const valid = draft.filter((g) => g.minutes > 0 && (g.kind !== 'subjects' || g.keys.length));
		onsave(valid, asDefault);
		editing = false;
	}

	function status(p: ReturnType<typeof goalProgress>): string {
		const diff = Math.abs(p.target - p.ms);
		if (p.goal.limit)
			return p.met ? `${formatDuration(diff)} left` : `over by ${formatDuration(diff)}`;
		if (p.met) return 'done';
		return isToday ? `${formatDuration(diff)} to go` : `short by ${formatDuration(diff)}`;
	}

	const field = 'rounded-ctl border-line bg-card py-1 text-sm text-ink';
</script>

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<div class="mb-3 flex flex-wrap items-baseline gap-x-3">
		<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Goals</h2>
		{#if !editing && goals.length}
			<span class="text-xs text-faint">
				{metCount}/{goals.length}
				{isToday ? 'met so far' : 'met'}
				· {own ? `just for ${dayLabel}` : 'your defaults'}
			</span>
		{/if}
		{#if !editing}
			<button
				type="button"
				onclick={edit}
				class="ml-auto text-xs font-medium text-accent hover:underline"
			>
				{goals.length ? 'Edit' : 'Set goals'}
			</button>
		{/if}
	</div>

	{#if !editing}
		{#if goals.length === 0}
			<p class="text-sm text-faint">
				No goals for {dayLabel}. Set targets like “4h of focus” or limits like “YouTube under 30m”,
				and recorded time counts towards them.
			</p>
		{:else}
			<ul class="space-y-3">
				{#each progress as p (p.goal.id)}
					{@const over = p.goal.limit && !p.met}
					<li>
						<div class="flex items-baseline gap-2 text-sm">
							<span class="min-w-0 flex-1 truncate font-medium text-ink">
								{goalSubject(p.goal)}
								<span class="font-normal text-faint">
									{p.goal.limit ? 'at most' : 'at least'}
									{formatDuration(p.target)}
								</span>
							</span>
							<span class="text-ink tabular-nums">{formatDuration(p.ms)}</span>
							<span
								class="w-28 text-right text-xs tabular-nums {over
									? 'text-[var(--t-down)]'
									: p.met && !p.goal.limit
										? 'font-medium text-[var(--t-up)]'
										: 'text-faint'}"
							>
								{#if p.met && !p.goal.limit}✓{/if}
								{status(p)}
							</span>
						</div>
						<div class="mt-1 h-2 rounded-full bg-tint">
							<div
								class="h-2 rounded-full"
								style:width="{Math.min(100, p.ratio * 100)}%"
								style:background={over
									? 'var(--t-down)'
									: p.goal.limit
										? 'var(--t-faint)'
										: 'var(--t-cat-3)'}
							></div>
						</div>
					</li>
				{/each}
			</ul>
			{#if own}
				<button
					type="button"
					onclick={onreset}
					class="mt-3 text-xs text-mute hover:text-ink hover:underline"
				>
					Use my default goals for this day instead
				</button>
			{/if}
		{/if}
	{:else}
		<ul class="space-y-3">
			{#each draft as g, i (g.id)}
				<li class="rounded-ctl border border-line p-2.5">
					<div class="flex flex-wrap items-center gap-2 text-sm">
						<select
							value={whatOf(g)}
							onchange={(e) => setWhat(g, e.currentTarget.value)}
							aria-label="What counts"
							class={field}
						>
							<option value="total">Time at the computer</option>
							<option value="deep">Deep work (25 min+ stretches)</option>
							{#each CATEGORIES as c (c)}
								<option value="category:{c}">{CATEGORY_LABEL[c]} time</option>
							{/each}
							<option value="subjects">Specific apps & sites…</option>
						</select>
						<select bind:value={g.limit} aria-label="Target or limit" class={field}>
							<option value={false}>at least</option>
							<option value={true}>at most</option>
						</select>
						<label class="flex items-center gap-1 text-mute">
							<input
								type="number"
								min="0"
								max="24"
								value={Math.floor(g.minutes / 60)}
								oninput={(e) =>
									(g.minutes = Number(e.currentTarget.value || 0) * 60 + (g.minutes % 60))}
								aria-label="Hours"
								class="{field} w-16"
							/>h
						</label>
						<label class="flex items-center gap-1 text-mute">
							<input
								type="number"
								min="0"
								max="59"
								step="5"
								value={g.minutes % 60}
								oninput={(e) =>
									(g.minutes =
										Math.floor(g.minutes / 60) * 60 +
										Math.min(59, Number(e.currentTarget.value || 0)))}
								aria-label="Minutes"
								class="{field} w-16"
							/>m
						</label>
						<button
							type="button"
							onclick={() => draft.splice(i, 1)}
							class="ml-auto rounded-ctl px-2 py-1 text-xs text-mute hover:bg-tint hover:text-ink"
						>
							Remove
						</button>
					</div>
					{#if g.kind === 'subjects'}
						<div class="mt-2">
							<input
								type="search"
								bind:value={filter}
								placeholder="Filter apps and sites"
								class="{field} mb-1 w-full max-w-xs"
							/>
							<div class="max-h-40 overflow-y-auto rounded-ctl border border-line p-1.5">
								{#each choices(g) as o (o.key)}
									<label class="flex items-center gap-2 px-1 py-0.5 text-sm text-ink">
										<input
											type="checkbox"
											checked={g.keys.includes(o.key)}
											onchange={() => toggleKey(g, o)}
											class="rounded border-line bg-card text-accent-fill"
										/>
										{o.label}
									</label>
								{:else}
									<p class="px-1 text-xs text-faint">
										No apps or sites recorded yet — add time by hand, or record a day first.
									</p>
								{/each}
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		<button
			type="button"
			onclick={addGoal}
			class="mt-2 text-xs font-medium text-accent hover:underline"
		>
			+ Add a goal
		</button>
		<label class="mt-3 flex items-center gap-2 text-sm text-ink">
			<input
				type="checkbox"
				bind:checked={asDefault}
				class="rounded border-line bg-card text-accent-fill"
			/>
			Make these my default goals (every day without its own)
		</label>
		<div class="mt-3 flex gap-2">
			<button
				type="button"
				onclick={save}
				class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
			>
				{asDefault ? 'Save as default' : `Save for ${dayLabel}`}
			</button>
			<button
				type="button"
				onclick={() => (editing = false)}
				class="rounded-ctl px-3 py-1.5 text-sm text-mute hover:bg-tint hover:text-ink"
			>
				Cancel
			</button>
		</div>
	{/if}
</section>
