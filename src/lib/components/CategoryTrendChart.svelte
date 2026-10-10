<script lang="ts">
	import { barPath, niceScale } from '$lib/chart';
	import { dateKey, monthOf, monthsEnding } from '$lib/date';
	import type { Transaction } from '$lib/db';
	import {
		categoryColor,
		categoryTrend,
		formatMoney,
		monthLabel,
		OTHER,
		PERCENT,
		shortMoney,
		shortMonthLabel
	} from '$lib/finance';
	import ChartTooltip from './ChartTooltip.svelte';

	type Kind = 'expense' | 'income';

	let {
		txns,
		onselect
	}: {
		txns: Transaction[];
		onselect?: (category: string, kind: Kind) => void;
	} = $props();

	let kind: Kind = $state('expense');
	let range: 6 | 12 = $state(6);
	let hovered: { i: number; category: string } | null = $state(null);

	const months = $derived(monthsEnding(monthOf(dateKey()), range));
	const trend = $derived(categoryTrend(txns, kind, months, 5));
	const allCategories = $derived([
		...new Set(txns.filter((t) => t.kind === kind).map((t) => t.category))
	]);
	const colorOf = (c: string) => categoryColor(c, allCategories);
	const hasData = $derived(trend.rows.some((r) => r.total > 0));

	const W = 640;
	const H = 220;
	const M = { top: 10, right: 8, bottom: 26, left: 52 };
	const plotW = W - M.left - M.right;
	const plotH = H - M.top - M.bottom;
	const GAP = 2;

	const scale = $derived(niceScale(0, Math.max(...trend.rows.map((r) => r.total))));
	const y = (v: number) => M.top + plotH - (v / scale.max) * plotH;
	const groupW = $derived(plotW / months.length);
	const barW = $derived(Math.min(24, groupW - 10));
	const cx = (i: number) => M.left + groupW * i + groupW / 2;

	/** Stacked segments bottom-up, largest category at the base; a 2px surface gap between each. */
	const stacks = $derived(
		trend.rows.map((row) => {
			let acc = 0;
			const present = trend.categories.filter((c) => row.values[c] > 0);
			return present.map((c, j) => {
				const base = y(acc) - (j > 0 ? GAP / 2 : 0);
				acc += row.values[c];
				const top = y(acc) + (j < present.length - 1 ? GAP / 2 : 0);
				return { category: c, value: row.values[c], base, top, last: j === present.length - 1 };
			});
		})
	);

	const KINDS: { value: Kind; label: string }[] = [
		{ value: 'expense', label: 'Spending' },
		{ value: 'income', label: 'Income' }
	];
</script>

<div class="mb-3 flex flex-wrap items-center gap-2">
	<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Category trend</h2>
	<div class="ml-auto flex items-center gap-2">
		<div class="flex overflow-hidden rounded-ctl border border-line text-xs">
			{#each KINDS as k (k.value)}
				<button
					type="button"
					onclick={() => (kind = k.value)}
					aria-pressed={kind === k.value}
					class="border-r border-line px-2 py-1 last:border-r-0 {kind === k.value
						? 'bg-accent-fill text-on-accent'
						: 'bg-card text-mute hover:bg-tint'}"
				>
					{k.label}
				</button>
			{/each}
		</div>
		<div class="flex overflow-hidden rounded-ctl border border-line text-xs">
			{#each [6, 12] as const as r (r)}
				<button
					type="button"
					onclick={() => (range = r)}
					aria-pressed={range === r}
					class="border-r border-line px-2 py-1 last:border-r-0 {range === r
						? 'bg-accent-fill text-on-accent'
						: 'bg-card text-mute hover:bg-tint'}"
				>
					{r}M
				</button>
			{/each}
		</div>
	</div>
</div>

{#if !hasData}
	<p class="py-10 text-center text-sm text-faint">
		No {kind === 'income' ? 'income' : 'spending'} in the last {range} months.
	</p>
{:else}
	<div class="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-mute">
		{#each trend.categories as c (c)}
			<button
				type="button"
				disabled={c === OTHER}
				onclick={() => onselect?.(c, kind)}
				class="flex items-center gap-1.5 enabled:hover:text-ink enabled:hover:underline"
			>
				<span class="h-2.5 w-2.5 rounded-sm" style:background={colorOf(c)}></span>
				{c === OTHER ? 'other' : c}
			</button>
		{/each}
	</div>
	<div class="relative">
		<svg
			viewBox="0 0 {W} {H}"
			class="h-auto w-full"
			role="img"
			aria-label="Top categories per month"
		>
			{#each scale.ticks as tick (tick)}
				<line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--t-line)" />
				<text
					x={M.left - 6}
					y={y(tick) + 3.5}
					text-anchor="end"
					font-size="10"
					fill="var(--t-faint)"
					style="font-variant-numeric: tabular-nums"
				>
					{shortMoney(tick)}
				</text>
			{/each}
			{#each stacks as segments, i (months[i])}
				{#each segments as seg (seg.category)}
					{@const active = hovered?.i === i && hovered.category === seg.category}
					{#if seg.base - seg.top > 0}
						<path
							d={seg.last
								? barPath(cx(i) - barW / 2, barW, seg.base, seg.top)
								: `M${cx(i) - barW / 2},${seg.base}h${barW}V${seg.top}h${-barW}z`}
							fill={colorOf(seg.category)}
							opacity={hovered && !active ? 0.55 : 1}
							role="button"
							tabindex="0"
							aria-label="{monthLabel(months[i])}, {seg.category === OTHER
								? 'other'
								: seg.category}: {formatMoney(seg.value)}"
							class="cursor-pointer outline-none"
							onpointerenter={() => (hovered = { i, category: seg.category })}
							onpointerleave={() => (hovered = null)}
							onfocus={() => (hovered = { i, category: seg.category })}
							onblur={() => (hovered = null)}
							onclick={() => seg.category !== OTHER && onselect?.(seg.category, kind)}
							onkeydown={(e) => {
								if ((e.key === 'Enter' || e.key === ' ') && seg.category !== OTHER) {
									e.preventDefault();
									onselect?.(seg.category, kind);
								}
							}}
						/>
					{/if}
				{/each}
				<text x={cx(i)} y={H - 8} text-anchor="middle" font-size="10" fill="var(--t-faint)">
					{shortMonthLabel(months[i])}
				</text>
			{/each}
			<line
				x1={M.left}
				x2={W - M.right}
				y1={M.top + plotH}
				y2={M.top + plotH}
				stroke="var(--t-faint)"
			/>
		</svg>
		{#if hovered}
			{@const row = trend.rows[hovered.i]}
			{@const value = row.values[hovered.category]}
			<ChartTooltip x={(cx(hovered.i) / W) * 100} y={8}>
				<p class="mb-1 font-medium text-mute">{monthLabel(row.month)}</p>
				<p class="flex items-center gap-2">
					<span class="h-0.5 w-3 shrink-0 rounded-full" style:background={colorOf(hovered.category)}
					></span>
					<span class="text-mute">{hovered.category === OTHER ? 'other' : hovered.category}</span>
					<span class="ml-auto pl-3 font-semibold text-ink tabular-nums">{formatMoney(value)}</span>
				</p>
				<p class="mt-1 text-faint">
					{PERCENT.format(value / row.total)} of {formatMoney(row.total)}
				</p>
			</ChartTooltip>
		{/if}
	</div>
{/if}
