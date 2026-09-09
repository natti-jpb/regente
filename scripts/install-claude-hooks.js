#!/usr/bin/env node
// Instala os hooks do Regente em ~/.claude/settings.json (merge idempotente, com backup).
// O comando só age quando REGENTE_PORT/REGENTE_SESSION existem no ambiente — ou seja,
// apenas em sessões do Claude Code abertas dentro do Regente. Fora dele é um no-op.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKER = 'REGENTE_PORT';
const EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'];

function hookCommand() {
  return (
    '[ -n "$REGENTE_PORT" ] && [ -n "$REGENTE_SESSION" ] && ' +
    'curl -s -m 2 -X POST --data-binary @- -H \'Content-Type: application/json\' ' +
    '"http://127.0.0.1:$REGENTE_PORT/hooks/claude?session=$REGENTE_SESSION" >/dev/null 2>&1; true'
  );
}

function installClaudeHooks() {
  const file = path.join(os.homedir(), '.claude', 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.copyFileSync(file, file + '.bak-regente');
  }
  settings.hooks = settings.hooks || {};
  const added = [];
  for (const event of EVENTS) {
    const entries = (settings.hooks[event] = settings.hooks[event] || []);
    if (JSON.stringify(entries).includes(MARKER)) continue;
    entries.push({ hooks: [{ type: 'command', command: hookCommand() }] });
    added.push(event);
  }
  if (added.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  }
  return { added, file };
}

function uninstallClaudeHooks() {
  const file = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(file)) return { removed: 0, file };
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  let removed = 0;
  for (const event of Object.keys(settings.hooks || {})) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(
      (entry) => !JSON.stringify(entry).includes(MARKER)
    );
    removed += before - settings.hooks[event].length;
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (removed) fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return { removed, file };
}

module.exports = { installClaudeHooks, uninstallClaudeHooks };

if (require.main === module) {
  if (process.argv.includes('--uninstall')) {
    const { removed, file } = uninstallClaudeHooks();
    console.log(`Removidos ${removed} hooks do Regente de ${file}`);
  } else {
    const { added, file } = installClaudeHooks();
    console.log(
      added.length
        ? `Hooks instalados (${added.join(', ')}) em ${file}. Backup: ${file}.bak-regente`
        : `Hooks já estavam instalados em ${file} — nada a fazer.`
    );
  }
}
