# Regente

A terminal orchestrator for coding agents on macOS. Run multiple agents (Claude Code, Codex, Gemini CLI, OpenCode, or plain shell) in real terminals inside a single app — organized by workspaces and tabs, with **live status for every agent**: who's working, who's finished, and who's waiting on you.

- 🗂 **Workspaces** with terminal tabs (one workspace per project/repo, each with a default folder)
- 🚦 **Per-agent status** — 🔵 working · 🟢 finished, waiting for you · 🟠 waiting for input · ⚪ idle · 🔴 exited
- 🔔 **macOS notifications** when an agent finishes or asks for input while the app is unfocused (clicking jumps straight to that terminal)
- 📊 **Dashboard** with global and per-workspace counters
- ⌨️ **Configurable shortcuts** (Settings window, ⌘3) and per-agent startup command
- 🪝 For **Claude Code**, precise status via hooks (opt-in); process heuristics for everything else

## Requirements

- macOS (Apple Silicon or Intel)
- [Node.js](https://nodejs.org) 18+ and npm
- Xcode Command Line Tools (`xcode-select --install`) — needed to compile `node-pty`

## Getting started (fork/clone)

```bash
git clone https://github.com/natti-jpb/regente.git
cd regente
npm install    # rebuilds node-pty for Electron automatically
npm start      # run in dev mode
```

To install it as a real app (Dock icon, open via Spotlight):

```bash
npm run dist
cp -R dist/mac-arm64/Regente.app /Applications/   # on Intel: dist/mac-x64
```

Since the build happens on your own machine, Gatekeeper won't block it — only internet downloads require signing/notarization.

### Precise Claude Code status (optional, recommended)

In **Settings → Claude Code → Install** (or `npm run hooks:install`). This adds `UserPromptSubmit`, `Stop`, and `Notification` hooks to `~/.claude/settings.json` (with a `settings.json.bak-regente` backup). The hooks POST to `http://127.0.0.1:$REGENTE_PORT` and **only act in terminals opened by Regente** — anywhere else they're an instant no-op. To remove: `node scripts/install-claude-hooks.js --uninstall`.

The app works without the hooks too: status falls back to process heuristics (less precise for "finished" in TUIs that stay open).

## Default shortcuts

All remappable in Settings (click the shortcut and press the new combo; works even with focus inside the terminal).

| Shortcut | Action |
|---|---|
| ⌘T | New tab (terminal) |
| ⌘N | New workspace |
| ⌘⌫ | Close current tab |
| ⌘⇧⌫ | Delete current workspace |
| ⌘S / ⌘W | Next / previous tab |
| ⌘⇧S / ⌘⇧W | Next / previous workspace |
| ⌘1 | Dashboard |
| ⌘2 | Jump to the terminal that needs you |
| ⌘3 | Settings |

In modals, **Enter confirms/submits** (button pre-selected) and **Esc cancels**.

## Settings (⌘3)

- **Shortcuts** — remap any action; conflicts are resolved automatically
- **Terminal** — font size
- **Per-agent startup command** — e.g. `claude --permission-mode auto` (default)
- **Claude Code hooks** — install/verify

## Important behaviors

- **Closing the window does NOT kill your agents** — the app stays in the Dock; ⌘Q quits everything (agents included)
- On relaunch, tabs come back as idle shells in the right folder (agents don't auto-run — use ↻)
- Single-instance: opening the app again just focuses the existing window
- State and preferences live in `~/.regente/state.json`

## Development

```bash
npm start              # dev
npm run smoke          # PTY + hook server + status machine test, no window
REGENTE_DEBUG=1 npm start   # enables local debug endpoints (screenshots, key injection)
```

Architecture: PTYs and the status engine live in the main process (`main/`), vanilla JS renderer with xterm.js and no bundler (`renderer/`), JSON state. Shortcuts are intercepted in `before-input-event` (before xterm ever sees the key) and mirrored in the native menu.

## License

[MIT](LICENSE)
