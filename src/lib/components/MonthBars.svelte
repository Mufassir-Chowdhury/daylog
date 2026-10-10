<script lang="ts">
	import { barPath, niceScale } from '$lib/chart';
	import { formatMoney, monthLabel, shortMoney, shortMonthLabel } from '$lib/finance';
	import ChartTooltip from './ChartTooltip.svelte';

	/** Single-series monthly columns — one category's (or person's) history. */
	let {
		rows,
		color = 'var(--t-cat-1)',
		label
	}: {
		rows: { month: string; amount: number; count: number }[];
		color?: string;
		/** What the series is, for screen readers ("lunch spending"). */
		label: string;
	} = $props();

	let hovered: number | null = $state(null);

	const W = 560;
	const H = 150;
	const M = { top: 16, right: 6, bottom: 22, left: 46 };
	const plotW = W - M.left - M.right;
	const plotH = H - M.top - M.bottom;

	const scale = $derived(niceScale(0, Math.max(...rows.map((r) => r.amount)), 3));
	const y = (v: number) => M.top + plotH - (v / scale.max) * plotH;
	const groupW = $derived(plotW / rows.length);
	const barW = $derived(Math.min(24, groupW - 6));
	const cx = (i: number) => M.left + groupW * i + groupW / 2;
	const peak = $derived(rows.reduce((best, r, i) => (r.amount > rows[best].amount ? i : best), 0));
</script>

<div class="relative">
	<svg viewBox="0 0 {W} {H}" class="h-auto w-full" role="img" aria-label="{label} per month">
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
		{#each rows as r, i (r.month)}
			{#if hovered === i}
				<rect
					x={cx(i) - groupW / 2 + 1}
					y={M.top}
					width={groupW - 2}
					height={plotH}
					fill="var(--t-tint)"
					rx="4"
				/>
			{/if}
			<path d={barPath(cx(i) - barW / 2, barW, y(0), y(r.amount))} fill={color} />
			{#if i === peak && r.amount > 0}
				<!-- Label only the peak; the tooltip carries the rest. -->
				<text
					x={cx(i)}
					y={y(r.amount) - 4}
					text-anchor="middle"
					font-size="10"
					fill="var(--t-mute)"
					style="font-variant-numeric: tabular-nums"
				>
					{shortMoney(r.amount)}
				</text>
			{/if}
			{#if i % 2 === rows.length % 2 || rows.length <= 7}
				<text x={cx(i)} y={H - 6} text-anchor="middle" font-size="10" fill="var(--t-faint)">
					{shortMonthLabel(r.month)}
				</text>
			{/if}
			<rect
				x={cx(i) - groupW / 2}
				y={M.top}
				width={groupW}
				height={plotH + M.bottom}
				fill="transparent"
				role="img"
				aria-label="{monthLabel(r.month)}: {formatMoney(r.amount)}"
				onpointerenter={() => (hovered = i)}
				onpointerleave={() => (hovered = null)}
			/>
		{/each}
		<line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--t-faint)" />
	</svg>
	{#if hovered !== null}
		{@const r = rows[hovered]}
		<ChartTooltip x={(cx(hovered) / W) * 100} y={4}>
			<p class="font-medium text-mute">{monthLabel(r.month)}</p>
			<p class="font-semibold text-ink tabular-nums">{formatMoney(r.amount)}</p>
			<p class="text-faint">{r.count} transaction{r.count === 1 ? '' : 's'}</p>
		</ChartTooltip>
	{/if}
</div>
