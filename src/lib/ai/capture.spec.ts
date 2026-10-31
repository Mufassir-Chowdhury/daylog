import { describe, expect, it } from 'vitest';
import { captureCandidates, captureKey, newLines } from './capture';

const kinds = (text: string) => captureCandidates(text).map((c) => [c.line, c.kind]);

describe('captureCandidates', () => {
	it('picks money, cancellations and dated deadlines', () => {
		expect(
			kinds(
				[
					'gave @rahim 500',
					'spent 250 on lunch',
					'৳120 rickshaw',
					'DBMS class cancelled today',
					'no classes on sunday',
					'exam on nov 12',
					'submit the report by 14/11',
					'quiz thursday'
				].join('\n')
			)
		).toEqual([
			['gave @rahim 500', 'money'],
			['spent 250 on lunch', 'money'],
			['৳120 rickshaw', 'money'],
			['DBMS class cancelled today', 'cancel'],
			['no classes on sunday', 'cancel'],
			['exam on nov 12', 'deadline'],
			['submit the report by 14/11', 'deadline'],
			['quiz thursday', 'deadline']
		]);
	});

	it('leaves ordinary lines, undated deadline words and crossed-out lines alone', () => {
		expect(
			kinds(
				[
					'buy milk',
					'call @mom',
					'exam prep',
					'read 12 pages',
					'~~spent 250 on lunch~~',
					'21:00 gym'
				].join('\n')
			)
		).toEqual([]);
	});

	it('looks at timed lines too, as written', () => {
		expect(kinds('09:00AM paid 300 for the taxi')).toEqual([
			['09:00AM paid 300 for the taxi', 'money']
		]);
	});
});

describe('newLines and keys', () => {
	it('keeps only lines that are new', () => {
		expect(newLines('a\nb', 'a\nb\nspent 50\n\nc')).toBe('spent 50\nc');
		expect(newLines('a', 'a')).toBe('');
	});

	it('gives a line a stable key per day', () => {
		expect(captureKey('2026-10-31', 'gave @rahim 500')).toBe(
			captureKey('2026-10-31', 'gave @rahim 500')
		);
		expect(captureKey('2026-10-31', 'gave @rahim 500')).not.toBe(
			captureKey('2026-10-31', 'gave @rahim 600')
		);
		expect(captureKey('2026-10-31', 'x')).toMatch(/^capture:2026-10-31:[a-z0-9]+$/);
	});
});
