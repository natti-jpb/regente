// Definições de atalhos compartilhadas entre main (menu) e renderer (UI de ajustes).
const DEFAULT_SHORTCUTS = {
  'new-terminal': { meta: true, key: 't' },
  'new-workspace': { meta: true, key: 'n' },
  'close-tab': { meta: true, key: 'Backspace' },
  'delete-workspace': { meta: true, shift: true, key: 'Backspace' },
  'next-tab': { meta: true, key: 's' },
  'prev-tab': { meta: true, key: 'w' },
  'next-workspace': { meta: true, shift: true, key: 's' },
  'prev-workspace': { meta: true, shift: true, key: 'w' },
  dashboard: { meta: true, key: '1' },
  'next-attention': { meta: true, key: '2' },
  settings: { meta: true, key: '3' }
};

const ACTION_LABELS = {
  'new-terminal': 'Nova aba (terminal)',
  'new-workspace': 'Novo workspace',
  'close-tab': 'Fechar aba atual',
  'delete-workspace': 'Excluir workspace atual',
  'next-tab': 'Próxima aba',
  'prev-tab': 'Aba anterior',
  'next-workspace': 'Próximo workspace',
  'prev-workspace': 'Workspace anterior',
  dashboard: 'Abrir dashboard',
  'next-attention': 'Pular p/ quem precisa de você',
  settings: 'Abrir ajustes'
};

// Combo {meta,ctrl,alt,shift,key} -> string de accelerator do Electron
function comboToAccelerator(c) {
  if (!c) return null;
  const KEYMAP = {
    Tab: 'Tab',
    ArrowDown: 'Down',
    ArrowUp: 'Up',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
    Enter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete'
  };
  const parts = [];
  if (c.ctrl) parts.push('Control');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  if (c.meta) parts.push('Command');
  const key = KEYMAP[c.key] || (c.key.length === 1 ? c.key.toUpperCase() : c.key);
  parts.push(key);
  return parts.join('+');
}

function effectiveShortcuts(settings) {
  return { ...DEFAULT_SHORTCUTS, ...(settings?.shortcuts || {}) };
}

module.exports = { DEFAULT_SHORTCUTS, ACTION_LABELS, comboToAccelerator, effectiveShortcuts };
