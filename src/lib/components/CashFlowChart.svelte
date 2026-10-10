<script lang="ts">
	import { barPath, linePath, niceScale } from '$lib/chart';
	import { dateKey, monthOf, monthsEnding } from '$lib/date';
	import {
		formatMoney,
		monthLabel,
		PERCENT,
		shortMoney,
		shortMonthLabel,
		summariesFor,
		type MonthSummary
	} from '$lib/finance';
	import ChartTooltip from './ChartTooltip.svelte';

	let {
		summaries,
		selected = null,
		onselect
	}: {
		/** Every month's summary, any order. */
		summaries: MonthSummary[];
		/** Month currently opened in the list below — highlighted. */
		selected?: string | null;
		onselect?: (month: string) => void;
	} = $props();

	const INCOME = 'var(--t-up)';
	const EXPENSE = 'var(--t-down)';
	const NET = 'var(--t-accent)';

	const thisMonth = monthOf(dateKey());

	/** 6 / 12 months, or 0 for everything since the first transaction. */
	let range: 6 | 12 | 0 = $state(6);
	let showTable = $state(false);
	let hovered: number | null = $state(null);

	const months = $derived.by(() => {
		if (range > 0) return monthsEnding(thisMonth, range);
		const oldest = summaries.reduce((m, s) => (s.month < m ? s.month : m), thisMonth);
		const [y1, m1] = oldest.split('-').map(Number);
		const [y2, m2] = thisMonth.split('-').map(Number);
		return monthsEnding(thisMonth, Math.max(6, (y2 - y1) * 12 + (m2 - m1) + 1));
	});
	const rows = $derived(summariesFor(summaries, months));
	const hasData = $derived(rows.some((r) => r.income > 0 || r.expense > 0));

	const totals = $derived.by(() => {
		const income = rows.reduce((s, r) => s + r.income, 0);
		const expense = rows.reduce((s, r) => s + r.expense, 0);
		// Average over months that had any activity, so a fresh account isn't diluted by empty months.
		const active = rows.filter((r) => r.income > 0 || r.expense > 0).length || 1;
		return {
			income,
			expense,
			net: income - expense,
			avgExpense: expense / active,
			avgIncome: income / active,
			savingsRate: income > 0 ? (income - expense) / income : null
		};
	});

	// Geometry in SVG user units; the svg scales to its container's width.
	const W = 640;
	const H = 240;
	const M = { top: 12, right: 8, bottom: 26, left: 52 };
	const plotW = W - M.left - M.right;
	const plotH = H - M.top - M.bottom;

	const scale = $derived(
		niceScale(
			Math.min(0, ...rows.map((r) => r.net)),
			Math.max(...rows.map((r) => Math.max(r.income, r.expense, r.net)))
		)
	);
	const y = (v: number) => M.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
	const baseline = $derived(y(0));

	const groupW = $derived(plotW / rows.length);
	const barW = $derived(Math.max(2, Math.min(24, groupW / 2 - 4)));
	const cx = (i: number) => M.left + groupW * i + groupW / 2;
	/** Thin out x labels so they never collide (~1 per 44 units). */
	const labelEvery = $derived(Math.max(1, Math.ceil(44 / groupW)));

	const netLine = $derived(
		linePath(rows.map((r, i) => (r.income > 0 || r.expense > 0 ? { x: cx(i), y: y(r.net) } : null)))
	);

	const RANGES: { value: 6 | 12 | 0; label: string }[] = [
		{ value: 6, label: '6M' },
		{ value: 12, label: '12M' },
		{ value: 0, label: 'All' }
	];
</script>

<div class="mb-3 flex flex-wrap items-center gap-2">
	<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Cash flow</h2>
	<div class="ml-auto flex items-center gap-2">
		<button
			type="button"
			onclick={() => (showTable = !showTable)}
			aria-pressed={showTable}
			class="rounded-ctl px-2 py-1 text-xs text-mute hover:bg-tint hover:text-ink"
		>
			{showTable ? 'Chart' : 'Table'}
		</button>
		<div class="flex overflow-hidden rounded-ctl border border-line text-xs">
			{#each RANGES as r (r.value)}
				<button
					type="button"
					onclick={() => (range = r.value)}
					aria-pressed={range === r.value}
					class="border-r border-line px-2 py-1 last:border-r-0 {range === r.value
						? 'bg-accent-fill text-on-accent'
						: 'bg-card text-mute hover:bg-tint'}"
				>
					{r.label}
				</button>
			{/each}
		</div>
	</div>
</div>

{#if !hasData}
	<p class="py-10 text-center text-sm text-faint">
		No income or expenses in this range yet — add transactions from a day page or with “+ Add”.
	</p>
{:else}
	<dl class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
		<div class="rounded-ctl bg-tint px-3 py-2">
			<dt class="text-[11px] text-faint">Income</dt>
			<dd class="text-sm font-semibold text-ink">{formatMoney(totals.income)}</dd>
			<dd class="text-[11px] text-faint">avg {formatMoney(Math.round(totals.avgIncome))}/mo</dd>
		</div>
		<div class="rounded-ctl bg-tint px-3 py-2">
			<dt class="text-[11px] text-faint">Spending</dt>
			<dd class="text-sm font-semibold text-ink">{formatMoney(totals.expense)}</dd>
			<dd class="text-[11px] text-faint">avg {formatMoney(Math.round(totals.avgExpense))}/mo</dd>
		</div>
		<div class="rounded-ctl bg-tint px-3 py-2">
			<dt class="text-[11px] text-faint">Net</dt>
			<dd
				class="text-sm font-semibold {totals.net < 0
					? 'text-red-600 dark:text-red-400'
					: 'text-ink'}"
			>
				{formatMoney(totals.net)}
			</dd>
		</div>
		<div class="rounded-ctl bg-tint px-3 py-2">
			<dt class="text-[11px] text-faint">Savings rate</dt>
			<dd class="text-sm font-semibold text-ink">
				{totals.savingsRate === null ? '—' : PERCENT.format(totals.savingsRate)}
			</dd>
			<dd class="text-[11px] text-faint">of income kept</dd>
		</div>
	</dl>

	{#if showTable}
		<div class="max-h-80 overflow-auto">
			<table class="w-full text-sm tabular-nums">
				<thead class="sticky top-0 bg-card text-xs text-faint">
					<tr class="text-right [&>th]:px-2 [&>th]:py-1 [&>th]:font-medium">
						<th class="text-left">Month</th>
						<th>Income</th>
						<th>Expense</th>
						<th>Net</th>
						<th>Saved</th>
						<th class="hidden sm:table-cell">Lent</th>
						<th class="hidden sm:table-cell">Borrowed</th>
					</tr>
				</thead>
				<tbody>
					{#each [...rows].reverse() as r (r.month)}
						<tr class="border-t border-line text-right text-ink [&>td]:px-2 [&>td]:py-1">
							<td class="text-left">
								<button
									type="button"
									onclick={() => onselect?.(r.month)}
									class="hover:text-accent hover:underline">{monthLabel(r.month)}</button
								>
							</td>
							<td>{formatMoney(r.income)}</td>
							<td>{formatMoney(r.expense)}</td>
							<td class={r.net < 0 ? 'text-red-600 dark:text-red-400' : ''}>{formatMoney(r.net)}</td
							>
							<td class="text-mute">
								{r.savingsRate === null ? '—' : PERCENT.format(r.savingsRate)}
							</td>
							<td class="hidden text-mute sm:table-cell">{formatMoney(r.lent)}</td>
							<td class="hidden text-mute sm:table-cell">{formatMoney(r.borrowed)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="mb-1 flex justify-end gap-4 text-xs text-mute">
			<span class="flex items-center gap-1.5">
				<span class="h-2.5 w-2.5 rounded-sm" style:background={INCOME}></span> Income
			</span>
			<span class="flex items-center gap-1.5">
				<span class="h-2.5 w-2.5 rounded-sm" style:background={EXPENSE}></span> Expense
			</span>
			<span class="flex items-center gap-1.5">
				<span class="h-0.5 w-3 rounded-full" style:background={NET}></span> Net
			</span>
		</div>
		<div class="relative">
			<svg
				viewBox="0 0 {W} {H}"
				class="h-auto w-full"
				role="img"
				aria-label="Income, expense and net per month"
			>
				{#each scale.ticks as tick (tick)}
					<line
						x1={M.left}
						x2={W - M.right}
						y1={y(tick)}
						y2={y(tick)}
						stroke="var(--t-line)"
						stroke-width="1"
					/>
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
					{#if hovered === i || selected === r.month}
						<rect
							x={cx(i) - groupW / 2 + 1}
							y={M.top}
							width={groupW - 2}
							height={plotH}
							fill="var(--t-tint)"
							rx="4"
						/>
					{/if}
					<path d={barPath(cx(i) - barW - 1, barW, baseline, y(r.income))} fill={INCOME} />
					<path d={barPath(cx(i) + 1, barW, baseline, y(r.expense))} fill={EXPENSE} />
					{#if i % labelEvery === 0 || i === rows.length - 1}
						<text
							x={cx(i)}
							y={H - 8}
							text-anchor="middle"
							font-size="10"
							fill={selected === r.month ? 'var(--t-ink)' : 'var(--t-faint)'}
						>
							{shortMonthLabel(r.month)}
						</text>
					{/if}
				{/each}
				<line
					x1={M.left}
					x2={W - M.right}
					y1={baseline}
					y2={baseline}
					stroke="var(--t-faint)"
					stroke-width="1"
				/>
				<path
					d={netLine}
					fill="none"
					stroke={NET}
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
				{#each rows as r, i (r.month)}
					{#if r.income > 0 || r.expense > 0}
						<circle
							cx={cx(i)}
							cy={y(r.net)}
							r={hovered === i ? 5 : 4}
							fill={NET}
							stroke="var(--t-card)"
							stroke-width="2"
						/>
					{/if}
				{/each}
				<!-- Hit targets: one full-height column per month, bigger than any mark. -->
				{#each rows as r, i (r.month)}
					<rect
						x={cx(i) - groupW / 2}
						y={M.top}
						width={groupW}
						height={plotH + M.bottom}
						fill="transparent"
						role="button"
						tabindex="0"
						aria-label="{monthLabel(r.month)}: income {formatMoney(r.income)}, expense {formatMoney(
							r.expense
						)}, net {formatMoney(r.net)}"
						class="cursor-pointer outline-none"
						onpointerenter={() => (hovered = i)}
						onpointerleave={() => (hovered = null)}
						onfocus={() => (hovered = i)}
						onblur={() => (hovered = null)}
						onclick={() => onselect?.(r.month)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onselect?.(r.month);
							}
						}}
					/>
				{/each}
			</svg>
			{#if hovered !== null}
				{@const r = rows[hovered]}
				<ChartTooltip x={(cx(hovered) / W) * 100} y={8}>
					<p class="mb-1 font-medium text-mute">{monthLabel(r.month)}</p>
					{@render row(INCOME, 'Income', formatMoney(r.income))}
					{@render row(EXPENSE, 'Expense', formatMoney(r.expense))}
					{@render row(NET, 'Net', formatMoney(r.net))}
					<div class="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-faint">
						{#if r.savingsRate !== null}
							<p>saved <span class="text-ink">{PERCENT.format(r.savingsRate)}</span> of income</p>
						{/if}
						{#if r.fixed > 0}
							<p>
								fixed bills <span class="text-ink">{formatMoney(r.fixed)}</span>
								({PERCENT.format(r.fixed / r.expense)} of spending)
							</p>
						{/if}
						{#if r.lent > 0}<p>lent <span class="text-ink">{formatMoney(r.lent)}</span></p>{/if}
						{#if r.borrowed > 0}
							<p>borrowed <span class="text-ink">{formatMoney(r.borrowed)}</span></p>
						{/if}
						<p>{r.count} transaction{r.count === 1 ? '' : 's'} · click to view</p>
					</div>
				</ChartTooltip>
			{/if}
		</div>
	{/if}
{/if}

{#snippet row(color: string, label: string, value: string)}
	<p class="flex items-center gap-2">
		<span class="h-0.5 w-3 shrink-0 rounded-full" style:background={color}></span>
		<span class="text-mute">{label}</span>
		<span class="ml-auto pl-3 font-semibold text-ink tabular-nums">{value}</span>
	</p>
{/snippet}
