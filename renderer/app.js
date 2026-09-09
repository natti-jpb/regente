const { ipcRenderer } = require('electron');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');

const XTERM_THEME = {
  background: '#12121a',
  foreground: '#ececf1',
  cursor: '#5b8def',
  selectionBackground: '#33415e',
  black: '#1c1c24', brightBlack: '#5c5c66',
  red: '#f45b69', brightRed: '#ff7a94',
  green: '#34d16b', brightGreen: '#5ce072',
  yellow: '#ffd60a', brightYellow: '#ffe04d',
  blue: '#5b8def', brightBlue: '#70a5ff',
  magenta: '#bf5af2', brightMagenta: '#d182f7',
  cyan: '#64d2ff', brightCyan: '#8adeff',
  white: '#d8d8de', brightWhite: '#ffffff'
};

let S = null; // snapshot do main: { workspaces, statuses, presets, presetCommands, activeWorkspaceId, port, home }
let view = { type: 'workspace', id: null };
const activeTab = new Map(); // wsId -> termId

const $ = (sel) => document.querySelector(sel);
const content = $('#content');

// Workspaces expandidos na sidebar (persistido localmente; default: expandido)
let collapsed = new Set();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem('regente.collapsed') || '[]'));
} catch {}
function saveCollapsed() {
  try {
    localStorage.setItem('regente.collapsed', JSON.stringify([...collapsed]));
  } catch {}
}

// ---------- Pool de terminais (xterm vive além dos re-renders) ----------
const pool = new Map(); // id -> { term, fit, host, lastSeq, ready, queue }

function getTermEntry(id) {
  let e = pool.get(id);
  if (e) return e;
  const term = new Terminal({
    fontSize: S?.settings?.fontSize || 13,
    fontFamily: "'SF Mono', Menlo, monospace",
    theme: XTERM_THEME,
    scrollback: 4000,
    macOptionIsMeta: true
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const host = document.createElement('div');
  host.className = 'term-host';
  term.open(host);
  term.onData((data) => ipcRenderer.send('term:write', { id, data }));
  e = { term, fit, host, lastSeq: 0, ready: false, queue: [] };
  pool.set(id, e);
  ipcRenderer.invoke('term:buffer', id).then(({ data, seq }) => {
    if (data) term.write(data);
    e.lastSeq = seq;
    e.ready = true;
    for (const item of e.queue) {
      if (item.seq > e.lastSeq) {
        term.write(item.data);
        e.lastSeq = item.seq;
      }
    }
    e.queue = [];
  });
  return e;
}

function dropTermEntry(id) {
  const e = pool.get(id);
  if (e) {
    try { e.term.dispose(); } catch {}
    pool.delete(id);
  }
}

function fitTerm(id) {
  const e = pool.get(id);
  if (!e || !e.host.isConnected) return;
  try {
    e.fit.fit();
    ipcRenderer.send('term:resize', { id, cols: e.term.cols, rows: e.term.rows });
  } catch {}
}

let fitDebounce = null;
window.addEventListener('resize', () => {
  clearTimeout(fitDebounce);
  fitDebounce = setTimeout(() => {
    for (const id of pool.keys()) fitTerm(id);
  }, 120);
});

// ---------- Helpers ----------
function allTerminals() {
  const out = [];
  for (const ws of S.workspaces) for (const t of ws.terminals) out.push({ t, ws });
  return out;
}
function findTerm(id) {
  return allTerminals().find((x) => x.t.id === id);
}
function statusOf(id) {
  return S.statuses[id] || { state: 'starting' };
}
function stKey(st) {
  if (st.state === 'attention') return st.reason === 'input' ? 'attention-input' : 'attention-done';
  return st.state;
}
const ST_LABEL = {
  working: 'Trabalhando',
  'attention-done': 'Finalizou — te esperando',
  'attention-input': 'Aguardando você',
  idle: 'Ocioso',
  exited: 'Encerrado',
  starting: '…'
};
function shortPath(p) {
  return p && S.home && p.startsWith(S.home) ? '~' + p.slice(S.home.length) : p || '';
}
function presetOf(t) {
  return S.presets.find((p) => p.id === t.presetId) || { icon: '❯', name: 'Shell', command: '' };
}
function effectiveCmd(preset) {
  const o = S.presetCommands?.[preset.id];
  return o != null ? o : preset.command;
}
function attnCount(terminals) {
  return terminals.filter((t) => statusOf(t.id).state === 'attention').length;
}
function currentWs() {
  return view.type === 'workspace' ? S.workspaces.find((w) => w.id === view.id) : null;
}
function activeTermOf(ws) {
  if (!ws || !ws.terminals.length) return null;
  const id = activeTab.get(ws.id);
  return ws.terminals.find((t) => t.id === id) || ws.terminals[0];
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ---------- Sidebar ----------
function renderSidebar() {
  const list = $('#ws-list');
  list.innerHTML = '';
  const dashAttn = attnCount(allTerminals().map((x) => x.t));
  const dashBadge = $('#dash-attn');
  dashBadge.textContent = dashAttn;
  dashBadge.classList.toggle('hidden', dashAttn === 0);
  $('#dash-item').classList.toggle('active', view.type === 'dashboard');

  for (const ws of S.workspaces) {
    const isOpen = !collapsed.has(ws.id);
    const isActive = view.type === 'workspace' && view.id === ws.id;
    const attn = attnCount(ws.terminals);

    const row = document.createElement('div');
    row.className = 'side-item ws-row' + (isActive ? ' active' : '');
    row.innerHTML = `
      <button class="chev ${isOpen ? 'open' : ''}" title="${isOpen ? 'Ocultar' : 'Expandir'} abas">▶</button>
      <span class="ws-dot" style="background:${ws.color}"></span>
      <span class="side-name">${esc(ws.name)}</span>
      ${attn ? `<span class="attn-badge">${attn}</span>` : ''}
      <span class="side-actions">
        <button class="mini-btn" data-act="rename" title="Renomear">✎</button>
        <button class="mini-btn" data-act="delete" title="Excluir">✕</button>
      </span>`;
    row.addEventListener('click', (ev) => {
      const act = ev.target.dataset?.act;
      if (act === 'rename') return renameWorkspace(ws);
      if (act === 'delete') return deleteWorkspace(ws);
      if (ev.target.classList.contains('chev')) {
        collapsed.has(ws.id) ? collapsed.delete(ws.id) : collapsed.add(ws.id);
        saveCollapsed();
        renderSidebar();
        return;
      }
      setView({ type: 'workspace', id: ws.id });
    });
    list.appendChild(row);

    if (isOpen && ws.terminals.length) {
      const box = document.createElement('div');
      box.className = 'ws-terms';
      for (const t of ws.terminals) {
        const key = stKey(statusOf(t.id));
        const isTabActive = isActive && activeTermOf(ws)?.id === t.id;
        const tr = document.createElement('div');
        tr.className = 'term-row' + (isTabActive ? ' active' : '');
        tr.innerHTML = `
          <span class="status-dot st-${key}"></span>
          <span class="side-name">${esc(t.title)}</span>`;
        tr.addEventListener('click', () => {
          activeTab.set(ws.id, t.id);
          setView({ type: 'workspace', id: ws.id });
        });
        box.appendChild(tr);
      }
      list.appendChild(box);
    }
  }
}

// ---------- Main ----------
function renderMain() {
  const title = $('#view-title');
  const subtitle = $('#view-subtitle');
  const addBtn = $('#term-add');

  if (view.type === 'dashboard') {
    title.textContent = 'Dashboard';
    subtitle.textContent = 'Visão geral dos agentes';
    addBtn.classList.add('hidden');
    renderDashboard();
    return;
  }

  const ws = currentWs() || S.workspaces[0];
  if (!ws) {
    content.innerHTML = '<div class="empty-state">Crie um workspace na sidebar para começar.</div>';
    addBtn.classList.add('hidden');
    return;
  }
  view.id = ws.id;
  title.textContent = ws.name;
  subtitle.textContent = shortPath(ws.dir);
  addBtn.classList.remove('hidden');

  if (!ws.terminals.length) {
    content.innerHTML = `
      <div class="empty-state">
        <div>Nenhum terminal neste workspace.</div>
        <button class="primary-btn" id="empty-add">＋ Terminal</button>
      </div>`;
    $('#empty-add').addEventListener('click', openNewTerminalModal);
    return;
  }

  content.innerHTML = `
    <div id="tabbar"></div>
    <div id="term-meta"></div>
    <div id="term-stage"></div>`;
  renderTabs();
}

function renderTabs() {
  const ws = currentWs();
  if (!ws) return;
  const tabbar = $('#tabbar');
  if (!tabbar) return;
  const active = activeTermOf(ws);
  activeTab.set(ws.id, active?.id);

  tabbar.innerHTML = '';
  for (const t of ws.terminals) {
    const key = stKey(statusOf(t.id));
    const tab = document.createElement('div');
    tab.className =
      'tab' +
      (t.id === active?.id ? ' active' : '') +
      (key === 'attention-input' ? ' attn-input' : key === 'attention-done' ? ' attn-done' : '');
    tab.dataset.tab = t.id;
    tab.innerHTML = `
      <span class="status-dot st-${key}"></span>
      <span class="tab-title">${esc(t.title)}</span>
      <button class="tab-close" title="Fechar">✕</button>`;
    tab.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('tab-close')) return closeTerminal(t);
      activeTab.set(ws.id, t.id);
      renderTabs();
      renderSidebar();
    });
    tab.addEventListener('dblclick', (ev) => {
      if (!ev.target.classList.contains('tab-close')) renameTerminal(t);
    });
    tabbar.appendChild(tab);
  }
  renderTermMeta(active);
  mountStage(active);
}

function renderTermMeta(t) {
  const meta = $('#term-meta');
  if (!meta || !t) return;
  const key = stKey(statusOf(t.id));
  meta.innerHTML = `
    <span class="meta-cwd">${esc(shortPath(t.cwd))}</span>
    <span class="status-chip st-${key}" id="meta-chip">${ST_LABEL[key] || key}</span>
    <button class="mini-btn" data-act="rename" title="Renomear aba">✎</button>
    <button class="mini-btn" data-act="restart" title="Reiniciar (roda o comando de novo)">↻</button>`;
  meta.querySelector('[data-act=rename]').addEventListener('click', () => renameTerminal(t));
  meta.querySelector('[data-act=restart]').addEventListener('click', () => {
    const go = () => ipcRenderer.invoke('term:restart', { id: t.id });
    if (statusOf(t.id).state === 'working') {
      confirmModal(`Reiniciar "${t.title}"?`, 'O agente está trabalhando — reiniciar vai matar o processo.', go);
    } else go();
  });
}

function mountStage(t) {
  const stage = $('#term-stage');
  if (!stage || !t) return;
  stage.innerHTML = '';
  const entry = getTermEntry(t.id);
  stage.appendChild(entry.host);
  requestAnimationFrame(() => {
    fitTerm(t.id);
    entry.term.focus();
  });
}

function closeTerminal(t) {
  const st = statusOf(t.id);
  const go = () => {
    dropTermEntry(t.id);
    ipcRenderer.invoke('term:close', { id: t.id });
  };
  if (st.state === 'working' || st.state === 'attention') {
    confirmModal(`Fechar "${t.title}"?`, 'A sessão será encerrada e removida do workspace.', go);
  } else go();
}

// ---------- Dashboard ----------
function countStatuses() {
  const c = { open: 0, working: 0, attention: 0, idle: 0, exited: 0 };
  for (const { t } of allTerminals()) {
    c.open++;
    const st = statusOf(t.id).state;
    if (c[st] != null) c[st]++;
  }
  return c;
}

function renderDashboard() {
  const c = countStatuses();
  const wsRows = S.workspaces
    .map((ws) => {
      const wc = { working: 0, attention: 0 };
      for (const t of ws.terminals) {
        const st = statusOf(t.id).state;
        if (wc[st] != null) wc[st]++;
      }
      return `
        <div class="ws-stat-row" data-ws="${ws.id}">
          <span class="ws-dot" style="background:${ws.color}"></span>
          <span class="side-name">${esc(ws.name)}</span>
          <span class="ws-stat-counts">
            <span>${ws.terminals.length} abertas</span>
            <span><span class="status-dot st-working"></span>${wc.working}</span>
            <span><span class="status-dot st-attention-input"></span>${wc.attention}</span>
          </span>
        </div>`;
    })
    .join('');

  content.innerHTML = `
    <div id="dash">
      <div class="stats-row">
        <div class="stat-tile">
          <div class="stat-num">${c.open}</div>
          <div class="stat-label">Terminais abertos</div>
        </div>
        <div class="stat-tile working">
          <div class="stat-num">${c.working}</div>
          <div class="stat-label">Trabalhando</div>
        </div>
        <div class="stat-tile attention">
          <div class="stat-num">${c.attention}</div>
          <div class="stat-label">Finalizados — aguardando você</div>
        </div>
      </div>
      <div class="stats-sub">${c.idle} ociosos · ${c.exited} encerrados</div>
      <div class="ws-stats">${wsRows}</div>
    </div>`;
  for (const row of content.querySelectorAll('.ws-stat-row')) {
    row.addEventListener('click', () => setView({ type: 'workspace', id: row.dataset.ws }));
  }
}

// ---------- Modais ----------
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal">${html}</div>`;
  root.classList.remove('hidden');
  return root.querySelector('.modal');
}
function closeModal() {
  const root = $('#modal-root');
  root.classList.add('hidden');
  root.innerHTML = '';
}
$('#modal-root').addEventListener('click', (ev) => {
  if (ev.target.id === 'modal-root') closeModal();
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !$('#modal-root').classList.contains('hidden')) closeModal();
});

function confirmModal(title, message, onConfirm) {
  const m = openModal(`
    <h2>${esc(title)}</h2>
    <p class="note">${esc(message)}</p>
    <div class="modal-actions">
      <button class="ghost-btn" data-act="cancel">Cancelar</button>
      <button class="primary-btn" data-act="ok">Confirmar</button>
    </div>`);
  m.querySelector('[data-act=cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-act=ok]').addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}

function promptModal(title, initial, onSubmit) {
  const m = openModal(`
    <h2>${esc(title)}</h2>
    <input type="text" value="${esc(initial || '')}" />
    <div class="modal-actions">
      <button class="ghost-btn" data-act="cancel">Cancelar</button>
      <button class="primary-btn" data-act="ok">Salvar</button>
    </div>`);
  const input = m.querySelector('input');
  input.focus();
  input.select();
  const submit = () => {
    const v = input.value.trim();
    closeModal();
    if (v) onSubmit(v);
  };
  input.addEventListener('keydown', (ev) => ev.key === 'Enter' && submit());
  m.querySelector('[data-act=cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-act=ok]').addEventListener('click', submit);
}

// ---------- Workspaces ----------
$('#ws-add').addEventListener('click', () => {
  const m = openModal(`
    <h2>Novo workspace</h2>
    <label>Nome</label>
    <input type="text" id="ws-name" placeholder="ex: beconfident-api" />
    <label>Pasta padrão</label>
    <div class="row">
      <input type="text" id="ws-dir" value="${esc(S.home)}" />
      <button class="ghost-btn" id="ws-pick">Escolher…</button>
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" data-act="cancel">Cancelar</button>
      <button class="primary-btn" data-act="ok">Criar</button>
    </div>`);
  m.querySelector('#ws-name').focus();
  m.querySelector('#ws-pick').addEventListener('click', async () => {
    const dir = await ipcRenderer.invoke('dialog:dir');
    if (dir) m.querySelector('#ws-dir').value = dir;
  });
  m.querySelector('[data-act=cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-act=ok]').addEventListener('click', async () => {
    const name = m.querySelector('#ws-name').value.trim() || 'Workspace';
    const dir = m.querySelector('#ws-dir').value.trim();
    closeModal();
    const id = await ipcRenderer.invoke('ws:create', { name, dir });
    setView({ type: 'workspace', id });
  });
});

function renameWorkspace(ws) {
  promptModal('Renomear workspace', ws.name, (name) =>
    ipcRenderer.invoke('ws:rename', { id: ws.id, name })
  );
}
function deleteWorkspace(ws) {
  confirmModal(
    `Excluir "${ws.name}"?`,
    `Isso encerra ${ws.terminals.length} terminal(is) e remove o workspace.`,
    () => {
      for (const t of ws.terminals) dropTermEntry(t.id);
      if (view.type === 'workspace' && view.id === ws.id) view = { type: 'dashboard' };
      ipcRenderer.invoke('ws:delete', { id: ws.id });
    }
  );
}
function renameTerminal(t) {
  promptModal('Renomear aba', t.title, (title) =>
    ipcRenderer.invoke('term:rename', { id: t.id, title })
  );
}

// ---------- Novo terminal ----------
function openNewTerminalModal() {
  const ws = currentWs();
  if (!ws) return;
  let selected = S.presets[0];
  const m = openModal(`
    <h2>Nova aba em ${esc(ws.name)}</h2>
    <label>Agente</label>
    <div class="preset-grid">
      ${S.presets
        .map(
          (p) => `
        <button class="preset-btn ${p.id === selected.id ? 'selected' : ''}" data-preset="${p.id}">
          <span class="preset-icon">${p.icon}</span>${esc(p.name)}
        </button>`
        )
        .join('')}
    </div>
    <label>Comando de inicialização</label>
    <input type="text" id="t-cmd" value="${esc(effectiveCmd(selected))}" placeholder="ex: claude --permission-mode auto" spellcheck="false" />
    <label class="check-row"><input type="checkbox" id="t-save-default" /> <span id="t-save-label">Salvar como padrão de ${esc(selected.name)}</span></label>
    <label>Pasta</label>
    <div class="row">
      <input type="text" id="t-cwd" value="${esc(ws.dir || S.home)}" />
      <button class="ghost-btn" id="t-pick">Escolher…</button>
    </div>
    <label>Título da aba (opcional)</label>
    <input type="text" id="t-title" placeholder="ex: fix login bug" />
    <div class="modal-actions">
      <button class="ghost-btn" data-act="cancel">Cancelar</button>
      <button class="primary-btn" data-act="ok">Abrir</button>
    </div>`);
  const cmdInput = m.querySelector('#t-cmd');
  for (const btn of m.querySelectorAll('.preset-btn')) {
    btn.addEventListener('click', () => {
      selected = S.presets.find((p) => p.id === btn.dataset.preset);
      m.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      cmdInput.value = effectiveCmd(selected);
      m.querySelector('#t-save-label').textContent = `Salvar como padrão de ${selected.name}`;
    });
  }
  m.querySelector('#t-pick').addEventListener('click', async () => {
    const dir = await ipcRenderer.invoke('dialog:dir');
    if (dir) m.querySelector('#t-cwd').value = dir;
  });
  m.querySelector('[data-act=cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-act=ok]').addEventListener('click', async () => {
    const cwd = m.querySelector('#t-cwd').value.trim();
    const title = m.querySelector('#t-title').value.trim();
    const command = cmdInput.value.trim();
    const saveAsDefault = m.querySelector('#t-save-default').checked;
    closeModal();
    const folder = cwd.split('/').filter(Boolean).pop() || '';
    const id = await ipcRenderer.invoke('term:create', {
      workspaceId: ws.id,
      presetId: selected.id,
      cwd,
      title: title || `${selected.name} · ${folder}`,
      command,
      saveAsDefault
    });
    if (id) activeTab.set(ws.id, id);
  });
}
$('#term-add').addEventListener('click', openNewTerminalModal);

// ---------- Atalhos ----------
// Os atalhos são registrados como accelerators do menu nativo (main/menu.js) —
// o main manda a ação via 'ui:action'. Aqui fica só a UI de configuração.
const { DEFAULT_SHORTCUTS, ACTION_LABELS } = require('../main/shortcuts');
let capturingShortcut = false;

function effShortcuts() {
  return { ...DEFAULT_SHORTCUTS, ...(S?.settings?.shortcuts || {}) };
}
function normKey(k) {
  return k.length === 1 ? k.toLowerCase() : k;
}
function comboLabel(c) {
  if (!c) return '—';
  const KEYS = { Tab: '⇥', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Espaço' };
  let s = '';
  if (c.ctrl) s += '⌃';
  if (c.alt) s += '⌥';
  if (c.shift) s += '⇧';
  if (c.meta) s += '⌘';
  return s + (KEYS[c.key] || (c.key.length === 1 ? c.key.toUpperCase() : c.key));
}

function cycleTab(dir) {
  const ws = currentWs();
  if (!ws || ws.terminals.length < 2) return;
  const cur = activeTermOf(ws);
  const i = ws.terminals.findIndex((t) => t.id === cur.id);
  const next = ws.terminals[(i + dir + ws.terminals.length) % ws.terminals.length];
  activeTab.set(ws.id, next.id);
  renderTabs();
  renderSidebar();
}
function cycleWorkspace(dir) {
  if (!S.workspaces.length) return;
  let i = view.type === 'workspace' ? S.workspaces.findIndex((w) => w.id === view.id) : -1;
  i = (i + dir + S.workspaces.length) % S.workspaces.length;
  setView({ type: 'workspace', id: S.workspaces[i].id });
}
function jumpToAttention() {
  const list = allTerminals().filter((x) => statusOf(x.t.id).state === 'attention');
  if (!list.length) return;
  const ws = currentWs();
  const curId = ws ? activeTermOf(ws)?.id : null;
  const idx = list.findIndex((x) => x.t.id === curId);
  const next = list[(idx + 1) % list.length];
  activeTab.set(next.ws.id, next.t.id);
  setView({ type: 'workspace', id: next.ws.id });
}

const ACTION_RUNNERS = {
  'new-terminal': () => {
    if (view.type !== 'workspace') return;
    openNewTerminalModal();
  },
  'next-tab': () => cycleTab(1),
  'prev-tab': () => cycleTab(-1),
  'next-workspace': () => cycleWorkspace(1),
  'prev-workspace': () => cycleWorkspace(-1),
  dashboard: () => setView({ type: 'dashboard' }),
  'next-attention': jumpToAttention,
  settings: () => openSettingsModal()
};

// Ações disparadas pelos accelerators do menu nativo
ipcRenderer.on('ui:action', (_e, action) => {
  if (!S || capturingShortcut) return;
  ACTION_RUNNERS[action]?.();
});

// ---------- Ajustes ----------
function openSettingsModal() {
  closeModal();
  let local = effShortcuts();

  const scRows = () =>
    Object.keys(DEFAULT_SHORTCUTS)
      .map(
        (a) => `
      <div class="sc-row">
        <span class="sc-label">${esc(ACTION_LABELS[a])}</span>
        <button class="sc-combo" data-action="${a}">${comboLabel(local[a])}</button>
        <button class="mini-btn sc-reset" data-action="${a}" title="Restaurar padrão">↺</button>
      </div>`
      )
      .join('');

  const presetRows = S.presets
    .map(
      (p) => `
    <div class="sc-row">
      <span class="sc-label">${p.icon} ${esc(p.name)}</span>
      <input type="text" class="preset-cmd" data-preset="${p.id}"
        value="${esc(effectiveCmd(p))}" placeholder="(shell puro)" spellcheck="false" />
    </div>`
    )
    .join('');

  const m = openModal(`
    <h2>Ajustes</h2>
    <div class="settings-body">
      <h3>Atalhos</h3>
      <p class="note">Clique no atalho e pressione a combinação nova (precisa de ⌘/⌃/⌥ · Esc cancela).</p>
      <div id="sc-list">${scRows()}</div>
      <h3>Terminal</h3>
      <div class="sc-row">
        <span class="sc-label">Tamanho da fonte</span>
        <input type="number" id="set-font" min="9" max="20" value="${S.settings?.fontSize || 13}" />
      </div>
      <h3>Comando de inicialização por agente</h3>
      ${presetRows}
      <h3>Claude Code</h3>
      <div class="sc-row">
        <span class="sc-label">Hooks de status em ~/.claude/settings.json</span>
        <button class="ghost-btn" id="set-hooks">Instalar</button>
      </div>
      <p class="note">Os hooks só agem em terminais do Regente (no-op fora dele) e são o que dá status preciso do Claude.</p>
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" id="sc-defaults">Restaurar atalhos padrão</button>
      <button class="primary-btn" data-act="ok">Fechar</button>
    </div>`);

  const saveShortcuts = () =>
    ipcRenderer.invoke('settings:update', { shortcuts: local });

  const bindScList = () => {
    for (const btn of m.querySelectorAll('.sc-combo')) {
      btn.addEventListener('click', () => beginCapture(btn, btn.dataset.action));
    }
    for (const btn of m.querySelectorAll('.sc-reset')) {
      btn.addEventListener('click', () => {
        local[btn.dataset.action] = DEFAULT_SHORTCUTS[btn.dataset.action];
        saveShortcuts();
        refreshList();
      });
    }
  };
  const refreshList = () => {
    m.querySelector('#sc-list').innerHTML = scRows();
    bindScList();
  };
  const beginCapture = (btn, action) => {
    capturingShortcut = true;
    ipcRenderer.invoke('menu:capture-mode', { on: true }); // senão o accelerator engole a tecla
    btn.classList.add('capturing');
    btn.textContent = 'pressione…';
    const onKey = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') return finish();
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(ev.key)) return;
      if (!(ev.metaKey || ev.ctrlKey || ev.altKey)) return; // exige modificador
      const combo = {
        meta: ev.metaKey, ctrl: ev.ctrlKey, alt: ev.altKey, shift: ev.shiftKey,
        key: normKey(ev.key)
      };
      // remove conflito: outra ação com o mesmo atalho perde o binding
      for (const [a, c] of Object.entries(local)) {
        if (a !== action && c && comboLabel(c) === comboLabel(combo)) local[a] = null;
      }
      local[action] = combo;
      saveShortcuts();
      finish();
    };
    const finish = () => {
      window.removeEventListener('keydown', onKey, true);
      capturingShortcut = false;
      ipcRenderer.invoke('menu:capture-mode', { on: false });
      refreshList();
    };
    window.addEventListener('keydown', onKey, true);
  };
  bindScList();

  m.querySelector('#sc-defaults').addEventListener('click', () => {
    local = { ...DEFAULT_SHORTCUTS };
    saveShortcuts();
    refreshList();
  });

  m.querySelector('#set-font').addEventListener('change', (ev) => {
    const v = Math.min(20, Math.max(9, Number(ev.target.value) || 13));
    ipcRenderer.invoke('settings:update', { fontSize: v });
  });

  for (const input of m.querySelectorAll('.preset-cmd')) {
    input.addEventListener('change', () => {
      const map = {};
      for (const i of m.querySelectorAll('.preset-cmd')) map[i.dataset.preset] = i.value.trim();
      ipcRenderer.invoke('presets:setCommands', map);
    });
  }

  m.querySelector('#set-hooks').addEventListener('click', async (ev) => {
    const res = await ipcRenderer.invoke('hooks:install');
    ev.target.textContent = res.error ? 'Erro' : res.added?.length ? 'Instalados ✓' : 'Já instalados ✓';
  });

  m.querySelector('[data-act=ok]').addEventListener('click', closeModal);
}
$('#settings-btn').addEventListener('click', openSettingsModal);

// ---------- Navegação ----------
$('#dash-item').addEventListener('click', () => setView({ type: 'dashboard' }));

function setView(v) {
  view = v;
  if (v.type === 'workspace' && v.id) ipcRenderer.invoke('ws:activate', { id: v.id });
  render();
}

function render() {
  if (!S) return;
  renderSidebar();
  renderMain();
}

// Atualização pontual de status (sem remontar o terminal)
function updateStatusUI(id) {
  renderSidebar();
  if (view.type === 'dashboard') {
    renderDashboard();
    return;
  }
  const key = stKey(statusOf(id));
  const tab = document.querySelector(`.tab[data-tab="${id}"]`);
  if (tab) {
    tab.classList.toggle('attn-input', key === 'attention-input');
    tab.classList.toggle('attn-done', key === 'attention-done');
    tab.querySelector('.status-dot').className = `status-dot st-${key}`;
  }
  const ws = currentWs();
  if (ws && activeTermOf(ws)?.id === id) {
    const chip = $('#meta-chip');
    if (chip) {
      chip.className = `status-chip st-${key}`;
      chip.textContent = ST_LABEL[key] || key;
    }
  }
}

// ---------- IPC ----------
ipcRenderer.on('pty:data', (_e, { id, data, seq }) => {
  const e = pool.get(id);
  if (!e) return;
  if (!e.ready) {
    e.queue.push({ data, seq });
    return;
  }
  if (seq <= e.lastSeq) return;
  e.lastSeq = seq;
  e.term.write(data);
});

ipcRenderer.on('status:update', (_e, { id, status }) => {
  if (!S) return;
  const prevKey = stKey(statusOf(id));
  S.statuses[id] = status;
  if (prevKey === stKey(status)) return; // ex: working(output) <-> working(quiet)
  updateStatusUI(id);
});

let currentFontSize = null;
function applyFontSize() {
  const fs = S?.settings?.fontSize || 13;
  if (fs === currentFontSize) return;
  currentFontSize = fs;
  for (const e of pool.values()) e.term.options.fontSize = fs;
  for (const id of pool.keys()) fitTerm(id);
}

ipcRenderer.on('state:update', (_e, next) => {
  S = next;
  applyFontSize();
  render();
});

ipcRenderer.on('ui:focus-terminal', (_e, { id }) => {
  const found = findTerm(id);
  if (!found) return;
  activeTab.set(found.ws.id, id);
  setView({ type: 'workspace', id: found.ws.id });
});

// Usado apenas em desenvolvimento (REGENTE_DEBUG) para verificação automatizada
ipcRenderer.on('ui:set-view', (_e, v) => setView(v));
ipcRenderer.on('ui:open-settings', () => openSettingsModal());

// ---------- Boot ----------
(async () => {
  S = await ipcRenderer.invoke('state:get');
  currentFontSize = S?.settings?.fontSize || 13;
  view = { type: 'workspace', id: S.activeWorkspaceId || S.workspaces[0]?.id };
  $('#port-label').textContent = `hooks em 127.0.0.1:${S.port}`;
  render();
})();
