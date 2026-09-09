const http = require('http');

// Servidor local que recebe os hooks do Claude Code.
// Os hooks (instalados em ~/.claude/settings.json) fazem POST do JSON do evento para
//   http://127.0.0.1:$REGENTE_PORT/hooks/claude?session=$REGENTE_SESSION
// As envs REGENTE_* só existem em terminais abertos pelo Regente — fora dele o hook é no-op.
class HookServer {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  listen(preferredPort) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryPort = (port) => {
        this.server.once('error', (err) => {
          if (err.code === 'EADDRINUSE' && attempts < 10) {
            attempts++;
            tryPort(port + 1);
          } else {
            reject(err);
          }
        });
        this.server.listen(port, '127.0.0.1', () => {
          this.port = this.server.address().port;
          resolve(this.port);
        });
      };
      tryPort(preferredPort);
    });
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    // Endpoints de desenvolvimento (verificação automatizada da UI); inertes sem REGENTE_DEBUG
    if (process.env.REGENTE_DEBUG && url.pathname.startsWith('/debug/') && this.onDebug) {
      Promise.resolve(this.onDebug(url))
        .then((out) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out || { ok: true }));
        })
        .catch((err) => {
          res.writeHead(500);
          res.end(String(err));
        });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/hooks/claude') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy();
      });
      req.on('end', () => {
        let payload = {};
        try {
          payload = JSON.parse(body);
        } catch {}
        const session = url.searchParams.get('session');
        const event = payload.hook_event_name || url.searchParams.get('event');
        if (session && event) this.onEvent(session, event, payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  }

  close() {
    this.server.close();
  }
}

module.exports = HookServer;
