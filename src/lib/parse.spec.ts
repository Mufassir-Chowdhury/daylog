import { describe, expect, it } from 'vitest';
import {
	doneContent,
	extractMentions,
	highlightLine,
	isValidHandle,
	linesMentioning,
	parseDay,
	parseTime,
	segments,
	stripMention,
	timeLabel,
	toggleDone
} from './parse';

describe('parseTime', () => {
	it('parses 12h times with am/pm', () => {
		expect(parseTime('09:00PM call mom')).toEqual({ minutes: 21 * 60, rest: 'call mom' });
		expect(parseTime('9:00 pm call mom')).toEqual({ minutes: 21 * 60, rest: 'call mom' });
		expect(parseTime('12:30 AM launch')).toEqual({ minutes: 30, rest: 'launch' });
		expect(parseTime('12:00 pm lunch')).toEqual({ minutes: 12 * 60, rest: 'lunch' });
	});

	it('parses 24h times', () => {
		expect(parseTime('21:00 standup')).toEqual({ minutes: 21 * 60, rest: 'standup' });
		expect(parseTime('00:05 backup')).toEqual({ minutes: 5, rest: 'backup' });
	});

	it('allows a leading bullet', () => {
		expect(parseTime('- 09:00pm gym')).toEqual({ minutes: 21 * 60, rest: 'gym' });
		expect(parseTime('* 7:15 am run')).toEqual({ minutes: 7 * 60 + 15, rest: 'run' });
	});

	it('rejects non-times', () => {
		expect(parseTime('call at 9')).toBeNull();
		expect(parseTime('ratio 9:00000')).toBeNull();
		expect(parseTime('25:00 nope')).toBeNull();
		expect(parseTime('13:00pm nope')).toBeNull();
		expect(parseTime('9:75 pm nope')).toBeNull();
		expect(parseTime('meet @rahim 9:00pm')).toBeNull(); // time must start the line
	});
});

describe('timeLabel', () => {
	it('formats minutes as 12h labels', () => {
		expect(timeLabel(0)).toBe('12:00 AM');
		expect(timeLabel(21 * 60)).toBe('9:00 PM');
		expect(timeLabel(12 * 60 + 5)).toBe('12:05 PM');
	});
});

describe('segments', () => {
	it('splits text around mentions', () => {
		expect(segments('ask @Rahim about the invoice')).toEqual([
			{ kind: 'text', text: 'ask ' },
			{ kind: 'mention', handle: 'rahim', text: '@Rahim' },
			{ kind: 'text', text: ' about the invoice' }
		]);
	});

	it('does not swallow trailing punctuation', () => {
		expect(segments('call @rahim.')).toEqual([
			{ kind: 'text', text: 'call ' },
			{ kind: 'mention', handle: 'rahim', text: '@rahim' },
			{ kind: 'text', text: '.' }
		]);
	});

	it('keeps internal separators', () => {
		expect(segments('@mr.rahim-khan')).toEqual([
			{ kind: 'mention', handle: 'mr.rahim-khan', text: '@mr.rahim-khan' }
		]);
	});
});

describe('parseDay', () => {
	const text = [
		'buy milk',
		'',
		'09:00PM call @mom',
		'ask @Rahim for the report',
		'08:00 am standup'
	].join('\n');

	it('groups timed lines at the top, sorted by time', () => {
		const day = parseDay(text);
		expect(day.timed.map((l) => l.timeLabel)).toEqual(['8:00 AM', '9:00 PM']);
		expect(day.notes.map((l) => l.raw)).toEqual(['buy milk', 'ask @Rahim for the report']);
	});

	it('marks crossed-out lines done, keeping timed ones in the schedule', () => {
		const day = parseDay('~~buy milk~~\n~~09:00PM call @mom~~\nask @Rahim');
		expect(day.timed).toHaveLength(1);
		expect(day.timed[0]).toMatchObject({ done: true, timeLabel: '9:00 PM' });
		expect(day.notes.map((l) => [l.raw, l.done])).toEqual([
			['~~buy milk~~', true],
			['ask @Rahim', false]
		]);
		expect(day.notes[0].segments).toEqual([{ kind: 'text', text: 'buy milk' }]);
	});
});

describe('doneContent', () => {
	it('unwraps fully crossed-out lines only', () => {
		expect(doneContent('~~buy milk~~')).toBe('buy milk');
		expect(doneContent('  ~~buy milk~~ ')).toBe('buy milk');
		expect(doneContent('buy milk')).toBeNull();
		expect(doneContent('~~partial~~ but not all')).toBeNull();
		expect(doneContent('~~~~')).toBeNull();
	});
});

describe('toggleDone', () => {
	it('wraps and unwraps a line, preserving surrounding whitespace', () => {
		expect(toggleDone('buy milk')).toBe('~~buy milk~~');
		expect(toggleDone('~~buy milk~~')).toBe('buy milk');
		expect(toggleDone('  buy milk ')).toBe('  ~~buy milk~~ ');
		expect(toggleDone(toggleDone('  buy milk '))).toBe('  buy milk ');
		expect(toggleDone('   ')).toBe('   ');
	});
});

describe('extractMentions', () => {
	it('returns unique lowercase handles', () => {
		expect(extractMentions('@Rahim then @mom then @rahim again')).toEqual(['rahim', 'mom']);
		expect(extractMentions('no mentions here')).toEqual([]);
	});
});

describe('highlightLine', () => {
	it('preserves every character, including the time prefix', () => {
		const line = '- 09:00PM call @mom now';
		const { done, segments: segs } = highlightLine(line);
		expect(done).toBe(false);
		expect(segs.map((s) => s.text).join('')).toBe(line);
		expect(segs[0]).toEqual({ kind: 'time', text: '- 09:00PM' });
		expect(segs.some((s) => s.kind === 'mention' && s.text === '@mom')).toBe(true);
	});

	it('falls back to plain segments for untimed lines', () => {
		expect(highlightLine('ask @Rahim').segments.map((s) => s.kind)).toEqual(['text', 'mention']);
	});

	it('preserves every character of crossed-out lines, including the ~~ markers', () => {
		const line = ' ~~09:00PM call @mom~~ ';
		const { done, segments: segs } = highlightLine(line);
		expect(done).toBe(true);
		expect(segs.map((s) => s.text).join('')).toBe(line);
		expect(segs.some((s) => s.kind === 'time')).toBe(true);
	});
});

describe('isValidHandle', () => {
	it('accepts what MENTION_RE captures', () => {
		expect(isValidHandle('rahim')).toBe(true);
		expect(isValidHandle('mr.rahim-khan')).toBe(true);
	});

	it('rejects empty and malformed handles', () => {
		expect(isValidHandle('')).toBe(false);
		expect(isValidHandle('rahim.')).toBe(false);
		expect(isValidHandle('.rahim')).toBe(false);
		expect(isValidHandle('ra him')).toBe(false);
	});
});

describe('stripMention', () => {
	it('removes the @ from mentions of the handle only', () => {
		expect(stripMention('call @mom and @Rahim\n@rahim again', 'rahim')).toBe(
			'call @mom and Rahim\nrahim again'
		);
	});

	it('does not touch handles that merely share a prefix', () => {
		expect(stripMention('@rahim @rahim-khan', 'rahim')).toBe('rahim @rahim-khan');
	});
});

describe('linesMentioning', () => {
	it('finds only lines mentioning the handle', () => {
		const lines = linesMentioning('09:00PM call @mom\nask @Rahim\nbuy milk', 'rahim');
		expect(lines.map((l) => l.raw)).toEqual(['ask @Rahim']);
	});
});
