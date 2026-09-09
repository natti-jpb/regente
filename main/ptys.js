const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');

const MAX_BUFFER_BYTES = 400_000; // scrollback replay por sessão

class PtyManager extends EventEmitter {
  constructor() {
    super();
    this.port = null; // definido pelo main após o hook server subir
    this.sessions = new Map(); // terminalId -> session
  }

  spawn(terminal, { command } = {}) {
    this.kill(terminal.id);
    const shell = process.env.SHELL || '/bin/zsh';
    const cwd =
      terminal.cwd && fs.existsSync(terminal.cwd) ? terminal.cwd : os.homedir();

    const proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        REGENTE_SESSION: terminal.id,
        REGENTE_PORT: String(this.port || '')
      }
    });

    const session = {
      id: terminal.id,
      pty: proc,
      alive: true,
      buffer: [],
      bufferBytes: 0,
      seq: 0, // permite ao renderer descartar chunks já cobertos pelo replay do buffer
      lastOutputAt: Date.now(),
      startedAt: Date.now()
    };
    this.sessions.set(terminal.id, session);

    proc.onData((data) => {
      session.lastOutputAt = Date.now();
      session.seq++;
      session.buffer.push(data);
      session.bufferBytes += data.length;
      while (session.bufferBytes > MAX_BUFFER_BYTES && session.buffer.length > 1) {
        session.bufferBytes -= session.buffer[0].length;
        session.buffer.shift();
      }
      this.emit('data', terminal.id, data, session.seq);
    });

    proc.onExit(({ exitCode }) => {
      session.alive = false;
      this.emit('exit', terminal.id, exitCode);
    });

    if (command) {
      setTimeout(() => {
        if (session.alive) proc.write(command + '\r');
      }, 500);
    }
    return session;
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (s?.alive) s.pty.write(data);
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    try {
      s.pty.resize(Math.max(2, cols), Math.max(2, rows));
    } catch {}
  }

  kill(id) {
    const s = this.sessions.get(id);
    if (s?.alive) {
      try {
        s.pty.kill();
      } catch {}
      s.alive = false;
    }
  }

  remove(id) {
    this.kill(id);
    this.sessions.delete(id);
  }

  buffer(id) {
    const s = this.sessions.get(id);
    return s ? { data: s.buffer.join(''), seq: s.seq } : { data: '', seq: 0 };
  }

  get(id) {
    return this.sessions.get(id);
  }

  list() {
    return [...this.sessions.values()];
  }

  killAll() {
    for (const s of this.sessions.values()) {
      if (s.alive) {
        try {
          s.pty.kill();
        } catch {}
      }
    }
  }
}

module.exports = PtyManager;
