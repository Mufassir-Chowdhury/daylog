/**
 * The in-app guide (/help): every feature, what the assistant can do, and how
 * to get the most from it. Content is data so the page can search it; `{name}`
 * is the assistant's name from Settings. `code` spans are written in backticks.
 */

export type SectionId =
	| 'start'
	| 'day'
	| 'schedule'
	| 'people'
	| 'money'
	| 'activity'
	| 'desktop'
	| 'assistant'
	| 'practices'
	| 'privacy';

export const SECTIONS: { id: SectionId; label: string }[] = [
	{ id: 'start', label: 'Getting around' },
	{ id: 'day', label: 'Your day' },
	{ id: 'schedule', label: 'Schedule' },
	{ id: 'people', label: 'People, notes, long-term' },
	{ id: 'money', label: 'Routines and money' },
	{ id: 'activity', label: 'Activity' },
	{ id: 'desktop', label: 'Desktop app' },
	{ id: 'assistant', label: '{name}, the assistant' },
	{ id: 'practices', label: 'Best practices' },
	{ id: 'privacy', label: 'Privacy, cost, control' }
];

/** A "Try it" button: open a page, open the palette with some text, or ask the assistant. */
export interface HelpAction {
	label: string;
	kind: 'go' | 'palette' | 'ask';
	/** A path for `go`, palette text for `palette`, a question for `ask`. */
	value: string;
}

export interface HelpTopic {
	id: string;
	section: SectionId;
	title: string;
	summary: string;
	points: string[];
	tries?: HelpAction[];
	/** Extra words people might search for. */
	keywords?: string;
	/** Only in the desktop app. */
	desktop?: boolean;
}

export const TOPICS: HelpTopic[] = [
	// ——— Getting around
	{
		id: 'palette',
		section: 'start',
		title: 'The command palette',
		summary: 'One box for everything: jump anywhere, search, capture a line, ask {name}.',
		points: [
			'Press `Ctrl K` (or `/` when you are not typing).',
			'Type a page name, a person, a note title or a date — `fri`, `next mon`, `oct 12`, `+3`.',
			'Type anything else and Enter adds it as a line on today. Start with a day to add it there: `tomorrow: call the bank`.',
			'Start with `>` for commands, `@` for people, `?` to ask {name}.'
		],
		tries: [
			{ label: 'Open the palette', kind: 'palette', value: '' },
			{ label: 'Jump to next Monday', kind: 'palette', value: 'next mon' }
		],
		keywords: 'search jump command ctrl k quick'
	},
	{
		id: 'keys',
		section: 'start',
		title: 'Keyboard shortcuts',
		summary: 'Most of the app works from the keyboard.',
		points: [
			'`g` then a letter goes to a page: `g d` today, `g w` schedule, `g p` people, `g n` notes, `g r` routines, `g f` finance, `g a` activity, `g s` settings.',
			'`Alt ←` / `Alt →` step through days; `Alt T` jumps to today.',
			'`Ctrl Enter` crosses out the line you are on.',
			'`Ctrl J` opens {name}; `?` shows every shortcut.'
		],
		keywords: 'keys hotkeys shortcuts keyboard'
	},
	{
		id: 'start-checklist',
		section: 'start',
		title: 'Settings that matter first',
		summary: 'A few choices shape the whole app.',
		points: [
			'Settings → Money: your currency and how numbers are grouped (lakh or thousand).',
			'Settings → Day page panels: which panels sit next to your day (plan, finance, routines, notes, long-term).',
			'Settings → Assistant: an API key, its name and how it addresses you, check-in times, quiet hours.',
			'Settings → Data: download a backup or restore one — it includes the assistant’s settings and memory.'
		],
		tries: [{ label: 'Open Settings', kind: 'go', value: '/settings' }],
		keywords: 'setup currency backup export import theme dark'
	},

	// ——— Your day
	{
		id: 'day-page',
		section: 'day',
		title: 'The day page',
		summary: 'One page of plain text per day. Just type — one thought per line.',
		points: [
			'It saves as you type, works offline and syncs across devices.',
			'Start a line with a time (`09:00PM call mom`) and it pins to the schedule at the top, with a reminder on the desktop.',
			'Type `@` to mention someone; space or Enter adds a new person.',
			'Wrap a line in `~~tildes~~`, or press `Ctrl Enter`, to cross it out when it is done.',
			'Try it in the box below: it shows how daylog reads a line.'
		],
		tries: [{ label: 'Open today', kind: 'go', value: '/day' }],
		keywords: 'text write line editor mention time reminder done cross out'
	},
	{
		id: 'day-panels',
		section: 'day',
		title: 'Panels beside your day',
		summary:
			'The day’s plan, money, routines, a quick note and long-term tasks, next to what you write.',
		points: [
			'Plan: today’s classes, tasks and deadlines due soon, with tick boxes — plus cards from {name} on today’s page.',
			'Finance: add today’s spending and income without leaving the page.',
			'Routines: log today’s numbers (pages read, minutes walked).',
			'Choose which panels show in Settings → Day page panels.'
		],
		keywords: 'plan panel finance routine note long-term sidebar'
	},

	// ——— Schedule
	{
		id: 'timetable',
		section: 'schedule',
		title: 'Timetable and events',
		summary: 'Your weekly classes once, and everything that changes them.',
		points: [
			'Add weekly slots (class, lab, exam, invigilation, meeting) with times and rooms; the week runs Sunday to Thursday.',
			'Mark a class done, cancelled or moved for one week without touching the timetable.',
			'Add one-off events, or events with no date yet (TBD).',
			'Cancel a whole week of classes in one go, and leave a note on a week.'
		],
		tries: [
			{ label: 'Open the schedule', kind: 'go', value: '/schedule' },
			{ label: 'Ask what’s on this week', kind: 'ask', value: 'What do I have this week?' }
		],
		keywords: 'class lab exam room week cancel move timetable slot'
	},
	{
		id: 'tasks-deadlines',
		section: 'schedule',
		title: 'Tasks and deadlines',
		summary: 'A plan of tasks per day, and deadlines counting down.',
		points: [
			'Tasks sit on a day, span several days, or wait in Later. Give one a time block to protect the time; highlight the important ones.',
			'Mark tasks done, or dropped with a reason ("not needed — exam postponed").',
			'Deadlines show days left; hard ones are red and show up two weeks ahead instead of one.',
			'Print the week from the palette: `> print schedule`.'
		],
		keywords: 'task todo later deadline due countdown hard print'
	},

	// ——— People, notes, long-term
	{
		id: 'people',
		section: 'people',
		title: 'People',
		summary: 'Everyone you mention gets a profile.',
		points: [
			'Each `@person` has a page with their full name, a bio, every day they were mentioned, and money between you.',
			'Record a lend or borrow, or a payback, right from their page.'
		],
		tries: [{ label: 'Open People', kind: 'go', value: '/people' }],
		keywords: 'person mention profile bio contact'
	},
	{
		id: 'notes',
		section: 'people',
		title: 'Notes',
		summary: 'Longer writing that isn’t tied to a day.',
		points: [
			'Notes have a title, text and tags. Find them from the palette by title.',
			'{name}’s weekly review is saved as a note tagged `review`.'
		],
		tries: [{ label: 'Open Notes', kind: 'go', value: '/notes' }],
		keywords: 'note write tag document'
	},
	{
		id: 'longterm',
		section: 'people',
		title: 'Long-term tasks',
		summary: 'Projects that take weeks, broken into subtasks.',
		points: [
			'Keep them in the Long-term panel on the day page, tick subtasks off as you go.',
			'{name} can add subtasks and finish tasks for you.'
		],
		keywords: 'project subtask thesis goal'
	},

	// ——— Routines and money
	{
		id: 'routines',
		section: 'money',
		title: 'Routines',
		summary: 'Daily numbers you want to keep up, with streaks.',
		points: [
			'Set up a routine with a unit and a daily target (5 pages, 30 minutes) in Settings → Daily routines.',
			'Log the day’s value from the day page; the Routines page shows the last 30 days and streaks.'
		],
		tries: [
			{ label: 'Open Routines', kind: 'go', value: '/routines' },
			{ label: 'Log by asking', kind: 'ask', value: 'I read 12 pages today' }
		],
		keywords: 'habit streak target log'
	},
	{
		id: 'finance',
		section: 'money',
		title: 'Finance',
		summary: 'Accounts, spending, income, transfers, and money lent or borrowed.',
		points: [
			'Record expenses and income by category, transfers between accounts, and lends and borrows with a person.',
			'Mark recurring bills and salary as fixed, so day-to-day spending stands out.',
			'Group related records ("Dhaka trip") to see what a trip or project cost.',
			'See the month’s pace against last month, categories over time, balances and who owes whom; export to CSV.'
		],
		tries: [
			{ label: 'Open Finance', kind: 'go', value: '/finance' },
			{ label: 'Ask about this month', kind: 'ask', value: 'How is my spending this month?' }
		],
		keywords: 'money expense income account lend borrow debt budget csv'
	},

	// ——— Activity
	{
		id: 'activity',
		section: 'activity',
		title: 'Activity',
		summary: 'Where your computer time really goes.',
		points: [
			'The desktop app records which app or site is in front (opt-in, on your computer); time added by hand counts too.',
			'See time by category, hour by hour, top apps and sites, deep work, and insights against your usual day.',
			'Set goals: at least so much deep work, or at most so much of a distracting site.'
		],
		tries: [{ label: 'Open Activity', kind: 'go', value: '/activity' }],
		keywords: 'tracking time apps sites focus deep work goals limit'
	},

	// ——— Desktop app
	{
		id: 'desktop',
		section: 'desktop',
		title: 'The desktop app',
		summary: 'daylog in the tray, always a keystroke away.',
		points: [
			'A global hotkey opens the quick bar from any app: capture a line, jump to a page, or start with `?` to ask {name}.',
			'Another hotkey shows or hides daylog; it starts with your computer and lives in the tray.',
			'Reminders for timed lines, activity tracking, and on-time check-ins even when the window is hidden.',
			'Change the hotkeys in Settings → Desktop.'
		],
		keywords: 'tray quick bar hotkey windows mac notification'
	},

	// ——— The assistant
	{
		id: 'ai-ask',
		section: 'assistant',
		title: 'Ask anything about your log',
		summary:
			'{name} reads your days, schedule, people, notes, routines, money and activity to answer.',
		points: [
			'Open it with `Ctrl J`, the {name} button, or `?` in the palette. It knows which page you are on.',
			'It looks things up before it answers, and says plainly when something isn’t there.',
			'The conversation is kept, so you can follow up; "New conversation" starts afresh.'
		],
		tries: [
			{ label: 'What’s up today?', kind: 'ask', value: "What's up today?" },
			{ label: 'Last talk with someone', kind: 'ask', value: 'When did I last talk to @rahim?' },
			{
				label: 'Spending question',
				kind: 'ask',
				value: 'How much did I spend on transport in September?'
			},
			{ label: 'Free time', kind: 'ask', value: 'When am I free on Thursday?' }
		],
		keywords: 'chat question ai jarvis ask search log'
	},
	{
		id: 'ai-change',
		section: 'assistant',
		title: 'Have it make changes',
		summary: 'Tell it what happened; it updates the right places.',
		points: [
			'Small additions happen at once with an Undo: a line on a day, a task, a note, a subtask, a routine value, a memory.',
			'Everything else comes as a card to Apply or Dismiss: moving or cancelling classes, editing tasks, money records.',
			'Before a card applies, it checks nothing changed since — otherwise it says so.',
			'Tick "Always do this without asking" on a card, or choose in Settings → Assistant. It never deletes anything.'
		],
		tries: [
			{ label: 'Cancel a class', kind: 'ask', value: "Thursday's SWE class is cancelled" },
			{ label: 'Add a task', kind: 'ask', value: 'Add grading the DM quiz to Later' },
			{ label: 'Record money', kind: 'ask', value: 'I gave @rahim 500 today' },
			{ label: 'Carry over', kind: 'ask', value: "Move yesterday's unfinished lines to today" }
		],
		keywords: 'change update apply undo card cancel move record'
	},
	{
		id: 'ai-checkins',
		section: 'assistant',
		title: 'Check-ins and the weekly review',
		summary: 'It reaches out on its own at the times you choose.',
		points: [
			'08:00 warm-up: today’s classes and rooms, tasks, deadlines, what was left open yesterday, your best focus window.',
			'17:00 brief: what’s still open, tomorrow’s first class, spending if it’s running ahead.',
			'23:15 wrap-up: what got done, what moves to tomorrow, routines and money not logged.',
			'Thursday 20:00 weekly review, saved as a note, with next week’s plan as cards.',
			'Each lands in the Inbox on today’s page with a notification. Change times, days and kinds in Settings → Assistant; "Run now" tries one.'
		],
		tries: [{ label: 'Check-in settings', kind: 'go', value: '/settings' }],
		keywords: 'brief morning evening night review weekly schedule notification'
	},
	{
		id: 'ai-notices',
		section: 'assistant',
		title: 'What it notices by itself',
		summary: 'Between check-ins it watches for a few things and leaves a card.',
		points: [
			'Lines left open yesterday — offers to move them to today.',
			'A deadline within 5 days with no task — plans 2–4 steps into your free time.',
			'About 30 minutes before a meeting or exam — a prep note with related tasks, notes and a brief on each person.',
			'Money: spending well ahead of last month, an expense far above its usual, a debt open over a month.',
			'Lines you type that look like money, dates or cancellations — cards under the editor ("record the lend", "add the deadline").',
			'On the desktop, opt-in: a focus coach for limits running out and free focus hours.'
		],
		keywords: 'suggestion detector deadline prep money capture focus coach proactive'
	},
	{
		id: 'ai-memory',
		section: 'assistant',
		title: 'Memory and follow-ups',
		summary: 'It remembers lasting things, and can come back to something later.',
		points: [
			'Tell it a preference or fact once ("I always grade on Saturdays") and it keeps it for every conversation.',
			'See, edit or forget what it remembers in Settings → Assistant.',
			'Ask it to check back later ("look again after my 2 PM class") and it will, on its own, and leave what it found in the Inbox.'
		],
		tries: [
			{ label: 'Teach it something', kind: 'ask', value: 'Remember that I prefer short answers' },
			{ label: 'What it remembers', kind: 'ask', value: 'What do you remember about me?' }
		],
		keywords: 'remember memory preference follow up later schedule checkin'
	},

	// ——— Best practices
	{
		id: 'bp-specific',
		section: 'practices',
		title: 'Say it the way you’d tell a colleague',
		summary: 'Plain sentences work best — it understands how you talk about your week.',
		points: [
			'Name the thing and the day: "Thursday’s DM class is shifted to Sunday, room 304".',
			'"Postponed" is read as cancelled (and tasks only for it are dropped); "taken" or "done" as done.',
			'Use the same names you use in the app — course names and `@handles`.',
			'If it could mean two things (two Thursday classes), it asks one short question instead of guessing.'
		],
		keywords: 'tips prompt wording how to ask'
	},
	{
		id: 'bp-cards',
		section: 'practices',
		title: 'Let cards do the careful work',
		summary: 'Bigger changes wait for you on purpose.',
		points: [
			'Read the lines on a card ("Status: open → dropped") before you apply.',
			'Dismiss what you don’t want; it won’t propose the same thing again in the conversation.',
			'Once you trust a kind of change, tick "Always do this without asking" — Undo still works.',
			'Not useful? "Don’t suggest these again" switches that kind of suggestion off (back on in Settings).',
			'A kind you keep dismissing pauses itself; Settings → Assistant shows it with a Resume button.'
		],
		keywords: 'tips apply dismiss always undo mute'
	},
	{
		id: 'bp-feed',
		section: 'practices',
		title: 'Keep your log, and it keeps up',
		summary: 'It only knows what’s written down.',
		points: [
			'Put classes in the timetable and deadlines in Schedule — briefs, prep notes and the deadline planner build on them.',
			'Mention people with `@` so person briefs and money between you work.',
			'Write money on the page as you go ("lunch 250"); the wrap-up and capture cards turn it into records.',
			'Tell it lasting preferences once, so check-ins fit how you work.'
		],
		keywords: 'tips data accurate better results'
	},

	// ——— Privacy, cost, control
	{
		id: 'privacy',
		section: 'privacy',
		title: 'What it sees and where it goes',
		summary: 'You bring your own key; you choose what it can read.',
		points: [
			'It uses Claude or Gemini with your own API key, stored on this device only (the OS keychain in the desktop app) — never synced.',
			'Whatever it can see is sent to that provider when it works. Switch areas off in Settings → Assistant → What it can see.',
			'Its settings, memory and Inbox sync through your account like the rest of daylog.'
		],
		keywords: 'privacy key data provider claude gemini security'
	},
	{
		id: 'cost',
		section: 'privacy',
		title: 'Keeping cost and noise down',
		summary: 'Limits on spending and on interruptions.',
		points: [
			'Each device has a daily token limit for chat and for background work; it stops when that’s used up.',
			'"Use on this device" in Settings shows what each kind of work cost over the last week.',
			'Quiet hours: no notifications; suggestions still collect for later.',
			'A daily limit on unprompted suggestions; check-ins don’t count against it.'
		],
		keywords: 'cost tokens budget limit quiet hours notifications'
	}
];

/** Fills in the assistant's name. */
export const named = (text: string, name: string) => text.replaceAll('{name}', name);

/** Topics with every word of `query` somewhere in them (title, summary, points, keywords). */
export function searchTopics(topics: HelpTopic[], query: string, name = 'Jarvis'): HelpTopic[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return topics;
	return topics.filter((t) => {
		const hay = named(
			[
				t.title,
				t.summary,
				...t.points,
				t.keywords ?? '',
				SECTIONS.find((s) => s.id === t.section)?.label ?? ''
			].join(' '),
			name
		).toLowerCase();
		return words.every((w) => hay.includes(w));
	});
}

/** Splits text into plain and `code` parts for display. */
export function codeParts(text: string): { code: boolean; text: string }[] {
	return text
		.split(/(`[^`]+`)/)
		.filter(Boolean)
		.map((part) =>
			part.startsWith('`') && part.endsWith('`')
				? { code: true, text: part.slice(1, -1) }
				: { code: false, text: part }
		);
}

/** The getting-started checklist, ticked by hand and kept in this browser. */
export const CHECKLIST: { id: string; label: string; href?: string }[] = [
	{ id: 'line', label: 'Write a few lines on today’s page', href: '/day' },
	{ id: 'timetable', label: 'Add your weekly classes', href: '/schedule' },
	{ id: 'mention', label: 'Mention someone with @', href: '/day' },
	{ id: 'key', label: 'Add an API key for {name}', href: '/settings' },
	{ id: 'ask', label: 'Ask {name} “What’s up today?”' },
	{ id: 'checkin', label: 'Run a check-in with “Run now”', href: '/settings' },
	{ id: 'backup', label: 'Download a backup', href: '/settings' }
];
