# daylog — overhaul plan

> **Status: all 10 steps done.** Checks pass: `svelte-check` (0 errors, 0 warnings), `eslint`,
> `prettier`, 79 unit and browser tests, and `vite build`. I rendered the charts with sample data and
> checked them in light and dark mode.
>
> Where the result differs from the plan:
>
> - **People list.** There is no mention count. Counting needs every day document, which is too
>   heavy to load just for a list. The list shows balances instead, plus search and owe/owed filters.
> - **Spending pace.** "On pace for" adds fixed bills once and projects only variable spending.
>   Projecting everything ran rent and other day-1 bills through the month and inflated the
>   estimate.
> - **Category changes for the current month.** The current month is compared with the same days
>   of last month (Sep 1–10 vs Oct 1–10), not with all of last month.
> - **Delete confirmations.** Deleting accounts, routines and long-standing tasks also uses undo
>   toasts now. Deleting a person still asks first, because it rewrites every day that mentions them.

Things are listed in the order I'll do them. Each step ends with `svelte-check`, unit tests, and the
Svelte autofixer on the components it touched. Items you asked for are marked **(requested)**.

---

## 1. Finance data layer (`src/lib/finance.ts`)

Shared groundwork for the charts and drill-downs. Every new function gets unit tests.

- `monthlySummaries` also returns **lent, borrowed, transfer volume, fixed expense and savings rate**
  for each month, so the charts and month headers can show more than income/expense.
- `categoryTotals` for **income as well as expense**, so salary, bonus and other income show up as
  categories. Also returns the transaction count and average per category.
- `dailySpending(txns, month)`: running total of spending per day, so this month can be compared with
  last month on the same day.
- `personHistory(txns, handle)`: one person's lends and borrows in date order, with the running
  balance after each one.
- `personStats`: total lent, total borrowed and net for every person who has ever had a lend or
  borrow, including people who are now settled. Used on the People list.
- `accountMonthFlow`: money in and out of each account this month, shown on the account cards.
- `transactionsToCsv`: CSV export of transactions.
- Fix: `MonthlyChart` hard-codes `৳` on its axis labels, and FinancePanel's labels say "Amount (৳)".
  Both will use the currency from Settings instead.

## 2. Charts, more informative and more complete **(requested)**

Before writing any chart code I'll read the dataviz skill.

- **Cash-flow chart** (replaces the monthly bar chart):
  - Income and expense bars with a **net line** drawn over them.
  - Range switch: **6 months, 12 months, or all time**.
  - Hovering a month shows a tooltip with income, expense, net, savings rate, lent, borrowed and the
    fixed share of spending.
  - Clicking a month opens that month in the transaction list below.
- **Category breakdown**, with three tabs: **Expense, Income, Both**.
  - Income categories (salary, bonus, …) finally show up.
  - Each row shows the amount, its share of the total, how many transactions it has, and how this
    month compares with last month (▲/▼ %).
  - The time range can be **this month, last month, a chosen month, or all time**.
  - Clicking a category opens the category drill-down (step 3).
- **Spending pace chart** (new): this month's running spending plotted against last month's on the
  same days, so you can see whether you're ahead of or behind last month.
- **Category trend**: a stacked bar per month showing the top expense categories, so you can see where
  money went over time.
- All charts get legends, follow the theme in light and dark mode, show a placeholder when there's no
  data, and are labelled for screen readers.

## 3. Category drill-down **(requested)**

- Clicking a category in the chart, a category chip on a transaction row, or choosing one from the
  category filter opens a **category panel**. It shows:
  - the total for the selected range, the monthly average, and the number of transactions;
  - a small per-month bar chart for that category;
  - all of that category's transactions, grouped by month.
- The panel's state is kept in the URL (`/finance?category=lunch`), so it can be bookmarked and the
  back button closes it.

## 4. Person drill-down **(requested)**

- **Person page** (`/people/[handle]`) gets a new **Money** section:
  - the net balance ("owes you ৳X", "you owe ৳X" or "settled");
  - total lent and total borrowed;
  - a full history of lends and borrows with the running balance after each one;
  - a **Settle up** button that records the matching lend or borrow in one click, after you pick the
    account.
- **Finance → Owed card**: clicking a person expands their history right there. A link goes to the
  full profile.
- **People list**: shows each person's balance badge (owes you / you owe) and how many times they've
  been mentioned, and gets a search box.

## 5. Transactions grouped by month, loaded when expanded **(requested)**

- The transaction list becomes **collapsible month groups**. Each collapsed header shows the month,
  how many transactions it has, and its in, out and net totals.
- A month's rows are **only rendered when you expand it**. Only the current month is open by default.
- **Expand all** and **Collapse all** buttons.
- Inside a month, transactions are split by day with a total for each day.
- Note on "load": charts, balances and debts need every transaction, so all of them are still fetched
  in one request. That single request is cheap and is served from Firestore's offline cache. The
  expensive part is drawing hundreds of rows, and that is what becomes lazy. If you want true
  per-month fetching later, it needs stored monthly totals, which is a bigger schema change.

## 6. Finance page quality of life

- **Search** across note, category, person and account.
- **Type filter** (expense, income, transfer, lend, borrow), alongside the existing account and
  category filters.
- Filters are saved in the URL.
- **Add a transaction from the Finance page.** A "+ Add" button opens the same form the day page uses,
  with a date picker added.
- **Edit everything on a transaction.** Today, editing can't change the amount, date or note. It will.
  You'll also be able to **duplicate** a transaction (handy for repeat expenses).
- **Clicking an account card** filters the page to that account. Each card also shows this month's
  money in and out.
- **Export filtered transactions as CSV.**
- Reorganised layout: summary tiles, then accounts, then a tabbed analytics area, then the
  transaction list.

## 7. Day-page Finance panel

- **Remembers your last used type and accounts.** Most entries are "expense from Cash", so the form
  starts there.
- **Shows the day's total in and out** in the panel header.
- **Asks for confirmation before deleting** (or offers undo; see step 8). Right now a single click on
  × deletes the transaction straight away.
- Category suggestions include **categories you've used before**, not only the built-in presets.
- Fix: the amount label uses the currency from Settings.

## 8. App-wide quality of life

- **Undo toasts.** Deleting a transaction, note or long-standing task shows "Deleted · Undo" for a few
  seconds instead of a blocking confirm dialog.
- **Touch support.** Edit and delete buttons only appear on hover today, so they're invisible on a
  phone. They'll always be visible on touch devices.
- **Keyboard shortcuts**, with a `?` key that lists them:
  - day page: `Alt+←` and `Alt+→` for the previous and next day, `Alt+T` for today;
  - `g` then `d`, `f`, `p` or `n` to jump to Today, Finance, People or Notes.
- **A page title per route** ("Finance · daylog", "@rahim · daylog") so browser tabs and history
  are readable.
- **Mobile navigation.** The header nav wraps onto several lines on a phone. It will scroll
  horizontally instead, and the Sign-out button will be more compact.
- **Notes**: a search box (title, content, tags), and save errors are shown. `saveNote` currently
  fails silently.
- **Person page**: save errors are shown. `savePerson` also fails silently.

## 9. Routines page

- **Streaks**: the current and best streak of days that met the target.
- **Last-30-days heatmap** per routine: cells coloured by value, with the target-met days highlighted.

## 10. Wrap-up

- Update the README's feature list.
- Run the full check: `svelte-check`, `eslint`, `prettier` and the unit tests.

---

### Not doing (and why)

- **Fetching each month separately from Firestore.** See step 5. It would need stored aggregates, and
  the cost now is rendering, not fetching.
- **Voice input.** Still marked "coming soon". It's out of scope for this pass.
