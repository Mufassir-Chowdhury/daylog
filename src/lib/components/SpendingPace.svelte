<script lang="ts">
	import { linePath, niceScale } from '$lib/chart';
	import { dateKey, daysInMonth, monthOf, shiftMonth } from '$lib/date';
	import type { Transaction } from '$lib/db';
	import {
		cumulativeSpending,
		fixedVsVariable,
		formatMoney,
		monthLabel,
		shortMoney
	} from '$lib/finance';
	import ChartTooltip from './ChartTooltip.svelte';

	let { txns }: { txns: Transaction[] } = $props();

	const today = dateKey();
	const month = monthOf(today);
	const prev = shiftMonth(month, -1);
	const dayOfMonth = Number(today.slice(8, 10));
	const days = daysInMonth(month);

	const CUR = 'var(--t-cat-1)';
	const PREV = 'var(--t-faint)';

	const cur = $derived(cumulativeSpending(txns, month, dayOfMonth));
	const last = $derived(cumulativeSpending(txns, prev));
	const spent = $derived(cur[dayOfMonth - 1] ?? 0);
	/** Last month's spending by the same day (clamped for shorter months). */
	const lastAtSameDay = $derived(last[Math.min(dayOfMonth, last.length) - 1] ?? 0);
	const lastTotal = $derived(last[last.length - 1] ?? 0);
	/**
	 * Month-end estimate: fixed bills count once (they're usually paid up front),
	 * only variable spending is extrapolated from the daily rate so far.
	 */
	const projected = $derived.by(() => {
		const { fixed } = fixedVsVariable(txns, month);
		return fixed + ((spent - fixed) / dayOfMonth) * days;
	});
	const diff = $derived(spent - lastAtSameDay);

	const W = 640;
	const H = 200;
	const M = { top: 10, right: 10, bottom: 24, left: 52 };
	const plotW = W - M.left - M.right;
	const plotH = H - M.top - M.bottom;
	const n = Math.max(days, 31);

	const scale = $derived(niceScale(0, Math.max(spent, lastTotal)));
	const x = (i: number) => M.left + (i / (n - 1)) * plotW;
	const y = (v: number) => M.top + plotH - (v / scale.max) * plotH;

	const curPath = $derived(linePath(cur.map((v, i) => (v === null ? null : { x: x(i), y: y(v) }))));
	const lastPath = $derived(linePath(last.map((v, i) => ({ x: x(i), y: y(v ?? 0) }))));

	let hovered: number | null = $state(null);

	function onmove(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const ux = ((e.clientX - rect.left) / rect.width) * W;
		hovered = Math.max(0, Math.min(n - 1, Math.round(((ux - M.left) / plotW) * (n - 1))));
	}

	function onkey(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') hovered = Math.min(n - 1, (hovered ?? -1) + 1);
		else if (e.key === 'ArrowLeft') hovered = Math.max(0, (hovered ?? n) - 1);
		else return;
		e.preventDefault();
	}
</script>

<div class="mb-3 flex flex-wrap items-baseline gap-2">
	<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Spending pace</h2>
	<span class="ml-auto text-xs text-faint">{monthLabel(month)} vs {monthLabel(prev)}</span>
</div>

<dl class="mb-3 grid grid-cols-3 gap-2">
	<div class="rounded-ctl bg-tint px-3 py-2">
		<dt class="text-[11px] text-faint">Spent so far</dt>
		<dd class="text-sm font-semibold text-ink">{formatMoney(spent)}</dd>
	</div>
	<div class="rounded-ctl bg-tint px-3 py-2">
		<dt class="text-[11px] text-faint">vs same day last month</dt>
		<dd
			class="text-sm font-semibold {diff > 0
				? 'text-red-600 dark:text-red-400'
				: 'text-green-700 dark:text-green-400'}"
		>
			{diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : ''}{formatMoney(Math.abs(diff))}
		</dd>
	</div>
	<div class="rounded-ctl bg-tint px-3 py-2">
		<dt
			class="text-[11px] text-faint"
			title="Fixed bills once, plus variable spending at this month’s daily rate"
		>
			On pace for
		</dt>
		<dd class="text-sm font-semibold text-ink">{formatMoney(Math.round(projected))}</dd>
	</div>
</dl>

<div class="mb-1 flex justify-end gap-4 text-xs text-mute">
	<span class="flex items-center gap-1.5">
		<span class="h-0.5 w-3 rounded-full" style:background={CUR}></span> This month
	</span>
	<span class="flex items-center gap-1.5">
		<span class="h-0.5 w-3 rounded-full" style:background={PREV}></span> Last month
	</span>
</div>
<div class="relative">
	<svg
		viewBox="0 0 {W} {H}"
		class="h-auto w-full touch-pan-y outline-none"
		role="slider"
		tabindex="0"
		aria-label="Cumulative spending by day — use arrow keys to step through days"
		aria-valuemin={1}
		aria-valuemax={n}
		aria-valuenow={(hovered ?? dayOfMonth - 1) + 1}
		onpointermove={onmove}
		onpointerleave={() => (hovered = null)}
		onblur={() => (hovered = null)}
		onkeydown={onkey}
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
		{#each [1, 8, 15, 22, 29] as d (d)}
			<text x={x(d - 1)} y={H - 8} text-anchor="middle" font-size="10" fill="var(--t-faint)">
				{d}
			</text>
		{/each}
		<path
			d={lastPath}
			fill="none"
			stroke={PREV}
			stroke-width="2"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		<path
			d={curPath}
			fill="none"
			stroke={CUR}
			stroke-width="2"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		{#if hovered === null}
			<circle
				cx={x(dayOfMonth - 1)}
				cy={y(spent)}
				r="4"
				fill={CUR}
				stroke="var(--t-card)"
				stroke-width="2"
			/>
		{:else}
			<line
				x1={x(hovered)}
				x2={x(hovered)}
				y1={M.top}
				y2={M.top + plotH}
				stroke="var(--t-faint)"
				stroke-width="1"
			/>
			{#if cur[hovered] != null}
				<circle
					cx={x(hovered)}
					cy={y(cur[hovered]!)}
					r="4"
					fill={CUR}
					stroke="var(--t-card)"
					stroke-width="2"
				/>
			{/if}
			{#if last[hovered] != null}
				<circle
					cx={x(hovered)}
					cy={y(last[hovered]!)}
					r="4"
					fill={PREV}
					stroke="var(--t-card)"
					stroke-width="2"
				/>
			{/if}
		{/if}
	</svg>
	{#if hovered !== null}
		<ChartTooltip x={(x(hovered) / W) * 100} y={8}>
			<p class="mb-1 font-medium text-mute">Day {hovered + 1}</p>
			{#each [{ c: CUR, l: monthLabel(month), v: cur[hovered] }, { c: PREV, l: monthLabel(prev), v: last[hovered] }] as s (s.l)}
				<p class="flex items-center gap-2">
					<span class="h-0.5 w-3 shrink-0 rounded-full" style:background={s.c}></span>
					<span class="text-mute">{s.l}</span>
					<span class="ml-auto pl-3 font-semibold text-ink tabular-nums">
						{s.v == null ? '—' : formatMoney(s.v)}
					</span>
				</p>
			{/each}
		</ChartTooltip>
	{/if}
</div>
