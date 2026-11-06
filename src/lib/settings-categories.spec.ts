import { afterEach, describe, expect, it } from 'vitest';
import { categoryOptions } from './finance';
import { applySettings, settings } from './settings.svelte';

afterEach(() => applySettings({}));

describe('custom categories', () => {
	it('defaults to empty lists and ignores malformed stored values', () => {
		applySettings({});
		expect(settings.customCategories).toEqual({ income: [], expense: [] });
		applySettings({ customCategories: 'nope' as never });
		expect(settings.customCategories).toEqual({ income: [], expense: [] });
		applySettings({ customCategories: { expense: ['rent', 3, '', 'rent'] } as never });
		expect(settings.customCategories).toEqual({ income: [], expense: ['rent'] });
	});

	it('adds the user’s categories after the base list without duplicates', () => {
		applySettings({ customCategories: { income: ['freelance'], expense: ['rent', 'lunch'] } });
		expect(categoryOptions('expense', ['lunch', 'transport'])).toEqual([
			'lunch',
			'transport',
			'rent'
		]);
		expect(categoryOptions('income', ['salary'])).toEqual(['salary', 'freelance']);
		expect(categoryOptions('transfer', ['transfer'])).toEqual(['transfer']);
	});
});
