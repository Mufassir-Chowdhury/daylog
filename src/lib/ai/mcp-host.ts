/**
 * The main window's side of the MCP server (see mcp.ts): while signed in, it
 * answers what the desktop shell relays from Claude. Started by the layout in
 * the desktop app only.
 */
import { listMemory, loadAssistantConfig, newInboxId } from '../db';
import type { DesktopBridge } from '../desktop';
import { invert } from '../ops/change';
import { describeChange } from '../ops/describe';
import { toast } from '../toast.svelte';
import { permissionFor } from './config';
import { PROPOSAL_LIFETIME } from './inbox';
import { applyChanges, putItem } from './inbox.svelte';
import { handleMcp, type McpDeps } from './mcp';
import { ALL_TOOLS } from './tools';
import { toolsFor, type Proposal } from './tools/registry';

/** Shown on bubbles and cards it leaves. */
const FROM = 'Claude';

export function mcpDeps(uid: string, displayName: string | null): McpDeps {
	return {
		uid,
		displayName,
		loadConfig: () => loadAssistantConfig(uid),
		loadMemory: () => listMemory(uid),
		// Opening pages makes no sense from another app.
		tools: (config) => toolsFor(config, ALL_TOOLS).filter((t) => t.kind !== 'ui'),
		propose: async (config, { tool, summary, changes }: Proposal) => {
			if (permissionFor(config, tool.def.name, !!tool.small) === 'auto') {
				await applyChanges(uid, changes);
				toast(`${summary}.`, {
					from: FROM,
					undo: () => applyChanges(uid, invert(changes))
				});
				return `Done: ${summary}. It's applied in daylog; the owner can undo it there.`;
			}
			const now = Date.now();
			putItem(uid, {
				id: newInboxId(uid),
				kind: 'proposal',
				source: 'chat',
				title: summary,
				body: `From ${FROM}.`,
				tool: tool.def.name,
				details: changes.flatMap(describeChange),
				changes,
				status: 'pending',
				signalKey: '',
				priority: 0,
				createdAt: now,
				expiresAt: now + PROPOSAL_LIFETIME
			});
			toast(`${FROM} suggested: ${summary}. It's in your Inbox on today's page.`, {
				from: FROM,
				duration: 8000
			});
			return (
				`Not applied yet: “${summary}” is waiting in daylog's Inbox (on today's page) for the owner to apply or dismiss. ` +
				"Tell them in a few words; don't try another way."
			);
		}
	};
}

/** Answers relayed requests until the returned function is called (sign-out, window closing). */
export function startMcpHost(
	desktop: DesktopBridge,
	uid: string,
	displayName: string | null
): () => void {
	const deps = mcpDeps(uid, displayName);
	const off = desktop.onMcpRequest(async ({ id, body }) => {
		let reply: string | null;
		try {
			const out = await handleMcp(JSON.parse(body), deps);
			reply = out === null ? null : JSON.stringify(out);
		} catch {
			reply = JSON.stringify({
				jsonrpc: '2.0',
				id: null,
				error: { code: -32700, message: 'Parse error.' }
			});
		}
		desktop.mcpReply(id, reply);
	});
	desktop.mcpReady(true);
	return () => {
		off();
		desktop.mcpReady(false);
	};
}
