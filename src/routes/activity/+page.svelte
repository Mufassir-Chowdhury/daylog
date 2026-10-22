<script lang="ts">
	import {
		baseline,
		bestFocusWindow,
		CATEGORIES,
		CATEGORY_COLOR,
		CATEGORY_LABEL,
		dayRange,
		defaultCategory,
		formatDuration,
		formatTime,
		hourLabel,
		insights,
		mergeSources,
		summarizeDay,
		summaryLine,
		type ActivityCategory,
		type ActivityGoal,
		type Subject
	} from '$lib/activity';
	import { forgetSynced } from '$lib/activity-sync';
	import { session } from '$lib/auth.svelte';
	import { appendToDay } from '$lib/capture';
	import ActivityDayChart from '$lib/components/ActivityDayChart.svelte';
	import ActivityDaysChart from '$lib/components/ActivityDaysChart.svelte';
	import ActivityGoals from '$lib/components/ActivityGoals.svelte';
	import ActivityManual from '$lib/components/ActivityManual.svelte';
	import ActivitySettings from '$lib/components/ActivitySettings.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { addDays, dateKey, humanDate, relativeLabel } from '$lib/date';
	import {
		deleteAllActivity,
		MANUAL_DEVICE,
		saveActivityConfig,
		saveActivityDay,
		saveActivityGoals,
		watchActivity,
		watchActivityConfig,
		watchActivityGoals,
		type ActivityConfig,
		type ActivityDayDoc
	} from '$lib/db';
	import {
		desktop,
		type ActivityPatch,
		type ActivitySpan,
		type ActivityStatus
	} from '$lib/desktop';
	import { dayHref } from '$lib/nav';
	import { saveFailed, toast } from '$lib/toast.svelte';

	/** Days of history behind the selected day, for averages and best hours. */
	const HISTORY = 28;
	/** Days in the trend chart. */
	const TREND = 14;

	const uid = $derived(session.user?.uid ?? '');
	let date = $state(dateKey());
	const today = $derived(dateKey());
	const isToday = $derived(date === today);
	const dayLabel = $derived(relativeLabel(date) || humanDate(date));

	// ——— Data: this computer's spans straight from the tracker (freshest), every
	// other computer's and the manual entries from the account.
	let status = $state<ActivityStatus | null>(null);
	let local = $state<Record<string, ActivitySpan[]>>({});
	let localLoaded = $state(!desktop);
	let remote = $state<ActivityDayDoc[]>([]);
	let remoteLoaded = $state(false);
	let config = $state<ActivityConfig>({ categories: {}, defaultGoals: [] });
	let ownGoals = $state<ActivityGoal[] | null>(null);
	const loaded = $derived(localLoaded && remoteLoaded);

	async function refreshLocal() {
		if (!desktop) return;
		const [s, days] = await Promise.all([
			desktop.activityStatus(),
			desktop.activityDays(addDays(date, -HISTORY), date)
		]);
		status = s;
		local = days;
		localLoaded = true;
	}

	$effect(() => {
		void date;
		refreshLocal();
		const timer = setInterval(() => {
			if (date === dateKey()) refreshLocal();
		}, 30_000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (!uid) return;
		return watchActivity(uid, addDays(date, -HISTORY), date, (docs) => {
			remote = docs;
			remoteLoaded = true;
		});
	});
	$effect(() => {
		if (!uid) return;
		return watchActivityConfig(uid, (c) => (config = c));
	});
	$effect(() => {
		if (!uid) return;
		const d = date;
		return watchActivityGoals(uid, d, (g) => (ownGoals = g));
	});

	const thisDevice = $derived(status?.device.id ?? null);
	const manualDocs = $derived(
		Object.fromEntries(
			remote.filter((d) => d.device === MANUAL_DEVICE).map((d) => [d.date, d.spans])
		) as Record<string, ActivitySpan[]>
	);
	/** Every source merged, per day. */
	const raw = $derived.by(() => {
		const out: Record<string, ActivitySpan[]> = {};
		for (const key of dayRange(date, HISTORY + 1)) {
			const tracked = [...(local[key] ?? [])];
			for (const d of remote) {
				if (d.date !== key || d.device === MANUAL_DEVICE) continue;
				// This computer's own doc only fills in days the tracker no longer keeps.
				if (d.device === thisDevice && key in local) continue;
				tracked.push(...d.spans);
			}
			const merged = mergeSources(tracked, manualDocs[key] ?? []);
			if (merged.length) out[key] = merged;
		}
		return out;
	});
	const devices = $derived(
		[...new Set(remote.filter((d) => d.device !== MANUAL_DEVICE).map((d) => d.deviceName))].filter(
			Boolean
		)
	);

	async function update(patch: ActivityPatch) {
		if (!desktop) return;
		status = await desktop.setActivity(patch);
		refreshLocal();
	}

	async function clearAll() {
		try {
			await desktop?.clearActivity();
			forgetSynced(uid);
			await deleteAllActivity(uid);
			toast('Activity history deleted');
		} catch {
			saveFailed();
		}
		refreshLocal();
	}

	const overrides = $derived(config.categories);
	const history = $derived(
		dayRange(date, HISTORY + 1).map((k) => summarizeDay(k, raw[k] ?? [], overrides))
	);
	const day = $derived(history[history.length - 1]);
	const base = $derived(baseline(history.slice(0, -1)));
	const notes = $derived(insights(day, base, isToday));
	const best = $derived(bestFocusWindow(base.focusByHour));
	const focusPeak = $derived(Math.max(...base.focusByHour, 1));
	const hasAnyData = $derived(Object.keys(raw).length > 0);

	// ——— Headline numbers, each against the daily average.
	const HOUR = 3_600_000;
	const tiles = $derived.by(() => {
		const compare = base.days >= 3 && !isToday;
		const vs = (now: number, avg: number, higherIsGood: boolean | null) => {
			if (!compare || avg <= 0) return null;
			const d = (now - avg) / avg;
			if (Math.abs(d) < 0.05) return { text: 'about usual', tone: 'flat' as const };
			const good = higherIsGood === null ? null : d > 0 === higherIsGood;
			return {
				text: `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}% vs avg`,
				tone: good === null ? ('flat' as const) : good ? ('up' as const) : ('down' as const)
			};
		};
		const perHour = (switches: number, active: number) =>
			active > 0 ? switches / Math.max(active / HOUR, 0.25) : 0;
		const share = day.active > 0 ? day.byCategory.focus / day.active : 0;
		const baseShare = base.active > 0 ? base.byCategory.focus / base.active : 0;
		return [
			{
				label: 'Active time',
				value: formatDuration(day.active),
				sub: day.first ? `${formatTime(day.first)} – ${formatTime(day.last!)}` : '',
				delta: vs(day.active, base.active, null)
			},
			{
				label: 'Deep work',
				value: formatDuration(day.deepWork),
				sub: 'sessions of 25 min+',
				delta: vs(day.deepWork, base.deepWork, true)
			},
			{
				label: 'Focus share',
				value: `${Math.round(share * 100)}%`,
				sub: `${formatDuration(day.byCategory.focus)} in focus apps`,
				delta: vs(share, baseShare, true)
			},
			{
				label: 'Switches / hour',
				value: String(Math.round(perHour(day.switches, day.active))),
				sub: `${day.switches} in total`,
				delta: vs(perHour(day.switches, day.active), perHour(base.switches, base.active), false)
			},
			{
				label: 'Longest focus',
				value: formatDuration(day.longest?.ms ?? 0),
				sub: day.longest ? `${formatTime(day.longest.start)} · ${day.longest.top}` : '—',
				delta: null
			}
		];
	});

	// ——— Apps and sites.
	let showAll = $state(false);
	let expanded = $state<string | null>(null);
	const subjects = $derived(showAll ? day.subjects : day.subjects.slice(0, 10));

	/** Everything seen in the last weeks (most used first), for goals and manual entries. */
	const known = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this derivation
		const totals = new Map<string, { key: string; label: string; ms: number }>();
		for (const d of history) {
			for (const s of d.subjects) {
				const t = totals.get(s.key) ?? { key: s.key, label: s.label, ms: 0 };
				t.ms += s.ms;
				totals.set(s.key, t);
			}
		}
		return [...totals.values()].sort((a, b) => b.ms - a.ms);
	});
	const topMs = $derived(day.subjects[0]?.ms ?? 1);

	/** A subject's category: the user's pick, else the built-in guess. */
	function categoryOf(key: string, label = key.slice(key.indexOf(':') + 1)): ActivityCategory {
		const subject: Subject = { key, label };
		const name = key.slice(key.indexOf(':') + 1);
		return overrides[key] ?? defaultCategory(subject, { exe: name, app: label });
	}

	function setCategory(subject: Subject, category: ActivityCategory) {
		const next = { ...overrides };
		// Picking the built-in guess again drops the override, so better defaults still apply later.
		const name = subject.key.slice(subject.key.indexOf(':') + 1);
		if (category === defaultCategory(subject, { exe: name, app: subject.label })) {
			delete next[subject.key];
		} else next[subject.key] = category;
		if (JSON.stringify(next) === JSON.stringify(overrides)) return;
		saveActivityConfig(uid, { categories: next }).catch(saveFailed);
	}

	// ——— Goals and manual entries.
	const goals = $derived(ownGoals ?? config.defaultGoals);

	async function saveGoals(next: ActivityGoal[], asDefault: boolean) {
		try {
			if (asDefault) {
				await Promise.all([
					saveActivityConfig(uid, { defaultGoals: next }),
					ownGoals ? saveActivityGoals(uid, date, null) : null
				]);
			} else await saveActivityGoals(uid, date, next);
		} catch {
			saveFailed();
		}
	}

	async function saveManual(spans: ActivitySpan[]) {
		await saveActivityDay(uid, {
			date,
			device: MANUAL_DEVICE,
			deviceName: 'Added by hand',
			spans
		}).catch(saveFailed);
	}

	function addManual(span: ActivitySpan, category: ActivityCategory) {
		setCategory({ key: span.subject!, label: span.app }, category);
		saveManual([...(manualDocs[date] ?? []), span]);
	}

	function deleteManual(id: string) {
		saveManual((manualDocs[date] ?? []).filter((s) => s.id !== id));
	}

	// ——— Live status line.
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(timer);
	});

	const PAUSES: [number, string][] = [
		[30, '30m'],
		[60, '1h'],
		[180, '3h']
	];

	function pause(ms: number) {
		update({ pausedUntil: Date.now() + ms });
	}

	async function logToDay() {
		if (!session.user) return;
		try {
			await appendToDay(session.user.uid, { date, line: summaryLine(day) });
			toast(`Added to ${relativeLabel(date) || humanDate(date)}`);
		} catch {
			saveFailed();
		}
	}

	const TONE_ICON = { good: 'check', warn: 'bolt', info: 'clock' } as const;
	const TONE_CLASS = {
		good: 'text-[var(--t-up)]',
		warn: 'text-amber-600 dark:text-amber-400',
		info: 'text-accent'
	};
</script>

<svelte:head>
	<title>Activity · daylog</title>
</svelte:head>

<div class="flex flex-wrap items-end gap-x-4 gap-y-2">
	<div>
		<h1 class="font-display text-2xl font-bold tracking-tight text-ink">Activity</h1>
		<p class="mt-1 text-sm text-mute">
			Where your computer time actually goes — apps, sites, focus and switching.
		</p>
	</div>
	{#if loaded}
		<div class="ml-auto flex items-center gap-1">
			<button
				type="button"
				onclick={() => (date = addDays(date, -1))}
				aria-label="Previous day"
				class="grid h-8 w-8 place-items-center rounded-ctl text-mute hover:bg-tint hover:text-ink"
			>
				<Icon name="chevronLeft" size={16} />
			</button>
			<span class="min-w-40 text-center text-sm font-medium text-ink">
				{relativeLabel(date) || humanDate(date)}
			</span>
			<button
				type="button"
				onclick={() => (date = addDays(date, 1))}
				disabled={isToday}
				aria-label="Next day"
				class="grid h-8 w-8 place-items-center rounded-ctl text-mute hover:bg-tint hover:text-ink disabled:opacity-30"
			>
				<Icon name="chevronRight" size={16} />
			</button>
			{#if !isToday}
				<button
					type="button"
					onclick={() => (date = today)}
					class="ml-1 rounded-ctl border border-line px-2.5 py-1 text-sm text-mute hover:bg-tint hover:text-ink"
				>
					Today
				</button>
			{/if}
		</div>
	{/if}
</div>

{#if !loaded}
	<p class="mt-6 text-sm text-faint">loading…</p>
{:else}
	{#if !desktop}
		<p class="mt-3 max-w-3xl text-sm text-mute">
			Recording happens in the daylog desktop app (a browser tab can't see other apps){devices.length
				? ` — this shows what ${devices.join(', ')} synced`
				: ''}. You can set goals and add time by hand here.
		</p>
	{:else if status && !status.enabled && !hasAnyData}
		<section class="mt-5 max-w-2xl rounded-card border border-line bg-card p-5 shadow-card">
			<h2 class="font-display text-base font-semibold text-ink">See where your day really goes</h2>
			<ul class="mt-3 space-y-1.5 text-sm text-mute">
				<li>• Which apps and websites take your time, hour by hour</li>
				<li>• Daily goals — “4h of focus”, “YouTube under 30m” — that fill up as you work</li>
				<li>• Deep work: stretches of 25+ minutes in focus apps, and what breaks them</li>
				<li>• How often you switch, your biggest distractions, and your sharpest hours</li>
			</ul>
			<p class="mt-3 text-xs text-faint">
				It syncs to your account, so you can check it from your phone. Idle and locked time isn't
				counted (videos and calls still are), you can pause any time from here or the tray, and
				leave out apps you'd rather not record.
			</p>
			<button
				type="button"
				onclick={() => update({ enabled: true })}
				class="mt-4 rounded-ctl bg-accent-fill px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
			>
				Start tracking
			</button>
		</section>
	{/if}

	{#if desktop && status && (status.enabled || hasAnyData)}
		<!-- Live status -->
		<div
			class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-card px-4 py-2.5 text-sm shadow-card"
		>
			{#if !status.enabled}
				<span class="h-2 w-2 rounded-full bg-[var(--t-faint)]"></span>
				<span class="text-mute">Tracking is off — showing what was recorded before.</span>
				<button
					type="button"
					onclick={() => update({ enabled: true })}
					class="ml-auto rounded-ctl px-2.5 py-1 font-medium text-accent hover:bg-tint"
					>Turn on</button
				>
			{:else if status.pausedUntil}
				<span class="h-2 w-2 rounded-full bg-amber-500"></span>
				<span class="text-mute">Paused until {formatTime(status.pausedUntil)}</span>
				<button
					type="button"
					onclick={() => update({ pausedUntil: 0 })}
					class="ml-auto rounded-ctl px-2.5 py-1 font-medium text-accent hover:bg-tint"
					>Resume</button
				>
			{:else}
				<span class="relative flex h-2 w-2">
					<span class="absolute inset-0 animate-ping rounded-full bg-[var(--t-up)] opacity-60"
					></span>
					<span class="h-2 w-2 rounded-full bg-[var(--t-up)]"></span>
				</span>
				{#if status.error}
					<span class="text-amber-600 dark:text-amber-400">{status.error}</span>
				{:else if status.current}
					<span class="min-w-0 truncate text-mute">
						Now: <span class="font-medium text-ink">{status.current.app}</span>
						<span class="text-faint">· {formatDuration(now - status.current.since)}</span>
					</span>
				{:else}
					<span class="text-mute">Tracking — idle right now</span>
				{/if}
				<span class="ml-auto flex items-center gap-1 text-xs">
					<span class="text-faint">Pause</span>
					{#each PAUSES as [m, label] (m)}
						<button
							type="button"
							onclick={() => pause(m * 60_000)}
							class="rounded-ctl border border-line px-2 py-0.5 text-mute hover:bg-tint hover:text-ink"
							>{label}</button
						>
					{/each}
				</span>
			{/if}
		</div>
	{/if}

	<div class="mt-4 grid items-start gap-4 lg:grid-cols-2">
		<ActivityGoals
			{goals}
			own={ownGoals !== null}
			{day}
			{isToday}
			{dayLabel}
			options={known}
			onsave={saveGoals}
			onreset={() => saveActivityGoals(uid, date, null).catch(saveFailed)}
		/>
		<ActivityManual
			{date}
			entries={manualDocs[date] ?? []}
			options={known}
			{categoryOf}
			onadd={addManual}
			ondelete={deleteManual}
		/>
	</div>

	{#if day.active === 0}
		<p class="mt-6 text-sm text-faint">
			{isToday
				? 'Nothing recorded yet today — it fills in as you work.'
				: 'Nothing recorded on this day.'}
		</p>
	{:else}
		<!-- Headline numbers -->
		<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
			{#each tiles as tile (tile.label)}
				<div class="rounded-card border border-line bg-card p-3.5 shadow-card">
					<p class="text-xs font-medium text-mute">{tile.label}</p>
					<p class="mt-1 font-display text-2xl font-semibold text-ink tabular-nums">{tile.value}</p>
					<p class="mt-0.5 truncate text-xs text-faint" title={tile.sub}>{tile.sub}</p>
					{#if tile.delta}
						<p
							class="mt-1 text-xs font-medium tabular-nums {tile.delta.tone === 'up'
								? 'text-[var(--t-up)]'
								: tile.delta.tone === 'down'
									? 'text-[var(--t-down)]'
									: 'text-mute'}"
						>
							{tile.delta.text}
						</p>
					{/if}
				</div>
			{/each}
		</div>

		<div class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
			<div class="space-y-4">
				<!-- The day -->
				<section class="rounded-card border border-line bg-card p-4 shadow-card">
					<div class="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
						<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Hour by hour</h2>
						<span class="ml-auto flex flex-wrap gap-3 text-xs text-mute">
							{#each CATEGORIES as c (c)}
								<span class="flex items-center gap-1.5">
									<span class="h-2.5 w-2.5 rounded-[3px]" style:background={CATEGORY_COLOR[c]}
									></span>
									{CATEGORY_LABEL[c]}
								</span>
							{/each}
						</span>
					</div>
					<ActivityDayChart {day} spans={raw[date] ?? []} {overrides} />
				</section>

				<!-- Apps and sites -->
				<section class="rounded-card border border-line bg-card p-4 shadow-card">
					<div class="mb-3 flex items-baseline">
						<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Apps & sites</h2>
						<span class="ml-auto text-xs text-faint">pick a category to teach it</span>
					</div>
					<ul class="space-y-1">
						{#each subjects as s (s.key)}
							<li>
								<div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3">
									<button
										type="button"
										onclick={() => (expanded = expanded === s.key ? null : s.key)}
										disabled={s.titles.length === 0}
										class="min-w-0 rounded-ctl px-1.5 py-1 text-left enabled:hover:bg-tint"
									>
										<span class="flex items-baseline gap-2 text-sm">
											<span class="truncate font-medium text-ink">{s.label}</span>
											{#if s.via}<span class="shrink-0 text-xs text-faint">{s.via}</span>{/if}
										</span>
										<span class="mt-1 block h-1.5 rounded-full bg-tint">
											<span
												class="block h-1.5 rounded-full"
												style:width="{Math.max(1, (s.ms / topMs) * 100)}%"
												style:background={CATEGORY_COLOR[s.category]}
											></span>
										</span>
									</button>
									<span class="text-right text-sm text-ink tabular-nums">
										{formatDuration(s.ms)}
										<span class="block text-[11px] text-faint">
											{Math.round((s.ms / day.active) * 100)}%
										</span>
									</span>
									<select
										value={s.category}
										onchange={(e) => setCategory(s, e.currentTarget.value as ActivityCategory)}
										aria-label="Category for {s.label}"
										class="rounded-ctl border-line bg-card py-1 pr-7 pl-2 text-xs text-mute"
									>
										{#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_LABEL[c]}</option>{/each}
									</select>
								</div>
								{#if expanded === s.key}
									<ul class="mt-1 mb-2 ml-3 space-y-0.5 border-l border-line pl-3">
										{#each s.titles as t (t.title)}
											<li class="flex gap-3 text-xs">
												<span class="min-w-0 flex-1 truncate text-mute" title={t.title}
													>{t.title}</span
												>
												<span class="text-faint tabular-nums">{formatDuration(t.ms)}</span>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
					{#if day.subjects.length > 10}
						<button
							type="button"
							onclick={() => (showAll = !showAll)}
							class="mt-2 text-xs font-medium text-accent hover:underline"
						>
							{showAll ? 'Show fewer' : `Show all ${day.subjects.length}`}
						</button>
					{/if}
				</section>
			</div>

			<div class="space-y-4">
				<!-- Insights -->
				<section class="rounded-card border border-line bg-card p-4 shadow-card">
					<div class="mb-3 flex items-baseline">
						<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Insights</h2>
						<button
							type="button"
							onclick={logToDay}
							class="ml-auto text-xs font-medium text-accent hover:underline"
							title={summaryLine(day)}
						>
							Add summary to the day page
						</button>
					</div>
					{#if notes.length}
						<ul class="space-y-2.5">
							{#each notes as note, i (i)}
								<li class="flex gap-2.5 text-sm leading-snug text-ink">
									<Icon
										name={TONE_ICON[note.tone]}
										size={15}
										class="mt-0.5 shrink-0 {TONE_CLASS[note.tone]}"
									/>
									<span>{note.text}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-sm text-faint">Not enough activity on this day for insights yet.</p>
					{/if}
					{#if base.days < 3}
						<p class="mt-3 text-xs text-faint">
							Comparisons with your usual days start after three days of history.
						</p>
					{/if}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- dayHref uses resolve() -->
					<a href={dayHref(date)} class="mt-3 inline-block text-xs text-mute hover:text-ink">
						Open {relativeLabel(date) || humanDate(date)}'s page →
					</a>
				</section>

				<!-- Focus sessions -->
				{#if day.sessions.length}
					<section class="rounded-card border border-line bg-card p-4 shadow-card">
						<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">
							Focus sessions
						</h2>
						<ul class="space-y-1.5">
							{#each day.sessions.filter((s) => s.ms >= 5 * 60_000) as s (s.start)}
								<li class="flex items-baseline gap-3 text-sm">
									<span class="w-36 shrink-0 whitespace-nowrap text-faint tabular-nums">
										{formatTime(s.start)} – {formatTime(s.end)}
									</span>
									<span class="min-w-0 flex-1 truncate text-ink">{s.top}</span>
									<span
										class="tabular-nums {s.ms >= 25 * 60_000
											? 'font-semibold text-ink'
											: 'text-mute'}">{formatDuration(s.ms)}</span
									>
								</li>
							{/each}
						</ul>
						<p class="mt-2 text-xs text-faint">
							Detours under 2 minutes don't break a session. Bold ones count as deep work.
						</p>
					</section>
				{/if}

				<!-- Rhythm -->
				{#if base.days >= 3}
					<section class="rounded-card border border-line bg-card p-4 shadow-card">
						<h2 class="mb-1 text-xs font-semibold tracking-wide text-mute uppercase">
							Your focus rhythm
						</h2>
						<p class="mb-3 text-xs text-faint">
							Average focus time per hour over the last {base.days} active days{best
								? ` — best ${hourLabel(best.hour)}–${hourLabel(best.hour + 2)}`
								: ''}.
						</p>
						<div class="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]">
							{#each base.focusByHour as ms, h (h)}
								{@const label = `${hourLabel(h)}: ${formatDuration(ms)} of focus on average`}
								<span
									title={label}
									aria-label={label}
									class="aspect-square rounded-[3px] {best &&
									(h === best.hour || h === best.hour + 1)
										? 'ring-1 ring-ink/40'
										: ''}"
									style:background={ms > 0
										? `color-mix(in oklab, var(--t-cat-3) ${Math.round(15 + (ms / focusPeak) * 85)}%, var(--t-tint))`
										: 'var(--t-tint)'}
								></span>
							{/each}
						</div>
						<div class="mt-1 flex justify-between text-[10px] text-faint">
							<span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span
								>11 PM</span
							>
						</div>
					</section>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Trend -->
	{#if hasAnyData}
		<section class="mt-4 rounded-card border border-line bg-card p-4 shadow-card">
			<div class="mb-2 flex flex-wrap items-baseline gap-x-4">
				<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">
					Last {TREND} days
				</h2>
				<span class="ml-auto text-xs text-faint">click a day to open it</span>
			</div>
			<ActivityDaysChart
				days={history.slice(-TREND)}
				selected={date}
				onselect={(d) => (date = d)}
			/>
		</section>
	{/if}

	{#if desktop && status}
		<div class="mt-4 max-w-3xl">
			<ActivitySettings {status} {update} clear={clearAll} />
		</div>
	{/if}
{/if}
