/**
 * daylog as an MCP server, so Claude Desktop and Claude Code (on a Claude
 * subscription) can read and change daylog with the same tools Jarvis uses.
 *
 * The desktop app's local server (src-tauri/src/mcp.rs) receives each JSON-RPC
 * message, from `daylog --mcp` (the stdio bridge Claude starts) or straight
 * over HTTP, and hands it to the signed-in main window, which answers here.
 * Running the tools in the window means they behave exactly as they do for
 * Jarvis: the same ops layer, Undo bubbles, Inbox cards and Settings.
 *
 * Changes follow docs/assistant/decisions.md: small additions are applied at
 * once with an Undo bubble in daylog; everything else waits in the Inbox as a
 * card to apply there. Nothing is deleted.
 */
import { dateKey } from '../date';
import type { AssistantConfig } from './config';
import { addressName, DATA_AREAS, type DataArea } from './config';
import { memoryBlock, type MemoryItem } from './memory';
import { runTool, type Proposal, type Tool, type ToolContext } from './tools/registry';
import type { ToolDef } from './types';

/** Newest first; the first one a client asks for that's here is used. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** Told to the client when it connects; Claude reads it like a system prompt. */
export const MCP_INSTRUCTIONS = `daylog is the owner's personal planner: one page of plain text per day, plus their teaching schedule, tasks, deadlines, people, notes, long-term tasks, routines, money and computer time. These tools are the same ones daylog's built-in assistant uses.

- Call daylog_context first in a conversation: it gives today's date and time on the owner's computer, how to address them, areas switched off, and what the assistant remembers about them (follow those preferences).
- Look things up before answering about the owner's data. Never guess dates, times, ids, amounts or names. Resolve "today", "Thursday", "next week" against daylog_context. The work week runs Sunday to Thursday.
- Get ids from schedule_snapshot, find_transactions, search_notes, list_longterm or read_day first. Never invent one.
- To fit work into the week, find gaps with free_time and add tasks with time blocks inside them.
- Small additions (a line on a day, a task, a note, a subtask, a routine value, a memory) are applied at once and the owner sees an Undo in daylog. Other changes become cards in daylog's Inbox for the owner to apply there. Each result says which happened; tell the owner in a few words, and don't retry a card another way.
- Nothing can be deleted. A task no longer needed is marked dropped with a reason; a cancelled class is marked cancelled.
- Money: record what the owner says happened; ask which account when it isn't clear. A person giving money back is a borrow; the owner paying someone back is a lend.
- remember keeps lasting preferences and facts the app doesn't hold (shared with daylog's assistant); don't store tasks, events, money or notes there.`;

/** The one tool only MCP clients get: what Jarvis has in front of every message. */
const CONTEXT_TOOL: ToolDef = {
	name: 'daylog_context',
	description:
		"Today's date and time on the owner's computer, how to address the owner, which areas are switched off, and what daylog's assistant remembers about them. Call it first in a conversation.",
	parameters: { type: 'object', properties: {}, required: [] }
};

export interface McpDeps {
	uid: string;
	displayName: string | null;
	/** The synced assistant settings (areas, permissions), loaded per message. */
	loadConfig(): Promise<AssistantConfig>;
	loadMemory(): Promise<MemoryItem[]>;
	/** The tools on offer under `config` (areas switched off are left out). */
	tools(config: AssistantConfig): Tool[];
	/** What happens to a write tool's changes (applied with Undo, or an Inbox card). */
	propose(config: AssistantConfig, proposal: Proposal): Promise<string>;
	now?: () => Date;
	version?: string;
}

type Id = string | number | null;
interface Request {
	jsonrpc: '2.0';
	id?: Id;
	method?: string;
	params?: Record<string, unknown>;
}
export interface Response {
	jsonrpc: '2.0';
	id: Id;
	result?: unknown;
	error?: { code: number; message: string };
}

const ok = (id: Id, result: unknown): Response => ({ jsonrpc: '2.0', id, result });
const fail = (id: Id, code: number, message: string): Response => ({
	jsonrpc: '2.0',
	id,
	error: { code, message }
});

/** Answers one message (or a batch). Null when nothing is owed: notifications and responses. */
export async function handleMcp(
	message: unknown,
	deps: McpDeps
): Promise<Response | Response[] | null> {
	if (Array.isArray(message)) {
		if (!message.length) return fail(null, -32600, 'Empty batch.');
		const out = (await Promise.all(message.map((m) => handleOne(m, deps)))).filter(
			(r): r is Response => r !== null
		);
		return out.length ? out : null;
	}
	return handleOne(message, deps);
}

async function handleOne(message: unknown, deps: McpDeps): Promise<Response | null> {
	if (!message || typeof message !== 'object') return fail(null, -32600, 'Invalid request.');
	const req = message as Request;
	const id = req.id ?? null;
	// A notification (no id) or the client answering something: nothing to send back.
	if (!('id' in req) || req.id === undefined) return null;
	if (typeof req.method !== 'string') return null;
	const params = req.params ?? {};
	try {
		switch (req.method) {
			case 'initialize': {
				const asked = String(params.protocolVersion ?? '');
				return ok(id, {
					protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: 'daylog', title: 'daylog', version: deps.version ?? '1.0.0' },
					instructions: MCP_INSTRUCTIONS
				});
			}
			case 'ping':
				return ok(id, {});
			case 'tools/list': {
				const config = await deps.loadConfig();
				return ok(id, { tools: [CONTEXT_TOOL, ...deps.tools(config).map(toolDef)].map(toMcp) });
			}
			case 'tools/call':
				return ok(id, await callTool(params, deps));
			default:
				return fail(id, -32601, `Method not found: ${req.method}`);
		}
	} catch (e) {
		if (e instanceof UnknownTool) return fail(id, -32602, e.message);
		return fail(id, -32603, e instanceof Error ? e.message : String(e));
	}
}

class UnknownTool extends Error {}

const toolDef = (t: Tool) => ({ ...t.def, tool: t });

/** A tool as MCP lists it. */
function toMcp({ name, description, parameters, tool }: ToolDef & { tool?: Tool }) {
	const read = !tool || tool.kind === 'read';
	return {
		name,
		...(tool?.label ? { title: tool.label } : {}),
		description,
		inputSchema: parameters,
		annotations: {
			readOnlyHint: read,
			// Nothing is deleted; the one removal (forget) is a card to apply in daylog.
			destructiveHint: false,
			openWorldHint: false
		}
	};
}

async function callTool(params: Record<string, unknown>, deps: McpDeps) {
	const name = String(params.name ?? '');
	const input = (params.arguments ?? {}) as Record<string, unknown>;
	const config = await deps.loadConfig();
	const now = deps.now?.() ?? new Date();
	if (name === CONTEXT_TOOL.name) return text(await contextText(deps, config, now));
	const tools = deps.tools(config);
	if (!tools.some((t) => t.def.name === name)) {
		const known = deps.tools({ ...config, areas: allAreas() }).some((t) => t.def.name === name);
		if (known)
			return text(
				`${name} belongs to an area switched off in daylog → Settings → Assistant → What it can see.`,
				true
			);
		throw new UnknownTool(`Unknown tool: ${name}`);
	}
	const ctx: ToolContext = {
		uid: deps.uid,
		today: dateKey(now),
		cache: new Map(),
		navigate: () => {},
		propose: (proposal) => deps.propose(config, proposal)
	};
	const result = await runTool(tools, ctx, { id: 'mcp', name, input });
	return text(result.content, !!result.isError);
}

const text = (content: string, isError = false) => ({
	content: [{ type: 'text', text: content }],
	isError
});

const allAreas = () =>
	Object.fromEntries(DATA_AREAS.map((a) => [a.id, true])) as AssistantConfig['areas'];

const FULL_DATE = new Intl.DateTimeFormat('en-GB', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	year: 'numeric'
});
const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

async function contextText(deps: McpDeps, config: AssistantConfig, now: Date): Promise<string> {
	const hidden = DATA_AREAS.filter((a) => !config.areas[a.id as DataArea]).map((a) => a.label);
	const address = addressName(config, deps.displayName);
	const memory = await deps.loadMemory().catch(() => []);
	return [
		`Now: ${FULL_DATE.format(now)}, ${CLOCK.format(now)} (today is ${dateKey(now)})`,
		`Address the owner as: ${address || '(no name given)'}`,
		`daylog's own assistant is called ${config.name}; cards and bubbles in daylog say they came from Claude.`,
		hidden.length ? `Switched off in Settings: ${hidden.join(', ')}` : 'Every area is on.',
		'',
		memoryBlock(memory)
	].join('\n');
}
