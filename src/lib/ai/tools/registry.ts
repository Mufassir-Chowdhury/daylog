/**
 * The assistant's tools: how it reads (and, from Step 3, changes) each part
 * of the app. A tool is a schema the model sees plus a `run` that does the
 * work. Inputs are validated here before `run`, since not every provider
 * guarantees them.
 */
import type { Change } from '../../ops/change';
import type { AssistantConfig, DataArea } from '../config';
import type { Schema, ToolCall, ToolDef, ToolResult } from '../types';

export interface ToolContext {
	uid: string;
	/** Today's day key, fixed for the whole conversation turn. */
	today: string;
	/** Loads shared by the tools of one turn (see `cached`). */
	cache: Map<string, Promise<unknown>>;
	/** Opens a page in the app. */
	navigate: (path: string) => void;
	/**
	 * Hands planned changes to whoever is running the assistant: they're applied
	 * at once or shown as a card. Returns what to tell the model. Without it
	 * (background runs) write tools refuse.
	 */
	propose?: (proposal: Proposal) => Promise<string>;
}

/** What a write tool wants to do. */
export interface Plan {
	changes: Change[];
	/** One line in plain words: "Add “Grade DM” to Later". */
	summary: string;
}

export interface Proposal extends Plan {
	tool: Tool;
}

export interface Tool {
	def: ToolDef;
	/**
	 * Tools of an area switched off in Settings are left out. `ui` tools and the
	 * assistant's own (memory) are always there.
	 */
	area: DataArea | 'ui' | 'assistant';
	/** `ui` acts on the screen only (opening a page); background runs get `read` tools only. */
	kind: 'read' | 'write' | 'ui';
	/** What it's doing, in a few words, for the chat ("Checking your schedule"). */
	describe(input: Record<string, unknown>): string;
	/** Read and ui tools: does the work and returns what the model sees. */
	run?(ctx: ToolContext, input: Record<string, unknown>): Promise<unknown>;
	/** Write tools: works out the changes; `ctx.propose` decides what happens to them. */
	plan?(ctx: ToolContext, input: Record<string, unknown>): Promise<Plan>;
	/** Write tools: a small addition, applied at once with Undo unless Settings say otherwise. */
	small?: boolean;
	/** Write tools: what it does, for Settings ("Add tasks"). */
	label?: string;
}

/** Runs `load` once per turn for `key`, so several tools can share a fetch. */
export function cached<T>(ctx: ToolContext, key: string, load: () => Promise<T>): Promise<T> {
	let hit = ctx.cache.get(key) as Promise<T> | undefined;
	if (!hit) ctx.cache.set(key, (hit = load()));
	return hit;
}

export function toolsFor(config: AssistantConfig, all: Tool[]): Tool[] {
	return all.filter((t) => t.area === 'ui' || t.area === 'assistant' || config.areas[t.area]);
}

/** Where a value breaks the schema, or null when it fits. */
export function validate(schema: Schema, value: unknown, path = 'input'): string | null {
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	if (value === null) return types.includes('null') ? null : `${path} can't be null`;
	const actual = Array.isArray(value)
		? 'array'
		: Number.isInteger(value) && types.includes('integer')
			? 'integer'
			: typeof value;
	if (!types.includes(actual) && !(actual === 'integer' && types.includes('number')))
		return `${path} should be ${types.filter((t) => t !== 'null').join(' or ')}`;
	if (schema.enum && !schema.enum.includes(value as string | number))
		return `${path} should be one of ${schema.enum.join(', ')}`;
	if (actual === 'object' && schema.properties) {
		const obj = value as Record<string, unknown>;
		for (const key of schema.required ?? []) {
			// A missing nullable value is as good as null.
			const prop = schema.properties[key];
			const nullable = Array.isArray(prop?.type) && prop.type.includes('null');
			if (!(key in obj) && !nullable) return `${path}.${key} is missing`;
		}
		for (const [key, v] of Object.entries(obj)) {
			const prop = schema.properties[key];
			if (!prop) return `${path}.${key} isn't a known field`;
			const problem = validate(prop, v, `${path}.${key}`);
			if (problem) return problem;
		}
	}
	if (actual === 'array' && schema.items) {
		for (const [i, item] of (value as unknown[]).entries()) {
			const problem = validate(schema.items, item, `${path}[${i}]`);
			if (problem) return problem;
		}
	}
	return null;
}

/** Longest tool output sent back to the model; long results are cut with a note. */
const MAX_RESULT = 12_000;

export function serializeResult(result: unknown): string {
	const text = typeof result === 'string' ? result : JSON.stringify(result);
	if (text === undefined) return 'Done.';
	return text.length <= MAX_RESULT
		? text
		: `${text.slice(0, MAX_RESULT)}… [cut — ask for a narrower range for the rest]`;
}

/** Runs one call; any problem becomes an error result the model can read and fix. */
export async function runTool(
	tools: Tool[],
	ctx: ToolContext,
	call: ToolCall
): Promise<ToolResult> {
	const fail = (content: string): ToolResult => ({
		callId: call.id,
		name: call.name,
		content,
		isError: true
	});
	const tool = tools.find((t) => t.def.name === call.name);
	if (!tool) return fail(`There's no tool called ${call.name}.`);
	const problem = validate(tool.def.parameters, call.input);
	if (problem) return fail(`Invalid input: ${problem}.`);
	// Missing nullable fields read as null.
	const input = { ...call.input };
	for (const key of Object.keys(tool.def.parameters.properties ?? {}))
		if (!(key in input)) input[key] = null;
	try {
		if (tool.kind === 'write') {
			if (!ctx.propose || !tool.plan)
				return fail('Changes aren’t allowed here; describe them instead.');
			const plan = await tool.plan(ctx, input);
			const content = plan.changes.length
				? await ctx.propose({ ...plan, tool })
				: `Nothing to change — ${plan.summary} is already the case.`;
			return { callId: call.id, name: call.name, content };
		}
		return {
			callId: call.id,
			name: call.name,
			content: serializeResult(await tool.run!(ctx, input))
		};
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e));
	}
}

// ——— Small schema helpers for tool definitions.

export const str = (description: string): Schema => ({ type: 'string', description });
export const optStr = (description: string): Schema => ({ type: ['string', 'null'], description });
export const optInt = (description: string): Schema => ({ type: ['integer', 'null'], description });
export const num = (description: string): Schema => ({ type: 'number', description });
export const optNum = (description: string): Schema => ({ type: ['number', 'null'], description });
export const optBool = (description: string): Schema => ({
	type: ['boolean', 'null'],
	description
});
export const strList = (description: string): Schema => ({
	type: 'array',
	items: { type: 'string' },
	description
});
export const enumOf = (values: string[], description: string): Schema => ({
	type: 'string',
	enum: values,
	description
});
export const optEnum = (values: string[], description: string): Schema => ({
	type: ['string', 'null'],
	enum: values,
	description
});

export function params(properties: Record<string, Schema>): ToolDef['parameters'] {
	return { type: 'object', properties, required: Object.keys(properties) };
}

/** Throws a readable error unless `value` is a `YYYY-MM-DD` key. */
export function dayKey(value: unknown, name = 'date'): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		throw new Error(`${name} should be a date like 2026-10-30.`);
	return value;
}

/** Drops empty strings, nulls and `false`s so results cost fewer tokens. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false)
	) as Partial<T>;
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

/** `2026-10-30` → `Fri`. */
export const weekday = (key: string) =>
	WEEKDAY.format(
		new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8)))
	);
