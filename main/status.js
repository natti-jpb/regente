const { EventEmitter } = require('events');
const { execFile } = require('child_process');

// Estados finais expostos à UI:
//   working   — agente/processo rodando no terminal
//   attention — precisa de você (reason: 'done' = finalizou, 'input' = aguardando input/permissão)
//   idle      — shell parado, nada rodando
//   exited    — o shell do terminal encerrou
//
// Fontes: hooks do Claude Code (precisos) + heurística por processos filhos do shell.
const OUTPUT_ACTIVE_MS = 4000;
const MIN_CHILD_LIFE_MS = 30_000; // filho que viveu menos que isso (ls, git st) não vira "finalizou"

class StatusEngine extends EventEmitter {
  constructor(ptys) {
    super();
    this.ptys = ptys;
    this.st = new Map(); // terminalId -> estado interno
    this.timer = setInterval(() => this.tick(), 2000);
  }

  ensure(id) {
    if (!this.st.has(id)) {
      this.st.set(id, {
        current: null,
        hook: null,
        hasChild: false,
        childSince: null,
        exited: false
      });
    }
    return this.st.get(id);
  }

  markSpawned(id) {
    const s = this.ensure(id);
    s.exited = false;
    s.hook = null;
    s.hasChild = false;
    s.childSince = null;
    this.compute(id);
  }

  markExited(id) {
    const s = this.ensure(id);
    s.exited = true;
    this.compute(id);
  }

  remove(id) {
    this.st.delete(id);
  }

  onHookEvent(id, event) {
    const s = this.ensure(id);
    if (event === 'UserPromptSubmit' || event === 'PreToolUse' || event === 'PostToolUse') {
      s.hook = { state: 'working', at: Date.now() };
    } else if (event === 'Stop') {
      s.hook = { state: 'attention', reason: 'done', at: Date.now() };
    } else if (event === 'Notification') {
      s.hook = { state: 'attention', reason: 'input', at: Date.now() };
    } else if (event === 'SessionEnd') {
      s.hook = null;
    }
    this.compute(id);
  }

  // Qualquer tecla do usuário no terminal limpa o "precisa de você"
  onUserInput(id) {
    const s = this.ensure(id);
    if (s.hook?.state === 'attention') {
      s.hook = { state: 'working', at: Date.now() };
      this.compute(id);
    }
  }

  async tick() {
    let children;
    try {
      children = await psChildrenMap();
    } catch {
      return;
    }
    for (const sess of this.ptys.list()) {
      if (!sess.alive) continue;
      const s = this.ensure(sess.id);
      const had = s.hasChild;
      s.hasChild = (children.get(sess.pty.pid) || []).length > 0;
      if (s.hasChild && !had) s.childSince = Date.now();
      if (!s.hasChild && had) {
        const life = Date.now() - (s.childSince || Date.now());
        // Heurística p/ agentes sem hooks: processo longo terminou -> atenção
        if (life > MIN_CHILD_LIFE_MS && !s.hook) {
          s.hook = { state: 'attention', reason: 'done', at: Date.now() };
        }
      }
      this.compute(sess.id);
    }
  }

  compute(id) {
    const s = this.ensure(id);
    const sess = this.ptys.get(id);
    let next;
    if (!sess || s.exited || !sess.alive) {
      next = { state: 'exited', reason: null };
    } else if (s.hook?.state === 'attention') {
      next = { state: 'attention', reason: s.hook.reason };
    } else if (!s.hasChild) {
      next = { state: 'idle', reason: null };
    } else {
      const active = sess.lastOutputAt > Date.now() - OUTPUT_ACTIVE_MS;
      next = { state: 'working', reason: active ? 'output' : 'quiet' };
    }
    const prev = s.current || { state: 'starting' };
    if (prev.state !== next.state || prev.reason !== next.reason) {
      s.current = next;
      this.emit('change', id, next, prev);
    }
  }

  snapshot() {
    const out = {};
    for (const [id, s] of this.st) out[id] = s.current || { state: 'starting' };
    return out;
  }

  dispose() {
    clearInterval(this.timer);
  }
}

function psChildrenMap() {
  return new Promise((resolve, reject) => {
    execFile('ps', ['-axo', 'pid=,ppid='], (err, stdout) => {
      if (err) return reject(err);
      const children = new Map();
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length !== 2) continue;
        const pid = Number(parts[0]);
        const ppid = Number(parts[1]);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
      }
      resolve(children);
    });
  });
}

module.exports = StatusEngine;
