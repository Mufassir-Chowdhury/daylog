# daylog

A todo app built on the "one text file" theory: every day is just text you append to.
No forms, no checkboxes — you type lines, and the app makes the text useful:

- **One page per day.** Jump with ← / →, the calendar picker, **Today**, or **+ Next day** —
  no more typing date headers by hand. Go back to any past day.
- **Timed tasks.** Start a line with a time (`09:00PM call mom`, `21:00 gym`) and it's
  pinned to a **Schedule** section at the top of the day, sorted by time.
- **People.** Write `@rahim` anywhere and Rahim gets a unique profile automatically.
  His profile shows every line that ever mentioned him, plus a freeform name/bio you can
  append notes to — after a while you have a detailed bio of everyone you deal with.
- **Finance.** Log expenses, income, transfers and lend/borrow from any day page or the
  Finance page. Charts cover cash flow (income, spending, net and savings rate over 6/12
  months or all time), spending and income by category with month-over-month change, your
  spending pace against last month, and a monthly category trend. Click a category for its
  history and transactions; transactions are grouped by month and only rendered when you expand
  one. Search, filter (kept in the URL), export CSV, duplicate or edit anything, undo deletes.
- **Debts per person.** Each person's page shows what they owe you (or you owe them), the full
  lend/borrow history with a running balance, and a one-click settle-up.
- **Schedule.** A weekly timetable (classes and labs that repeat every week) plus one-off events
  (exams, invigilation, meetings). This week and next week show as tables. Mark any class
  done, cancel it, move it to another day or room (the original stays crossed out with a note),
  or cancel a whole week. Undated events show as "Date TBD", and each week gets a note line.
  Below the tables are a day-by-day **task plan** (time blocks, spans like Fri–Sat, a "Later"
  bucket, highlighted protected blocks, and open tasks from past days resurfacing) and a
  **deadlines** list with countdowns. **Print / PDF** gives an A4 routine plus a task plan.
  Today's classes, tasks and close deadlines also show in the **Plan** panel on each day page.
- **Routines.** Track daily numbers with targets; see streaks and a 30-day heatmap.
- **Command palette.** `Ctrl+K` (or `/`) searches pages, people, notes and actions, jumps to
  any day (`fri`, `tmr`, `next mon`, `oct 12`, `+3`), and turns anything else into a line on
  today. Start with a date and a colon to file it elsewhere: `tmr: call @mom`. `Shift+Enter`
  always captures; the palette stays open so you can fire off several lines in a row.
- **Keyboard.** `Alt+1…8` switches pages, `Alt+←/→` steps through days, `Alt+T` jumps to today,
  `g` then `d/w/p/n/r/f/a/s` also jumps between pages, `?` lists every shortcut.
- **Desktop app.** The same app as a native Windows app that lives in the tray — see below.
- **Activity.** Where your computer time goes, daily time goals, and time added by hand —
  recorded by the desktop app, viewable everywhere.
- **Anywhere.** Data lives in Firestore with offline persistence — log in from any device
  (works fine from a phone), edits sync when you're online.
- 🎤 Voice input — _coming soon_.

Stack: SvelteKit (Svelte 5) + Tailwind, Firebase Auth + Firestore, all client-side —
there is no app server to run or maintain.

## One-time Firebase setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) (free Spark plan is enough).
2. **Authentication → Sign-in method**: enable **Google** and/or **Email/Password**.
3. **Firestore Database → Create database** (production mode).
4. **Firestore → Rules**: paste the contents of [`firestore.rules`](./firestore.rules) and publish.
5. **Project settings → Your apps → Add app → Web**: register an app, copy the
   `firebaseConfig` object into [`src/lib/firebase-config.ts`](./src/lib/firebase-config.ts).
6. When you deploy, add your domain under **Authentication → Settings → Authorized domains**
   (localhost is already authorized).

## Developing

```sh
npm install
npm run gen   # generates worker-configuration.d.ts (once, and after wrangler.jsonc changes)
npm run dev
```

## Testing

```sh
npm run test:unit   # parser + date unit tests (vitest)
npm run test:e2e    # playwright, builds and runs the real app
```

## Desktop app (Windows)

**Download:** [daylog-setup.exe](https://github.com/Mufassir-Chowdhury/daylog/releases/latest/download/daylog-setup.exe)
— built by GitHub Actions from every push to `main` ([all releases](https://github.com/Mufassir-Chowdhury/daylog/releases)).
The installer isn't code-signed, so SmartScreen may warn the first time: **More info → Run anyway**.
After that the app **updates itself**: it checks for a new release a few hours apart, downloads
it in the background and installs it when daylog quits — or right away from **Restart to update**
in the tray, the notification, or **Settings → Desktop app**.

The desktop build wraps the same app in Electron and adds what a web page can't do:

- **Always running.** Closing the window hides it to the tray. It can start with Windows,
  already hidden.
- **Global hotkeys**, from any app: `Ctrl+Alt+Space` opens the **quick bar** (the command
  palette, floating over whatever you're doing: type a thought, press Enter, and it's on
  today's page). `Ctrl+Alt+D` shows or hides the main window. You can change both in
  **Settings → Desktop app**.
- **Reminders.** A notification when a timed line comes due (`21:00 gym`), and ten minutes
  before each class, lab, exam or meeting on your schedule.
- **Jarvis theme.** Deep navy with soft blue light (or a light version), a sidebar instead of the
  top bar, native Windows 11 caption buttons (snap layouts work), and a live clock and sync
  light. The desktop theme is per computer, so the web app keeps its own. Switch in Settings.
- **Activity tracker** (opt-in, Activity page). It notices which app — and in a browser, which
  site — is in front, and shows where your time went: hour-by-hour focus / messages / distraction,
  deep-work sessions (25+ minutes, surviving detours under 2 minutes), how often you switch, your
  biggest distractions against your own averages, and your sharpest hours over the last weeks.
  - **Goals per day.** Set targets ("4h of focus", "2h in Word") or limits ("YouTube at most
    30m") and recorded time fills them up. Save them for one day or as your defaults.
  - **Add time by hand** for anything the tracker missed or got wrong (a meeting, reading on
    paper) — on any past day. It replaces whatever was recorded in those minutes.
  - **Synced.** Activity, goals and categories sync to your account, so the Activity page works in
    the web app and on your phone, and several computers add up.
  - **Idle isn't counted**, but watching isn't idle: when no key or mouse input arrives for the
    idle limit, the time is trimmed — unless a video or call is playing (Windows and macOS report
    when an app keeps the display awake; media players and call apps always count, up to 3 hours
    without input).
  - Pause it from the page or the tray, leave out apps, or stop recording window titles.
    Works on Windows (via a small PowerShell loop), with best-effort macOS (`osascript`) and Linux
    (`xdotool`, X11) support.
- `Ctrl+B` collapses the sidebar, `Ctrl+=`/`Ctrl+-` zoom, `F12` opens dev tools.

Data, login and offline sync are the same as the web app. The built app is served from
`http://localhost:47615`. Google blocks sign-in inside embedded browsers, so **Continue with
Google** opens your normal browser instead: sign in there and the app picks up the account
(the browser keeps no session). Email/password sign-in works directly in the app.

```sh
npm run desktop          # build the app and launch it
npm run desktop:dist     # build a Windows installer into desktop/dist/
npm run desktop:dev      # run against `npm run dev` (start that first) for hot reload
npm run desktop:icons    # regenerate desktop/icons/*.png after changing make-icons.mjs
```

## Deploying

The project is set up for Cloudflare Workers:

```sh
npm run build
npx wrangler deploy
```

Any static host works too (the app is fully client-rendered) — swap the adapter if you prefer.
