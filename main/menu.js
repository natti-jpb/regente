const { Menu, app } = require('electron');
const { ACTION_LABELS, comboToAccelerator, effectiveShortcuts } = require('./shortcuts');

// Menu nativo do app. Os atalhos vivem aqui como accelerators — é o mecanismo
// confiável do macOS (funciona com o foco em qualquer lugar, inclusive no xterm)
// e deixa tudo descobrível na barra de menu.
// captureMode: true desliga os accelerators enquanto o usuário grava um atalho novo.
function rebuildMenu({ settings, captureMode, onAction }) {
  const shortcuts = effectiveShortcuts(settings);
  const item = (action) => ({
    label: ACTION_LABELS[action],
    accelerator: captureMode ? undefined : comboToAccelerator(shortcuts[action]) || undefined,
    click: () => onAction(action)
  });

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'Sobre o Regente' },
        { type: 'separator' },
        item('settings'),
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar Regente' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Encerrar Regente (mata os agentes)' }
      ]
    },
    {
      // sem role 'close' aqui: o accelerator padrão dele (⌘W) roubaria o atalho de aba
      label: 'Arquivo',
      submenu: [
        item('new-terminal'),
        item('new-workspace'),
        { type: 'separator' },
        item('close-tab'),
        item('delete-workspace')
      ]
    },
    { role: 'editMenu', label: 'Editar' },
    {
      label: 'Navegar',
      submenu: [
        item('dashboard'),
        item('next-attention'),
        { type: 'separator' },
        item('next-tab'),
        item('prev-tab'),
        { type: 'separator' },
        item('next-workspace'),
        item('prev-workspace')
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu', label: 'Janela' }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { rebuildMenu };
