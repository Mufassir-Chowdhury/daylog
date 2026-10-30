/** Every tool the assistant has, in a fixed order (the order is part of the cached prompt). */
import { ACTIVITY_TOOLS } from './activity';
import { DAY_TOOLS } from './days';
import { FINANCE_TOOLS } from './finance';
import { LONGTERM_TOOLS } from './longterm';
import { NOTE_TOOLS } from './notes';
import { PEOPLE_TOOLS } from './people';
import type { Tool } from './registry';
import { ROUTINE_TOOLS } from './routines';
import { SCHEDULE_TOOLS } from './schedule';
import { UI_TOOLS } from './ui';

export const ALL_TOOLS: Tool[] = [
	...DAY_TOOLS,
	...SCHEDULE_TOOLS,
	...PEOPLE_TOOLS,
	...NOTE_TOOLS,
	...LONGTERM_TOOLS,
	...ROUTINE_TOOLS,
	...FINANCE_TOOLS,
	...ACTIVITY_TOOLS,
	...UI_TOOLS
];
