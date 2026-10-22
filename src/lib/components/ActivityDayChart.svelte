<script lang="ts">
	import {
		CATEGORIES,
		CATEGORY_COLOR,
		CATEGORY_LABEL,
		categorize,
		formatDuration,
		formatTime,
		hourLabel,
		subjectOf,
		type ActivitySpan,
		type DaySummary,
		type Overrides
	} from '$lib/activity';
	import { barPath } from '$lib/chart';
	import { fromKey } from '$lib/date';
	import ChartTooltip from './ChartTooltip.svelte';

	/** One day: stacked minutes per hour, and every span as a strip underneath. */
	let { day, spans, overrides }: { day: DaySummary; spans: ActivitySpan[]; overrides: Overrides } =
		$props();

	const W = 720;
	const M = { top: 12, right: 6, bottom: 20, left: 30 };
	const BARS_H = 110;
	const STRIP_Y = M.top + BARS_H + 24;
	const STRIP_H = 22;
	const H = STRIP_Y + STRIP_H + M.bottom;
	const plotW = W - M.left - M.right;

	// Show the waking part of the day: from the first active hour to the last, at least 8 hours.
	const range = $derived.by(() => {
		const used = day.hours
			.map((h, i) => (CATEGORIES.some((c) => h[c] > 0) ? i : -1))
			.filter((i) => i >= 0);
		let from = used[0] ?? 8;
		let to = (used[used.length - 1] ?? 17) + 1;
		while (to - from < 8) {
			if (from > 0) from--;
			if (to - from < 8 && to < 24) to++;
		}
		return { from, to };
	});

	const dayStart = $derived(fromKey(day.date).getTime());
	const hours = $derived(range.to - range.from);
	const visibleHours = $derived(Array.from({ length: hours }, (_, i) => range.from + i));
	const colW = $derived(plotW / hours);
	const barW = $derived(Math.max(4, colW - 4));
	const hx = (h: number) => M.left + (h - range.from) * colW;
	/** x for an epoch time, clamped to the visible window. */
	const tx = (t: number) => {
		const h = (t - dayStart) / 3_600_000;
		return M.left + Math.min(Math.max(h - range.from, 0), hours) * colW;
	};
	const y = (ms: number) => M.top + BARS_H - (ms / 3_600_000) * BARS_H;

	const strip = $derived(
		spans
			.filter((s) => s.e > s.s)
			.map((s) => ({ span: s, cat: categorize(s, overrides), x: tx(s.s), w: tx(s.e) - tx(s.s) }))
			.filter((s) => s.w > 0)
	);

	let hoverHour: number | null = $state(null);
	let hoverSpan: number | null = $state(null);
</script>

<div class="relative">
	<svg
		viewBox="0 0 {W} {H}"
		class="h-auto w-full"
		role="img"
		aria-label="Minutes per hour by category, with every app switch as a strip"
	>
		{#each [0, 30, 60] as m (m)}
			<line
				x1={M.left}
				x2={W - M.right}
				y1={y(m * 60_000)}
				y2={y(m * 60_000)}
				stroke="var(--t-line)"
			/>
			<text
				x={M.left - 5}
				y={y(m * 60_000) + 3.5}
				text-anchor="end"
				font-size="10"
				fill="var(--t-faint)">{m}m</text
			>
		{/each}

		{#each visibleHours as h, i (h)}
			{@const bucket = day.hours[h]}
			{@const stack = CATEGORIES.filter((c) => bucket[c] > 0)}
			{#if hoverHour === h}
				<rect
					x={hx(h) + 1}
					y={M.top}
					width={colW - 2}
					height={BARS_H}
					fill="var(--t-tint)"
					rx="4"
				/>
			{/if}
			{#each stack as c, j (c)}
				{@const below = stack.slice(0, j).reduce((sum, k) => sum + bucket[k], 0)}
				{@const base = y(below) - (j > 0 ? 1 : 0)}
				{@const top = y(below + bucket[c]) + (j < stack.length - 1 ? 1 : 0)}
				{#if base - top > 0.5}
					<!-- 2px surface gap between stacked segments; only the top segment is rounded. -->
					{#if j === stack.length - 1}
						<path
							d={barPath(hx(h) + (colW - barW) / 2, barW, base, top)}
							fill={CATEGORY_COLOR[c]}
						/>
					{:else}
						<rect
							x={hx(h) + (colW - barW) / 2}
							y={top}
							width={barW}
							height={base - top}
							fill={CATEGORY_COLOR[c]}
						/>
					{/if}
				{/if}
			{/each}
			{#if i % (hours > 14 ? 2 : 1) === 0}
				<text x={hx(h)} y={M.top + BARS_H + 13} font-size="10" fill="var(--t-faint)"
					>{hourLabel(h)}</text
				>
			{/if}
			<rect
				x={hx(h)}
				y={M.top}
				width={colW}
				height={BARS_H}
				fill="transparent"
				role="img"
				aria-label="{hourLabel(h)}: {formatDuration(CATEGORIES.reduce((s, c) => s + bucket[c], 0))}"
				onpointerenter={() => (hoverHour = h)}
				onpointerleave={() => (hoverHour = null)}
			/>
		{/each}
		<line
			x1={M.left}
			x2={W - M.right}
			y1={M.top + BARS_H}
			y2={M.top + BARS_H}
			stroke="var(--t-faint)"
		/>

		<rect x={M.left} y={STRIP_Y} width={plotW} height={STRIP_H} fill="var(--t-tint)" rx="4" />
		{#each strip as s, i (i)}
			<rect
				x={s.x}
				y={STRIP_Y}
				width={Math.max(s.w, 0.75)}
				height={STRIP_H}
				fill={CATEGORY_COLOR[s.cat]}
				opacity={hoverSpan === null || hoverSpan === i ? 1 : 0.45}
			/>
		{/each}
		{#each strip as s, i (i)}
			<!-- Hit targets wider than the slivers they cover. -->
			<rect
				x={s.x - 2}
				y={STRIP_Y - 4}
				width={Math.max(s.w, 0.75) + 4}
				height={STRIP_H + 8}
				fill="transparent"
				role="img"
				aria-label="{subjectOf(s.span).label}, {formatTime(s.span.s)}–{formatTime(s.span.e)}"
				onpointerenter={() => (hoverSpan = i)}
				onpointerleave={() => (hoverSpan = null)}
			/>
		{/each}
		<text x={M.left} y={H - 4} font-size="10" fill="var(--t-faint)">
			every switch, left to right — hover for details
		</text>
	</svg>

	{#if hoverHour !== null}
		{@const bucket = day.hours[hoverHour]}
		<ChartTooltip x={((hx(hoverHour) + colW / 2) / W) * 100} y={4}>
			<p class="font-medium text-mute">{hourLabel(hoverHour)} – {hourLabel(hoverHour + 1)}</p>
			{#each CATEGORIES.toReversed() as c (c)}
				{#if bucket[c] > 0}
					<p class="flex items-center gap-2">
						<span class="h-2 w-2 rounded-full" style:background={CATEGORY_COLOR[c]}></span>
						<span class="text-mute">{CATEGORY_LABEL[c]}</span>
						<span class="ml-auto font-semibold text-ink tabular-nums"
							>{formatDuration(bucket[c])}</span
						>
					</p>
				{/if}
			{/each}
		</ChartTooltip>
	{/if}
	{#if hoverSpan !== null && strip[hoverSpan]}
		{@const s = strip[hoverSpan]}
		{@const subject = subjectOf(s.span)}
		<ChartTooltip x={((s.x + s.w / 2) / W) * 100} y={STRIP_Y * 0.5}>
			<p class="flex items-center gap-2 font-semibold text-ink">
				<span class="h-2 w-2 shrink-0 rounded-full" style:background={CATEGORY_COLOR[s.cat]}></span>
				{subject.label}
				{#if subject.via}<span class="font-normal text-faint">in {subject.via}</span>{/if}
			</p>
			<p class="text-mute tabular-nums">
				{formatTime(s.span.s)} – {formatTime(s.span.e)} · {formatDuration(s.span.e - s.span.s)}
			</p>
			{#if s.span.title}<p class="mt-1 max-w-64 truncate text-faint">{s.span.title}</p>{/if}
			{#if s.span.manual}<p class="mt-1 text-faint">added by hand</p>{/if}
		</ChartTooltip>
	{/if}
</div>
