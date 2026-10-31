# Using daylog from Claude (MCP)

daylog's desktop app is an [MCP](https://modelcontextprotocol.io) server. Claude Desktop and
Claude Code can then read and change daylog with the same tools Jarvis uses. They run on your
Claude subscription (Pro or Max), with no API key. Jarvis keeps working in the app as before.

Part of the assistant docs: [plan](../../assistant.md) · [decisions](./decisions.md) ·
[progress](./progress.md).

## Connect it

1. **Turn it on.** In the daylog **desktop app**, go to Settings → **Use daylog from Claude**
   and tick **Let Claude use daylog on this computer**. The section then shows the exact text to
   paste, with this computer's paths filled in.
2. **Claude Desktop** (macOS, Windows):
   1. In Claude, open **Settings → Developer → Edit Config**. This opens
      `claude_desktop_config.json`:
      - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
      - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   2. Paste the snippet from daylog's Settings. It looks like this:

      ```json
      {
      	"mcpServers": {
      		"daylog": {
      			"command": "/Applications/daylog.app/Contents/MacOS/daylog",
      			"args": ["--mcp"]
      		}
      	}
      }
      ```

      On Windows the command is the installed `daylog.exe`, e.g.
      `C:\\Users\\you\\AppData\\Local\\daylog\\daylog.exe` (in JSON every `\` is written twice). If the file
      already has `mcpServers`, add only the `daylog` entry inside it.

   3. Quit Claude completely (from the tray / menu bar too) and open it again. **daylog** appears
      in the tools menu (the slider icon under the message box).

3. **Claude Code**: run the command from daylog's Settings once, for example:

   ```bash
   claude mcp add --scope user daylog -- "/Applications/daylog.app/Contents/MacOS/daylog" --mcp
   ```

   Then run `/mcp` inside Claude Code to check that it's connected.

4. Try it: "What's on my plate today?", "Add a task to grade the DM scripts on Saturday",
   "How much did I spend on transport this month?".

daylog has to be **running and signed in**. The tray is enough, and it starts at login by
default. If it isn't running, Claude gets a message saying so.

## What Claude can do

- Every tool from the areas ticked under Settings → Assistant → **What it can see**, except
  opening pages. There's also `daylog_context`, which gives Claude today's date on your computer,
  how to address you and what Jarvis remembers about you.
- **Small additions** (lines, tasks, notes, subtasks, routine values, memories) are applied at
  once. A bubble "from Claude" in daylog has **Undo**.
- **Other changes** (moving, cancelling, editing, money) become **cards in your Inbox** on
  today's page, for you to apply in daylog. The "Changes it makes without asking" ticks in
  Settings apply to Claude too.
- Nothing is deleted. Memories are shared with Jarvis.
- Claude Desktop also asks before running each tool, unless you've allowed it.

Not covered: claude.ai in the browser and the Claude mobile apps. They can only reach MCP
servers on the internet, and this one lives on your computer. That would need a hosted server
with its own sign-in, which may come later.

## How it works

```
Claude Desktop / Claude Code
   │ starts `daylog --mcp` (stdio: one JSON-RPC message per line)
   ▼
daylog --mcp  (src-tauri/src/mcp.rs → bridge)       no window, exits with Claude
   │ POST http://127.0.0.1:47615/mcp + Bearer token (read from the prefs file)
   ▼
running daylog app, local server (server.rs → mcp.rs)
   │ refuses: switched off · wrong token · any Origin header (web pages)
   │ event "mcp:request" → main window
   ▼
main window (src/lib/ai/mcp-host.ts → mcp.ts)      signed in; same tools as Jarvis
   │ tools/list, tools/call → tool registry → ops layer (Undo) / Inbox cards
   └──► invoke("mcp_reply") → back down the same path
```

- The token is random, made fresh each time access is switched on, and kept in
  `desktop-prefs.json`. Switching off forgets it.
- Clients that speak HTTP can use `http://127.0.0.1:<port>/mcp` with
  `Authorization: Bearer <token>`. The bridge is easier because it reads the token itself.
- A tool that takes longer than 90 seconds returns an error.
