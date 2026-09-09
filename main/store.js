const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.regente');
const FILE = path.join(DIR, 'state.json');
const DEFAULT_PORT = 43117;

class Store {
  load() {
    try {
      const state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (!Array.isArray(state.workspaces)) state.workspaces = [];
      if (!state.port) state.port = DEFAULT_PORT;
      if (!state.presetCommands) state.presetCommands = {};
      if (!state.settings) state.settings = {};
      if (!state.settings.shortcuts) state.settings.shortcuts = {};
      if (!state.settings.fontSize) state.settings.fontSize = 13;
      return state;
    } catch {
      const state = {
        schemaVersion: 1,
        port: DEFAULT_PORT,
        activeWorkspaceId: null,
        presetCommands: {},
        settings: { shortcuts: {}, fontSize: 13 },
        workspaces: []
      };
      this.save(state);
      return state;
    }
  }

  save(state) {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
  }
}

module.exports = Store;
