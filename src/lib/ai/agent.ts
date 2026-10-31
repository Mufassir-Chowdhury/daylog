/**
 * One exchange with the assistant: your message goes in, it calls tools as
 * often as it needs (up to a limit), and its answer comes out. Provider-neutral
 * — the adapter does the talking.
 *
 * History is append-only. A turn that fails or runs out of steps isn't kept,
 * so the history always ends on a finished reply and stays valid for the
 * provider.
 */
import { logUsage, recordUsage, withinBudget, type RunKind } from './budget';
import type { DevicePrefs } from './device';
import { SYSTEM_PROMPT } from './prompt';
import { runTool, type Tool, type ToolContext } from './tools/registry';
import {
	AiError,
	type Adapter,
	type ModelSlot,
	type RunResult,
	type Turn,
	type Usage
} from './types';

export interface AgentOptions {
	adapter: Adapter;
	model: string;
	slot: ModelSlot;
	/** For the usage log in Settings. */
	kind: RunKind;
	prefs: DevicePrefs;
	tools: Tool[];
	ctx: ToolContext;
	/** The thread so far, in the provider's format. */
	history: unknown[];
	/** Your message, with the context block in front. */
	message: string;
	/** Called as each tool starts, with what it's doing. */
	onStep?: (text: string) => void;
	maxSteps?: number;
}

export interface AgentResult {
	text: string;
	/** What it looked at, in order ("Checking your schedule"). */
	steps: string[];
	stop: RunResult['stop'] | 'step_limit';
	/** The thread including this exchange — store it as the new history. */
	history: unknown[];
	usage: Usage;
}

export async function runAgent(o: AgentOptions): Promise<AgentResult> {
	const maxSteps = o.maxSteps ?? 8;
	const history = [...o.history];
	const steps: string[] = [];
	const usage: Usage = { input: 0, output: 0, cacheRead: 0 };
	let turn: Turn = { kind: 'user', text: o.message };

	for (let step = 0; ; step++) {
		if (!withinBudget(o.slot, o.prefs))
			throw new AiError(
				'budget',
				"Today's limit for this device is used up — raise it in Settings → Assistant, or try tomorrow."
			);
		const res = await o.adapter.send({
			model: o.model,
			system: SYSTEM_PROMPT,
			tools: o.tools.map((t) => t.def),
			// A copy: this list keeps growing after the call.
			history: [...history],
			turn
		});
		recordUsage(o.slot, res.usage);
		logUsage(o.kind, res.usage);
		usage.input += res.usage.input;
		usage.output += res.usage.output;
		usage.cacheRead += res.usage.cacheRead;
		history.push(...res.messages);

		if (res.stop !== 'tool_use') return { text: res.text, steps, stop: res.stop, history, usage };
		if (step >= maxSteps)
			return {
				text:
					res.text ||
					'That took more digging than I allow myself in one go. Could you narrow it down?',
				steps,
				stop: 'step_limit',
				// Pending tool calls can't be left unanswered; drop this exchange.
				history: [...o.history],
				usage
			};

		for (const call of res.calls) {
			const tool = o.tools.find((t) => t.def.name === call.name);
			const text = tool ? tool.describe(call.input) : call.name;
			steps.push(text);
			o.onStep?.(text);
		}
		const results = await Promise.all(res.calls.map((call) => runTool(o.tools, o.ctx, call)));
		turn = { kind: 'tool_results', results };
	}
}
