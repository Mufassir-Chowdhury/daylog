/** The app's top-level pages — shared by the web header, desktop sidebar and command palette. */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { IconName } from './components/Icon.svelte';
import { dateKey } from './date';
import { desktop } from './desktop';

export interface NavItem {
	label: string;
	href: () => string;
	/** Path prefix that marks the item active. */
	match: string;
	/** Letter after the `g` leader key. */
	key: string;
	icon: IconName;
}

export const dayHref = (key: string) => resolve('/day/[date]', { date: key });

export const NAV: NavItem[] = [
	{ label: 'Today', href: () => dayHref(dateKey()), match: '/day', key: 'd', icon: 'today' },
	{
		label: 'Schedule',
		href: () => resolve('/schedule'),
		match: '/schedule',
		key: 'w',
		icon: 'schedule'
	},
	{ label: 'People', href: () => resolve('/people'), match: '/people', key: 'p', icon: 'people' },
	{ label: 'Notes', href: () => resolve('/notes'), match: '/notes', key: 'n', icon: 'notes' },
	{
		label: 'Routines',
		href: () => resolve('/routines'),
		match: '/routines',
		key: 'r',
		icon: 'routines'
	},
	{
		label: 'Finance',
		href: () => resolve('/finance'),
		match: '/finance',
		key: 'f',
		icon: 'finance'
	},
	// Activity tracking needs to see other apps, which only the desktop app can.
	...(desktop
		? [
				{
					label: 'Activity',
					href: () => resolve('/activity'),
					match: '/activity',
					key: 'a',
					icon: 'activity'
				} satisfies NavItem
			]
		: []),
	{
		label: 'Settings',
		href: () => resolve('/settings'),
		match: '/settings',
		key: 's',
		icon: 'settings'
	}
];

/**
 * Navigates to an app path that was already built with `resolve()` — a NAV
 * href, or a route handed over by the palette, tray or quick bar.
 */
export function go(path: string): Promise<void> {
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolved paths
	return goto(path);
}
