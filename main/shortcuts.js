// Definições de atalhos compartilhadas entre main (menu) e renderer (UI de ajustes).
const DEFAULT_SHORTCUTS = {
  'new-terminal': { meta: true, key: 't' },
  'next-tab': { ctrl: true, key: 'Tab' },
  'prev-tab': { ctrl: true, shift: true, key: 'Tab' },
  'next-workspace': { meta: true, shift: true, key: 'ArrowDown' },
  'prev-workspace': { meta: true, shift: true, key: 'ArrowUp' },
  dashboard: { meta: true, key: 'd' },
  'next-attention': { meta: true, key: 'j' },
  settings: { meta: true, key: ',' }
};

const ACTION_LABELS = {
  'new-terminal': 'Nova aba (terminal)',
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
