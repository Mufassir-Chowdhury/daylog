/**
 * Activity insights — turns the desktop app's raw foreground-window spans
 * (desktop/activity.cjs), plus time added by hand, into totals, focus
 * sessions, goal progress and plain-language observations. Pure functions
 * over plain data, so it's all unit-tested.
 */
import { addDays } from './date';
import type { ActivityCategory, ActivitySpan } from './desktop';

export type { ActivityCategory, ActivitySpan };

export const CATEGORIES: ActivityCategory[] = ['focus', 'communication', 'neutral', 'distraction'];

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
	focus: 'Focus',
	communication: 'Messages',
	neutral: 'Other',
	distraction: 'Distraction'
};

/** Fixed series colours (never re-ordered by rank). Neutral is grey: it's "everything else". */
export const CATEGORY_COLOR: Record<ActivityCategory, string> = {
	focus: 'var(--t-cat-3)',
	communication: 'var(--t-cat-1)',
	neutral: 'var(--t-faint)',
	distraction: 'var(--t-cat-2)'
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A focus session survives interruptions up to this long (a quick look at chat). */
export const FOCUS_GRACE = 2 * MINUTE;
/** Sessions at least this long count as deep work (one pomodoro). */
export const DEEP_WORK = 25 * MINUTE;
/** Gaps longer than this between spans are a break, not a switch. */
const BREAK = 2 * MINUTE;

// ——— Naming: which app, and for browsers which site ———

const BROWSERS =
	/^(chrome|google chrome|chromium|msedge|microsoft edge|firefox|brave|brave browser|opera|vivaldi|arc|safari|zen|librewolf|waterfox|yandex)$/i;

/** Trailing title segments browsers add: their own name and profile names. */
const BROWSER_SUFFIX =
	/^(google chrome|chromium|microsoft edge|mozilla firefox|firefox|brave|opera|vivaldi|arc|safari|zen browser|personal|work|profile \d+|inprivate|private browsing|incognito)$/i;

/** Sites recognised anywhere in a title, so `Inbox (3) - me@x.com - Gmail` is just Gmail. */
const KNOWN_SITES = [
	'YouTube',
	'Gmail',
	'GitHub',
	'GitLab',
	'Stack Overflow',
	'Reddit',
	'Facebook',
	'Messenger',
	'Instagram',
	'WhatsApp',
	'Telegram',
	'LinkedIn',
	'Netflix',
	'Prime Video',
	'Twitch',
	'TikTok',
	'Pinterest',
	'Wikipedia',
	'ChatGPT',
	'Claude',
	'Google Docs',
	'Google Sheets',
	'Google Slides',
	'Google Drive',
	'Google Calendar',
	'Outlook',
	'Notion',
	'Figma',
	'Overleaf',
	'LeetCode',
	'Coursera',
	'Udemy',
	'Discord',
	'Slack',
	'daylog'
];
const KNOWN_SITE_RE = KNOWN_SITES.map(
	(name) =>
		[name, new RegExp(`(^|[\\s|·:—–-])${name.replace(/ /g, '\\s')}($|[\\s|·:—–-])`, 'i')] as const
);

export function isBrowser(span: Pick<ActivitySpan, 'exe' | 'app'>): boolean {
	return BROWSERS.test(span.exe) || BROWSERS.test(span.app);
}

/**
 * The site a browser tab title points at — `How to X - Stack Overflow - Google
 * Chrome` → `Stack Overflow`. Null when the title says nothing useful.
 */
export function browserSite(title: string | undefined): string | null {
	if (!title) return null;
	// Edge pads its name with a zero-width space; X/Twitter titles end in "/ X".
	const clean = title.replace(/[\u200b-\u200d\ufeff]/g, '').trim();
	const parts = clean.split(/\s+[-—–|·]\s+/).filter(Boolean);
	while (parts.length && BROWSER_SUFFIX.test(parts[parts.length - 1])) parts.pop();
	const page = parts.join(' - ');
	if (/\/ X$/.test(page) || /\bon X:/.test(page)) return 'X';
	for (const [name, re] of KNOWN_SITE_RE) if (re.test(page)) return name;
	if (parts.length < 2) return null;
	const site = parts[parts.length - 1].trim();
	return site.length <= 40 ? site : null;
}

export interface Subject {
	/** Stable key for category overrides: `app:code`, `site:youtube`. */
	key: string;
	/** What to show: `Visual Studio Code`, `YouTube`. */
	label: string;
	/** For sites: the browser it was in. */
	via?: string;
}

/** What a span was spent on — the app, or for a browser the site. */
export function subjectOf(span: ActivitySpan): Subject {
	if (span.subject) return { key: span.subject, label: span.app };
	if (isBrowser(span)) {
		const site = browserSite(span.title);
		if (site) return { key: `site:${site.toLowerCase()}`, label: site, via: span.app };
	}
	return { key: `app:${span.exe.toLowerCase()}`, label: span.app || span.exe };
}

// ——— Categories ———

const FOCUS_APPS =
	/^(code|code - insiders|cursor|windsurf|zed|devenv|idea64|idea|pycharm64|pycharm|webstorm64|webstorm|rider64|clion64|goland64|phpstorm64|datagrip64|studio64|android studio|xcode|sublime_text|sublime text|notepad\+\+|vim|nvim|gvim|emacs|windowsterminal|wt|powershell|pwsh|cmd|conhost|alacritty|wezterm-gui|wezterm|iterm2|terminal|kitty|gnome-terminal-server|konsole|winword|excel|powerpnt|onenote|obsidian|logseq|notion|figma|blender|photoshop|illustrator|indesign|adobe premiere pro|afterfx|resolve|acrobat|acrord32|sumatrapdf|zotero|matlab|rstudio|postman|insomnia|docker desktop|unity|godot|tableau|anki|daylog|libreoffice|soffice|scrivener)$/i;

const COMMUNICATION_APPS =
	/^(slack|teams|ms-teams|msteams|outlook|olk|thunderbird|mail|discord|telegram|whatsapp|signal|zoom|skype|messenger|webex)$/i;

const DISTRACTION_APPS =
	/^(steam|steamwebhelper|epicgameslauncher|battle\.net|riotclientservices|leagueclient|netflix|tiktok|9gag|roblox|robloxplayerbeta|minecraft|javaw)$/i;

const FOCUS_SITES =
	/^(github|gitlab|stack overflow|google docs|google sheets|google slides|notion|figma|overleaf|leetcode|coursera|udemy|daylog|mdn web docs|codeforces|kaggle|jira|confluence|linear|vercel|cloudflare|firebase console|aws|azure)$/i;

const COMMUNICATION_SITES =
	/^(gmail|outlook|slack|discord|whatsapp|telegram|messenger|linkedin|google calendar|microsoft teams|teams)$/i;

const DISTRACTION_SITES =
	/^(youtube|netflix|prime video|twitch|tiktok|reddit|facebook|instagram|x|twitter|pinterest|tumblr|9gag|hulu|disney\+|imgur|hacker news|espn|cricbuzz)$/i;

/** Default category for a subject, before the user's overrides. */
export function defaultCategory(
	subject: Subject,
	span: Pick<ActivitySpan, 'exe' | 'app'>
): ActivityCategory {
	if (subject.key.startsWith('site:')) {
		if (FOCUS_SITES.test(subject.label)) return 'focus';
		if (COMMUNICATION_SITES.test(subject.label)) return 'communication';
		if (DISTRACTION_SITES.test(subject.label)) return 'distraction';
		return 'neutral';
	}
	const names = [span.exe, span.app];
	if (names.some((n) => FOCUS_APPS.test(n))) return 'focus';
	if (names.some((n) => COMMUNICATION_APPS.test(n))) return 'communication';
	if (names.some((n) => DISTRACTION_APPS.test(n))) return 'distraction';
	return 'neutral';
}

export type Overrides = Record<string, ActivityCategory>;

export function categorize(span: ActivitySpan, overrides: Overrides = {}): ActivityCategory {
	const subject = subjectOf(span);
	return overrides[subject.key] ?? defaultCategory(subject, span);
}

// ——— One day ———

export interface SubjectStat extends Subject {
	category: ActivityCategory;
	ms: number;
	/** Window titles that took the most time (documents, tabs, chats). */
	titles: { title: string; ms: number }[];
}

export interface FocusSession {
	start: number;
	end: number;
	/** Time actually in focus apps (excludes the short interruptions it survived). */
	ms: number;
	/** The subject that took most of it. */
	top: string;
	interruptions: number;
}

export interface DaySummary {
	date: string;
	active: number;
	byCategory: Record<ActivityCategory, number>;
	/** Most time first. */
	subjects: SubjectStat[];
	/** Milliseconds per local hour (0–23) per category. */
	hours: Record<ActivityCategory, number>[];
	/** Changes of app or site without a break in between. */
	switches: number;
	sessions: FocusSession[];
	/** Focus time inside sessions of DEEP_WORK or longer. */
	deepWork: number;
	longest: FocusSession | null;
	first: number | null;
	last: number | null;
	/** When the last stretch between midnight and 4 AM ended, if there was one. */
	lateNight: number | null;
}

const emptyByCategory = (): Record<ActivityCategory, number> => ({
	focus: 0,
	communication: 0,
	neutral: 0,
	distraction: 0
});

/** Spans of a day, sorted, with overlaps (clock changes, merged files) trimmed. */
function clean(spans: ActivitySpan[]): ActivitySpan[] {
	const sorted = spans.filter((s) => s.e > s.s).sort((a, b) => a.s - b.s);
	const out: ActivitySpan[] = [];
	for (const span of sorted) {
		const prev = out[out.length - 1];
		const s = prev ? Math.max(span.s, prev.e) : span.s;
		if (span.e > s) out.push({ ...span, s });
	}
	return out;
}

/** Adds a span's time to the hour buckets it covers. */
function addHours(
	hours: Record<ActivityCategory, number>[],
	span: ActivitySpan,
	cat: ActivityCategory
) {
	let t = span.s;
	while (t < span.e) {
		const d = new Date(t);
		const hourEnd = new Date(
			d.getFullYear(),
			d.getMonth(),
			d.getDate(),
			d.getHours() + 1
		).getTime();
		const end = Math.min(span.e, hourEnd);
		hours[d.getHours()][cat] += end - t;
		t = end;
	}
}

export function summarizeDay(
	date: string,
	raw: ActivitySpan[],
	overrides: Overrides = {}
): DaySummary {
	const spans = clean(raw);
	const byCategory = emptyByCategory();
	const hours = Array.from({ length: 24 }, emptyByCategory);
	const subjects = new Map<string, SubjectStat & { titleMap: Map<string, number> }>();
	let switches = 0;
	let prev: { key: string; e: number } | null = null;

	const sessions: FocusSession[] = [];
	let session: (FocusSession & { tally: Map<string, number> }) | null = null;
	/** Non-focus time since the session's last focus span. */
	let away = 0;

	const endSession = () => {
		if (session && session.ms > 0) {
			const top = [...session.tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
			sessions.push({
				start: session.start,
				end: session.end,
				ms: session.ms,
				top,
				interruptions: session.interruptions
			});
		}
		session = null;
		away = 0;
	};

	for (const span of spans) {
		const ms = span.e - span.s;
		const subject = subjectOf(span);
		const cat = overrides[subject.key] ?? defaultCategory(subject, span);
		byCategory[cat] += ms;
		addHours(hours, span, cat);

		let stat = subjects.get(subject.key);
		if (!stat) {
			stat = { ...subject, category: cat, ms: 0, titles: [], titleMap: new Map() };
			subjects.set(subject.key, stat);
		}
		stat.ms += ms;
		if (span.title) stat.titleMap.set(span.title, (stat.titleMap.get(span.title) ?? 0) + ms);

		const gap = prev ? span.s - prev.e : 0;
		if (prev && gap <= BREAK && prev.key !== subject.key) switches++;
		prev = { key: subject.key, e: span.e };

		// Focus sessions: a run of focus time that tolerates short detours and gaps.
		if (session && gap > 0) away += gap;
		if (session && away > FOCUS_GRACE) endSession();
		if (cat === 'focus') {
			if (!session) {
				session = {
					start: span.s,
					end: span.e,
					ms: 0,
					top: '',
					interruptions: 0,
					tally: new Map()
				};
			} else if (away > 0) session.interruptions++;
			session.ms += ms;
			session.end = span.e;
			session.tally.set(subject.label, (session.tally.get(subject.label) ?? 0) + ms);
			away = 0;
		} else if (session) {
			away += ms;
			if (away > FOCUS_GRACE) endSession();
		}
	}
	endSession();

	const list = [...subjects.values()]
		.map(({ titleMap, ...stat }) => ({
			...stat,
			titles: [...titleMap]
				.map(([title, ms]) => ({ title, ms }))
				.sort((a, b) => b.ms - a.ms)
				.slice(0, 5)
		}))
		.sort((a, b) => b.ms - a.ms);

	const deep = sessions.filter((s) => s.ms >= DEEP_WORK);
	return {
		date,
		active: CATEGORIES.reduce((sum, c) => sum + byCategory[c], 0),
		byCategory,
		subjects: list,
		hours,
		switches,
		sessions,
		deepWork: deep.reduce((sum, s) => sum + s.ms, 0),
		longest: sessions.reduce<FocusSession | null>((a, s) => (!a || s.ms > a.ms ? s : a), null),
		first: spans[0]?.s ?? null,
		last: spans[spans.length - 1]?.e ?? null,
		lateNight: spans.filter((sp) => new Date(sp.s).getHours() < 4).at(-1)?.e ?? null
	};
}

/**
 * One day's spans from every source: recorded spans (from any number of
 * computers) and time added by hand. A manual entry wins over whatever was
 * recorded in the same minutes — "2–3 PM was a meeting" overrides the
 * browser that happened to be open.
 */
export function mergeSources(tracked: ActivitySpan[], manual: ActivitySpan[]): ActivitySpan[] {
	const blocks = manual.filter((m) => m.e > m.s).sort((a, b) => a.s - b.s);
	const out: ActivitySpan[] = [];
	for (const span of tracked) {
		let pieces = [span];
		for (const b of blocks) {
			pieces = pieces.flatMap((p) => {
				if (b.e <= p.s || b.s >= p.e) return [p];
				const keep: ActivitySpan[] = [];
				if (b.s > p.s) keep.push({ ...p, e: b.s });
				if (b.e < p.e) keep.push({ ...p, s: b.e });
				return keep;
			});
		}
		out.push(...pieces);
	}
	return [...out, ...blocks.map((b) => ({ ...b, manual: true }))].sort((a, b) => a.s - b.s);
}

// ——— Goals ———

/** What a goal counts. */
export type GoalKind = 'total' | 'deep' | 'category' | 'subjects';

export interface ActivityGoal {
	id: string;
	kind: GoalKind;
	/** For `category` goals. */
	category: ActivityCategory;
	/** For `subjects` goals: the app/site keys that count (`app:code`, `site:github`). */
	keys: string[];
	/** Labels for `keys`, so the goal reads well on days those apps weren't used. */
	names: string[];
	minutes: number;
	/** A limit ("at most") rather than a target ("at least"). */
	limit: boolean;
}

export interface GoalProgress {
	goal: ActivityGoal;
	ms: number;
	target: number;
	/** 0–1+, how far along (for limits: how much of the allowance is used). */
	ratio: number;
	/** Targets: reached. Limits: still within it. */
	met: boolean;
}

/** Recorded time that counts towards a goal. */
export function goalTime(goal: ActivityGoal, day: DaySummary): number {
	switch (goal.kind) {
		case 'total':
			return day.active;
		case 'deep':
			return day.deepWork;
		case 'category':
			return day.byCategory[goal.category] ?? 0;
		case 'subjects': {
			const keys = new Set(goal.keys);
			return day.subjects.filter((s) => keys.has(s.key)).reduce((sum, s) => sum + s.ms, 0);
		}
	}
}

export function goalProgress(goal: ActivityGoal, day: DaySummary): GoalProgress {
	const ms = goalTime(goal, day);
	const target = goal.minutes * MINUTE;
	return {
		goal,
		ms,
		target,
		ratio: target > 0 ? ms / target : 0,
		met: goal.limit ? ms <= target : ms >= target
	};
}

/** `Deep work`, `Focus`, `VS Code + GitHub`. */
export function goalSubject(goal: ActivityGoal): string {
	switch (goal.kind) {
		case 'total':
			return 'Time at the computer';
		case 'deep':
			return 'Deep work';
		case 'category':
			return CATEGORY_LABEL[goal.category];
		case 'subjects':
			if (goal.names.length === 0) return 'Chosen apps';
			return goal.names.length > 3
				? `${goal.names.slice(0, 3).join(', ')} +${goal.names.length - 3}`
				: goal.names.join(', ');
	}
}

/** `Deep work · at least 4h 00m`. */
export function goalLabel(goal: ActivityGoal): string {
	return `${goalSubject(goal)} · ${goal.limit ? 'at most' : 'at least'} ${formatDuration(goal.minutes * MINUTE)}`;
}

/** Drops anything malformed from goals read back from storage. */
export function cleanGoals(raw: unknown): ActivityGoal[] {
	if (!Array.isArray(raw)) return [];
	const kinds: GoalKind[] = ['total', 'deep', 'category', 'subjects'];
	return raw.flatMap((g): ActivityGoal[] => {
		if (!g || typeof g !== 'object') return [];
		const r = g as Record<string, unknown>;
		const kind = kinds.find((k) => k === r.kind);
		const minutes = Number(r.minutes);
		if (!kind || !(minutes > 0)) return [];
		const strings = (v: unknown) =>
			Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
		return [
			{
				id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
				kind,
				category: CATEGORIES.find((c) => c === r.category) ?? 'focus',
				keys: strings(r.keys),
				names: strings(r.names),
				minutes: Math.round(minutes),
				limit: r.limit === true
			}
		];
	});
}

// ——— Across days ———

export interface Baseline {
	days: number;
	active: number;
	deepWork: number;
	switches: number;
	byCategory: Record<ActivityCategory, number>;
	/** Average ms per subject key, over all baseline days (zero on days it wasn't used). */
	subjects: Map<string, number>;
	/** Average focus ms in each hour of the day. */
	focusByHour: number[];
}

/** Daily averages over the days that have any activity. */
export function baseline(days: DaySummary[]): Baseline {
	const used = days.filter((d) => d.active > 0);
	const n = used.length || 1;
	const byCategory = emptyByCategory();
	const subjects = new Map<string, number>();
	const focusByHour = Array<number>(24).fill(0);
	for (const d of used) {
		for (const c of CATEGORIES) byCategory[c] += d.byCategory[c] / n;
		for (const s of d.subjects) subjects.set(s.key, (subjects.get(s.key) ?? 0) + s.ms / n);
		d.hours.forEach((h, i) => (focusByHour[i] += h.focus / n));
	}
	const avg = (f: (d: DaySummary) => number) => used.reduce((sum, d) => sum + f(d), 0) / n;
	return {
		days: used.length,
		active: avg((d) => d.active),
		deepWork: avg((d) => d.deepWork),
		switches: avg((d) => d.switches),
		byCategory,
		subjects,
		focusByHour
	};
}

/** The two-hour window with the most average focus time, as its starting hour. */
export function bestFocusWindow(focusByHour: number[]): { hour: number; share: number } | null {
	const total = focusByHour.reduce((a, b) => a + b, 0);
	if (total < 30 * MINUTE) return null;
	let best = 0;
	for (let h = 1; h < 23; h++) {
		if (focusByHour[h] + focusByHour[h + 1] > focusByHour[best] + focusByHour[best + 1]) best = h;
	}
	return { hour: best, share: (focusByHour[best] + focusByHour[best + 1]) / total };
}

/** Keys of the `n` days ending at `end` (inclusive), oldest first. */
export function dayRange(end: string, n: number): string[] {
	return Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));
}

// ——— Formatting ———

/** `2h 05m`, `42m`, `<1m`. */
export function formatDuration(ms: number): string {
	const minutes = Math.round(ms / MINUTE);
	if (minutes < 1) return ms > 0 ? '<1m' : '0m';
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
export const formatTime = (ms: number) => TIME.format(ms);

/** `9 AM`, `12 PM`. */
export function hourLabel(hour: number): string {
	const h = ((hour % 24) + 24) % 24;
	return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Relative change as `+25%` / `−10%`, or null when there's nothing to compare with. */
function change(now: number, before: number): number | null {
	return before > 0 ? (now - before) / before : null;
}

// ——— Insights ———

export type InsightTone = 'good' | 'warn' | 'info';

export interface Insight {
	tone: InsightTone;
	text: string;
}

/**
 * Plain-language observations about a day, against the days before it.
 * Ordered roughly by how useful they are; the page shows them all.
 */
export function insights(day: DaySummary, base: Baseline, isToday: boolean): Insight[] {
	const out: Insight[] = [];
	if (day.active < 5 * MINUTE) return out;
	const compare = base.days >= 3;
	const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
	const soFar = isToday ? ' so far' : '';

	// Time at the computer.
	const activeChange = change(day.active, base.active);
	if (compare && activeChange !== null && !isToday && Math.abs(activeChange) >= 0.15) {
		out.push({
			tone: 'info',
			text: `${formatDuration(day.active)} at the computer — ${pct(activeChange)} ${activeChange > 0 ? 'more' : 'less'} than your usual ${formatDuration(base.active)}.`
		});
	}

	// Deep work.
	const deep = day.sessions.filter((s) => s.ms >= DEEP_WORK);
	if (deep.length) {
		const deepChange = change(day.deepWork, base.deepWork);
		const vs =
			compare && deepChange !== null && Math.abs(deepChange) >= 0.15
				? ` — ${pct(deepChange)} ${deepChange > 0 ? 'above' : 'below'} your average`
				: '';
		out.push({
			tone: deepChange !== null && deepChange < -0.15 && !isToday ? 'warn' : 'good',
			text: `${formatDuration(day.deepWork)} of deep work${soFar} in ${deep.length} session${deep.length > 1 ? 's' : ''} of 25 minutes or more${vs}.`
		});
	} else if (day.byCategory.focus >= 15 * MINUTE) {
		out.push({
			tone: 'warn',
			text: `${formatDuration(day.byCategory.focus)} in focus apps${soFar}, but no stretch reached 25 minutes — the longest was ${formatDuration(day.longest?.ms ?? 0)}.`
		});
	}
	if (day.longest && day.longest.ms >= DEEP_WORK) {
		const l = day.longest;
		out.push({
			tone: 'good',
			text: `Longest focus stretch: ${formatDuration(l.ms)}, mostly in ${l.top}, from ${formatTime(l.start)} to ${formatTime(l.end)}${l.interruptions ? ` (${l.interruptions} quick detour${l.interruptions > 1 ? 's' : ''})` : ' without a single detour'}.`
		});
	}

	// Context switching.
	const activeHours = day.active / HOUR;
	if (day.switches >= 20 && activeHours > 0.5) {
		const every = day.active / day.switches;
		const switchChange = change(
			day.switches / activeHours,
			base.switches / Math.max(base.active / HOUR, 0.5)
		);
		const vs =
			compare && switchChange !== null && Math.abs(switchChange) >= 0.2
				? `, ${switchChange > 0 ? 'more jumpy' : 'calmer'} than usual`
				: '';
		out.push({
			tone: every < 2 * MINUTE ? 'warn' : 'info',
			text: `You switched between apps and sites ${day.switches} times — once every ${formatDuration(every)} on average${vs}.`
		});
	}

	// The biggest distraction, against its usual share.
	const distraction = day.subjects.find((s) => s.category === 'distraction');
	if (distraction && distraction.ms >= 10 * MINUTE) {
		const usual = base.subjects.get(distraction.key) ?? 0;
		const ratio = usual > 0 ? distraction.ms / usual : null;
		const vs =
			compare && ratio !== null && !isToday && (ratio >= 1.5 || ratio <= 0.67)
				? ratio >= 1.5
					? ` — ${ratio >= 2 ? `${Math.round(ratio * 10) / 10}×` : pct(ratio - 1) + ' more than'} your daily average`
					: ` — less than your usual ${formatDuration(usual)}`
				: '';
		out.push({
			tone: 'warn',
			text: `${distraction.label} took ${formatDuration(distraction.ms)}${soFar}${vs}.`
		});
	}

	// When distraction peaked.
	let peak = -1;
	day.hours.forEach((h, i) => {
		if (h.distraction > (peak < 0 ? 0 : day.hours[peak].distraction)) peak = i;
	});
	if (peak >= 0 && day.hours[peak].distraction >= 15 * MINUTE) {
		out.push({
			tone: 'info',
			text: `Distraction peaked between ${hourLabel(peak)} and ${hourLabel(peak + 1)} (${formatDuration(day.hours[peak].distraction)} of that hour).`
		});
	}

	// Messages and email.
	const comm = day.byCategory.communication;
	if (comm >= 20 * MINUTE) {
		const top = day.subjects.find((s) => s.category === 'communication');
		out.push({
			tone: comm / day.active > 0.3 ? 'warn' : 'info',
			text: `Messages and email took ${formatDuration(comm)} (${pct(comm / day.active)} of your time)${top ? `, mostly ${top.label}` : ''}.`
		});
	}

	// Best hours, and whether this day used them.
	const best = bestFocusWindow(base.focusByHour);
	if (best && base.days >= 5) {
		const window = day.hours[best.hour];
		const windowNext = day.hours[best.hour + 1];
		const spent = CATEGORIES.reduce((sum, c) => sum + window[c] + windowNext[c], 0);
		const focused = window.focus + windowNext.focus;
		const tail =
			spent >= 30 * MINUTE
				? focused / spent >= 0.6
					? ' This day used it well.'
					: ` This day it went to ${focused / spent < 0.25 ? 'other things' : 'a mix'} — ${formatDuration(focused)} of ${formatDuration(spent)} in focus.`
				: '';
		out.push({
			tone: 'info',
			text: `Your sharpest hours are ${hourLabel(best.hour)}–${hourLabel(best.hour + 2)}: ${pct(best.share)} of your focus time over the last ${base.days} days lands there.${tail}`
		});
	}

	// Late nights (the early hours belong to the night before, but they're in this day's file).
	const earlyHours = day.hours.slice(0, 4).flatMap((h) => CATEGORIES.map((c) => h[c]));
	if (day.lateNight !== null && earlyHours.reduce((a, b) => a + b, 0) >= 10 * MINUTE) {
		out.push({
			tone: 'warn',
			text: `You were at the computer after midnight, until ${formatTime(day.lateNight)}.`
		});
	}
	return out;
}

/** A one-line summary to append to the day's page. */
export function summaryLine(day: DaySummary): string {
	const top = day.subjects
		.slice(0, 3)
		.map((s) => `${s.label} ${formatDuration(s.ms)}`)
		.join(', ');
	const parts = [
		`screen time ${formatDuration(day.active)}`,
		`deep work ${formatDuration(day.deepWork)}`,
		day.switches ? `${day.switches} switches` : '',
		top ? `top: ${top}` : ''
	].filter(Boolean);
	return `activity — ${parts.join(' · ')}`;
}
