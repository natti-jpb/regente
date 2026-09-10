// Presets de agente disponíveis ao criar um terminal.
// `command` é digitado no shell logo após o spawn (vazio = shell puro).
module.exports = [
  { id: 'claude', name: 'Claude Code', command: 'claude --permission-mode auto', icon: '✳' },
  { id: 'codex', name: 'Codex', command: 'codex', icon: '◎' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', icon: '✦' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', icon: '▣' },
  { id: 'shell', name: 'Shell', command: '', icon: '❯' }
];
