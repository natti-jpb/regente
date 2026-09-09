const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const Store = require('./store');
const PtyManager = require('./ptys');
const StatusEngine = require('./status');
const HookServer = require('./hooks-server');
const PRESETS = require('./presets');
const { rebuildMenu } = require('./menu');
const { installClaudeHooks } = require('../scripts/install-claude-hooks');

const SMOKE = process.argv.includes('--smoke');

// Instância única: duas instâncias compartilhando ~/.regente/state.json corrompem o estado
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (win) {
    win.show();
    win.focus();
  }
});

const store = new Store();
const state = store.load();
const ptys = new PtyManager();
const status = new StatusEngine(ptys);
const hookServer = new HookServer((sessionId, event, payload) =>
  status.onHookEvent(sessionId, event, payload)
);

// Só ativo com REGENTE_DEBUG=1 (verificação automatizada da UI em desenvolvimento)
hookServer.onDebug = async (url) => {
  if (url.pathname === '/debug/shot') {
    const file = url.searchParams.get('path');
    if (!win || !file) throw new Error('sem janela ou path');
    const img = await win.webContents.capturePage();
    fs.writeFileSync(file, img.toPNG());
    return { saved: file };
  }
  if (url.pathname === '/debug/view') {
    if (!win) throw new Error('sem janela');
    const type = url.searchParams.get('type') || 'dashboard';
    if (url.searchParams.get('action')) {
      win.webContents.send('ui:action', url.searchParams.get('action'));
    } else if (type === 'settings') {
      win.webContents.send('ui:open-settings');
    } else {
      win.webContents.send('ui:set-view', {
        type,
        id: url.searchParams.get('id') || undefined
      });
    }
    return { ok: true };
  }
  throw new Error('rota debug desconhecida');
};

let win = null;
let saveTimer = null;
let menuCaptureMode = false;

function refreshMenu() {
  rebuildMenu({
    settings: state.settings,
    captureMode: menuCaptureMode,
    onAction: (action) => {
      if (win && !win.isDestroyed()) {
        win.show();
        win.webContents.send('ui:action', action);
      }
    }
  });
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.save(state), 300);
}

function findTerminal(id) {
  for (const ws of state.workspaces) {
    const t = ws.terminals.find((t) => t.id === id);
    if (t) return { terminal: t, workspace: ws };
  }
  return {};
}

function publicState() {
  return {
    port: hookServer.port,
    home: os.homedir(),
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces,
    statuses: status.snapshot(),
    presets: PRESETS,
    presetCommands: state.presetCommands || {},
    settings: state.settings || {}
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('state:update', publicState());
}

function effectiveCommand(terminal) {
  if (terminal.command != null) return terminal.command;
  const override = (state.presetCommands || {})[terminal.presetId];
  if (override != null) return override;
  return PRESETS.find((p) => p.id === terminal.presetId)?.command || '';
}

function spawnTerminal(terminal, { runCommand } = {}) {
  ptys.spawn(terminal, { command: runCommand ? effectiveCommand(terminal) : null });
  status.markSpawned(terminal.id);
}

// ---------- Notificações ----------
status.on('change', (id, next, prev) => {
  if (win && !win.isDestroyed()) win.webContents.send('status:update', { id, status: next });
  if (next.state !== 'attention' || prev.state === 'attention') return;
  if (win && win.isFocused()) return; // usuário já está olhando
  const { terminal, workspace } = findTerminal(id);
  if (!terminal) return;
  const body =
    next.reason === 'input'
      ? 'Agente aguardando seu input/permissão'
      : 'Agente finalizou a tarefa';
  const n = new Notification({
    title: `${terminal.title} — ${workspace?.name || ''}`,
    body
  });
  n.on('click', () => {
    if (!win) return;
    win.show();
    win.focus();
    win.webContents.send('ui:focus-terminal', { id });
  });
  n.show();
});

// ---------- Eventos de PTY ----------
ptys.on('data', (id, data, seq) => {
  if (win && !win.isDestroyed()) win.webContents.send('pty:data', { id, data, seq });
});
ptys.on('exit', (id) => {
  status.markExited(id);
});

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('state:get', () => publicState());

  ipcMain.handle('ws:create', (_e, { name, dir }) => {
    const ws = {
      id: crypto.randomUUID(),
      name: name || 'Workspace',
      dir: dir || os.homedir(),
      color: pickColor(state.workspaces.length),
      terminals: []
    };
    state.workspaces.push(ws);
    state.activeWorkspaceId = ws.id;
    saveSoon();
    broadcast();
    return ws.id;
  });

  ipcMain.handle('ws:rename', (_e, { id, name }) => {
    const ws = state.workspaces.find((w) => w.id === id);
    if (ws && name) ws.name = name;
    saveSoon();
    broadcast();
  });

  ipcMain.handle('ws:delete', (_e, { id }) => {
    const ws = state.workspaces.find((w) => w.id === id);
    if (!ws) return;
    for (const t of ws.terminals) {
      ptys.remove(t.id);
      status.remove(t.id);
    }
    state.workspaces = state.workspaces.filter((w) => w.id !== id);
    if (state.activeWorkspaceId === id) {
      state.activeWorkspaceId = state.workspaces[0]?.id || null;
    }
    saveSoon();
    broadcast();
  });

  ipcMain.handle('ws:activate', (_e, { id }) => {
    state.activeWorkspaceId = id;
    saveSoon();
  });

  ipcMain.handle('term:create', (_e, { workspaceId, presetId, cwd, title, command, saveAsDefault }) => {
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return null;
    const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[PRESETS.length - 1];
    if (saveAsDefault && typeof command === 'string') {
      state.presetCommands = state.presetCommands || {};
      state.presetCommands[preset.id] = command;
    }
    const terminal = {
      id: crypto.randomUUID(),
      title: title || preset.name,
      presetId: preset.id,
      command: typeof command === 'string' ? command : undefined,
      cwd: cwd || ws.dir || os.homedir(),
      createdAt: new Date().toISOString()
    };
    ws.terminals.push(terminal);
    spawnTerminal(terminal, { runCommand: true });
    saveSoon();
    broadcast();
    return terminal.id;
  });

  ipcMain.handle('term:close', (_e, { id }) => {
    const { workspace } = findTerminal(id);
    ptys.remove(id);
    status.remove(id);
    if (workspace) {
      workspace.terminals = workspace.terminals.filter((t) => t.id !== id);
    }
    saveSoon();
    broadcast();
  });

  ipcMain.handle('term:restart', (_e, { id }) => {
    const { terminal } = findTerminal(id);
    if (terminal) {
      spawnTerminal(terminal, { runCommand: true });
      broadcast();
    }
  });

  ipcMain.handle('term:rename', (_e, { id, title }) => {
    const { terminal } = findTerminal(id);
    if (terminal && title) terminal.title = title;
    saveSoon();
    broadcast();
  });

  ipcMain.on('term:write', (_e, { id, data }) => {
    ptys.write(id, data);
    status.onUserInput(id);
  });

  ipcMain.on('term:resize', (_e, { id, cols, rows }) => {
    ptys.resize(id, cols, rows);
  });

  ipcMain.handle('term:buffer', (_e, id) => ptys.buffer(id));

  ipcMain.handle('dialog:dir', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('settings:update', (_e, patch) => {
    state.settings = { ...(state.settings || {}), ...patch };
    saveSoon();
    broadcast();
    refreshMenu();
  });

  // Desliga os accelerators do menu enquanto o usuário grava um atalho novo
  ipcMain.handle('menu:capture-mode', (_e, { on }) => {
    menuCaptureMode = !!on;
    refreshMenu();
  });

  ipcMain.handle('presets:setCommands', (_e, map) => {
    state.presetCommands = { ...(state.presetCommands || {}), ...map };
    saveSoon();
    broadcast();
  });

  ipcMain.handle('hooks:install', () => {
    try {
      return installClaudeHooks();
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });
}

function pickColor(i) {
  const colors = ['#4c8dff', '#bf5af2', '#32d74b', '#ff9f0a', '#64d2ff', '#ff6482'];
  return colors[i % colors.length];
}

// ---------- Janela ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e0e12',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
  });

  if (process.env.REGENTE_SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.REGENTE_SHOT, img.toPNG());
          console.log('screenshot saved:', process.env.REGENTE_SHOT);
        } catch (err) {
          console.error('screenshot failed:', err);
        }
      }, 3000);
    });
  }
}

// ---------- Smoke test ----------
async function runSmoke() {
  const waitFor = (fn, ms, label) =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        if (fn()) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - start > ms) {
          clearInterval(t);
          reject(new Error('timeout: ' + label));
        }
      }, 100);
    });
  try {
    const port = await hookServer.listen(state.port);
    ptys.port = port;
    let got = '';
    ptys.on('data', (id, d) => {
      if (id === 'smoke') got += d;
    });
    ptys.spawn({ id: 'smoke', cwd: os.homedir() }, {});
    status.markSpawned('smoke');
    ptys.write('smoke', 'echo REGENTE_$((20+22))\r');
    await waitFor(() => got.includes('REGENTE_42'), 15000, 'pty echo');

    const res = await fetch(`http://127.0.0.1:${port}/hooks/claude?session=smoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'Stop' })
    });
    if (res.status !== 200) throw new Error('hook http ' + res.status);
    await waitFor(
      () => status.snapshot()['smoke']?.state === 'attention',
      5000,
      'hook -> attention'
    );
    ptys.killAll();
    console.log('SMOKE OK (porta ' + port + ')');
    app.exit(0);
  } catch (err) {
    console.error('SMOKE FAIL:', err.message);
    app.exit(1);
  }
}

// ---------- Boot ----------
app.whenReady().then(async () => {
  if (SMOKE) {
    runSmoke();
    return;
  }

  const port = await hookServer.listen(state.port);
  ptys.port = port;
  if (state.port !== port) {
    state.port = port;
    saveSoon();
  }

  if (state.workspaces.length === 0) {
    state.workspaces.push({
      id: crypto.randomUUID(),
      name: 'Geral',
      dir: os.homedir(),
      color: pickColor(0),
      terminals: []
    });
    state.activeWorkspaceId = state.workspaces[0].id;
    saveSoon();
  }

  // Restaura os terminais persistidos como shells parados (sem auto-rodar agentes)
  for (const ws of state.workspaces) {
    for (const t of ws.terminals) spawnTerminal(t, { runCommand: false });
  }

  registerIpc();
  refreshMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Fechar a janela NÃO mata os agentes — o app continua no dock.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  ptys.killAll();
  status.dispose();
  hookServer.close();
  clearTimeout(saveTimer);
  store.save(state);
});
