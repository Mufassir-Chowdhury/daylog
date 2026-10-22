<script lang="ts">
	import {
		CATEGORIES,
		CATEGORY_COLOR,
		CATEGORY_LABEL,
		formatDuration,
		type DaySummary
	} from '$lib/activity';
	import { barPath, niceScale } from '$lib/chart';
	import { fromKey } from '$lib/date';
	import ChartTooltip from './ChartTooltip.svelte';

	/** Stacked time per day by category; click a column to open that day. */
	let {
		days,
		selected,
		onselect
	}: { days: DaySummary[]; selected: string; onselect: (date: string) => void } = $props();

	const W = 1100;
	const H = 190;
	const M = { top: 12, right: 6, bottom: 22, left: 34 };
	const plotW = W - M.left - M.right;
	const plotH = H - M.top - M.bottom;
	const HOUR = 3_600_000;

	const scale = $derived(niceScale(0, Math.max(1, ...days.map((d) => d.active / HOUR)), 3));
	const y = (ms: number) => M.top + plotH - (ms / HOUR / scale.max) * plotH;
	const colW = $derived(plotW / days.length);
	const barW = $derived(Math.min(28, colW - 8));
	const cx = (i: number) => M.left + colW * i + colW / 2;

	const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
	const LONG = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	});

	let hovered: number | null = $state(null);
</script>

<div class="relative">
	<svg viewBox="0 0 {W} {H}" class="h-auto w-full" role="img" aria-label="Time per day by category">
		{#each scale.ticks as tick (tick)}
			<line
				x1={M.left}
				x2={W - M.right}
				y1={y(tick * HOUR)}
				y2={y(tick * HOUR)}
				stroke="var(--t-line)"
			/>
			<text
				x={M.left - 5}
				y={y(tick * HOUR) + 3.5}
				text-anchor="end"
				font-size="10"
				fill="var(--t-faint)">{tick}h</text
			>
		{/each}
		{#each days as d, i (d.date)}
			{@const stack = CATEGORIES.filter((c) => d.byCategory[c] > 0)}
			{#if hovered === i || selected === d.date}
				<rect
					x={cx(i) - colW / 2 + 1}
					y={M.top}
					width={colW - 2}
					height={plotH}
					fill="var(--t-tint)"
					stroke={selected === d.date ? 'var(--t-accent)' : 'none'}
					stroke-opacity="0.5"
					rx="4"
				/>
			{/if}
			{#each stack as c, j (c)}
				{@const below = stack.slice(0, j).reduce((sum, k) => sum + d.byCategory[k], 0)}
				{@const base = y(below) - (j > 0 ? 1 : 0)}
				{@const top = y(below + d.byCategory[c]) + (j < stack.length - 1 ? 1 : 0)}
				{#if base - top > 0.5}
					{#if j === stack.length - 1}
						<path d={barPath(cx(i) - barW / 2, barW, base, top)} fill={CATEGORY_COLOR[c]} />
					{:else}
						<rect
							x={cx(i) - barW / 2}
							y={top}
							width={barW}
							height={base - top}
							fill={CATEGORY_COLOR[c]}
						/>
					{/if}
				{/if}
			{/each}
			<text
				x={cx(i)}
				y={H - 6}
				text-anchor="middle"
				font-size="10"
				fill={selected === d.date ? 'var(--t-ink)' : 'var(--t-faint)'}
				font-weight={selected === d.date ? 600 : 400}
			>
				{WEEKDAY.format(fromKey(d.date))}
				{fromKey(d.date).getDate()}
			</text>
			<rect
				x={cx(i) - colW / 2}
				y={M.top}
				width={colW}
				height={plotH + M.bottom}
				fill="transparent"
				role="button"
				tabindex="0"
				aria-label="{LONG.format(fromKey(d.date))}: {formatDuration(d.active)}"
				class="cursor-pointer outline-none"
				onclick={() => onselect(d.date)}
				onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onselect(d.date)}
				onpointerenter={() => (hovered = i)}
				onpointerleave={() => (hovered = null)}
			/>
		{/each}
		<line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--t-faint)" />
	</svg>
	{#if hovered !== null}
		{@const d = days[hovered]}
		<ChartTooltip x={(cx(hovered) / W) * 100} y={4}>
			<p class="font-medium text-mute">{LONG.format(fromKey(d.date))}</p>
			<p class="font-semibold text-ink tabular-nums">{formatDuration(d.active)} active</p>
			{#each CATEGORIES.toReversed() as c (c)}
				{#if d.byCategory[c] > 0}
					<p class="flex items-center gap-2">
						<span class="h-2 w-2 rounded-full" style:background={CATEGORY_COLOR[c]}></span>
						<span class="text-mute">{CATEGORY_LABEL[c]}</span>
						<span class="ml-auto text-ink tabular-nums">{formatDuration(d.byCategory[c])}</span>
					</p>
				{/if}
			{/each}
			{#if d.deepWork > 0}
				<p class="mt-1 text-faint">deep work {formatDuration(d.deepWork)}</p>
			{/if}
		</ChartTooltip>
	{/if}
</div>
