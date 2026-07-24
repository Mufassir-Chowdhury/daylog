<script lang="ts">
	import { dateKey } from '$lib/date';
	import { formatMoney, monthLabel, type MonthSummary } from '$lib/finance';

	let { summaries }: { summaries: MonthSummary[] } = $props();

	// Theme tokens (--t-up/--t-down) keep the pair readable in dark themes too.
	const INCOME = 'var(--t-up, #008300)';
	const EXPENSE = 'var(--t-down, #e34948)';

	const SHORT_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' });

	/** Last six calendar months ending this month, zero-filled where nothing happened. */
	const months = $derived.by(() => {
		const [y, m] = dateKey().split('-').map(Number);
		const byMonth = new Map(summaries.map((s) => [s.month, s]));
		return Array.from({ length: 6 }, (_, i) => {
			const d = new Date(y, m - 1 - (5 - i), 1);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			const s = byMonth.get(key);
			return {
				month: key,
				label: SHORT_MONTH.format(d),
				income: s?.income ?? 0,
				expense: s?.expense ?? 0
			};
		});
	});

	const hasData = $derived(months.some((m) => m.income > 0 || m.expense > 0));

	// Chart geometry (SVG user units; the svg itself scales to container width).
	const W = 560;
	const H = 220;
	const M = { top: 10, right: 8, bottom: 24, left: 48 };
	const plotW = W - M.left - M.right;
	const plotH = H - M.top - M.bottom;

	/** Round a maximum up to a friendly tick step so gridlines land on round numbers. */
	function niceMax(raw: number): { max: number; step: number } {
		const target = Math.max(raw, 1) / 4;
		const pow = 10 ** Math.floor(Math.log10(target));
		const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= target) ?? 10 * pow;
		return { max: step * 4, step };
	}

	const scale = $derived(niceMax(Math.max(...months.map((m) => Math.max(m.income, m.expense)))));
	const ticks = $derived(Array.from({ length: 5 }, (_, i) => i * scale.step));

	const y = (value: number) => M.top + plotH - (value / scale.max) * plotH;

	const groupW = plotW / 6;
	const barW = Math.min(30, groupW / 2 - 6);

	/** Bar path with 4px-rounded top corners, flat at the baseline. */
	function bar(x: number, value: number): string {
		const top = y(value);
		const h = M.top + plotH - top;
		const r = Math.min(4, h, barW / 2);
		return `M${x},${M.top + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
	}

	function shortMoney(n: number): string {
		const trim = (v: number) => String(Math.round(v * 10) / 10);
		if (n >= 1e5) return `৳${trim(n / 1e5)}L`;
		if (n >= 1e3) return `৳${trim(n / 1e3)}k`;
		return `৳${n}`;
	}
</script>

{#if hasData}
	<div class="mb-1 flex justify-end gap-4 text-xs text-mute">
		<span class="flex items-center gap-1.5">
			<span class="h-2.5 w-2.5 rounded-sm" style="background:{INCOME}"></span> Income
		</span>
		<span class="flex items-center gap-1.5">
			<span class="h-2.5 w-2.5 rounded-sm" style="background:{EXPENSE}"></span> Expense
		</span>
	</div>
	<svg
		viewBox="0 0 {W} {H}"
		class="h-auto w-full"
		role="img"
		aria-label="Income and expense per month for the last six months"
	>
		{#each ticks as tick (tick)}
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
		<line
			x1={M.left}
			x2={W - M.right}
			y1={M.top + plotH}
			y2={M.top + plotH}
			stroke="var(--t-faint)"
		/>
		{#each months as m, i (m.month)}
			{@const cx = M.left + groupW * i + groupW / 2}
			{#if m.income > 0}
				<path d={bar(cx - barW - 1, m.income)} fill={INCOME}>
					<title>{monthLabel(m.month)} — income {formatMoney(m.income)}</title>
				</path>
			{/if}
			{#if m.expense > 0}
				<path d={bar(cx + 1, m.expense)} fill={EXPENSE}>
					<title>{monthLabel(m.month)} — expense {formatMoney(m.expense)}</title>
				</path>
			{/if}
			<text x={cx} y={H - 8} text-anchor="middle" font-size="10" fill="var(--t-faint)">
				{m.label}
			</text>
		{/each}
	</svg>
{:else}
	<p class="py-6 text-center text-sm text-faint">
		No income or expenses recorded yet — add transactions from a day page.
	</p>
{/if}
