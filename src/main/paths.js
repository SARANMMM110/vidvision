'use strict';
// Folder layout. Works inside Electron and in plain Node (tests) via AME_HOME.
const path = require('path');
const fs = require('fs');
const os = require('os');

let electronApp = null;
try { electronApp = require('electron').app; } catch (_) { electronApp = null; }
if (electronApp && typeof electronApp.getPath !== 'function') electronApp = null;

const state = { overrides: {} };

function userData() {
  if (process.env.AME_HOME) return process.env.AME_HOME;
  if (electronApp) return electronApp.getPath('userData');
  return path.join(os.homedir(), '.vid-vision');
}

function documents() {
  try { if (electronApp) return electronApp.getPath('documents'); } catch (_) { /* ignore */ }
  return path.join(os.homedir(), 'Documents');
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Apply user folder choices from settings.folders. */
function setOverrides(folders) {
  state.overrides = Object.assign({}, folders || {});
}

function workspace() {
  const base = state.overrides.workspace || (process.env.AME_HOME ? path.join(process.env.AME_HOME, 'workspace') : path.join(documents(), 'Vid Vision'));
  return ensure(base);
}

const P = {
  userData: () => ensure(userData()),
  bin: () => ensure(path.join(userData(), 'bin')),
  models: () => ensure(state.overrides.models || path.join(userData(), 'models')),
  cache: () => ensure(path.join(userData(), 'cache')),
  temp: () => ensure(path.join(userData(), 'temp')),
  workspace,
  exports: () => ensure(state.overrides.exports || path.join(workspace(), 'Exports')),
  visionProjects: () => ensure(path.join(workspace(), 'Vision Projects')),
  scribeProjects: () => ensure(path.join(workspace(), 'Scribe Projects')),
  studioProjects: () => ensure(path.join(workspace(), 'Studio Projects')),
  audiobooks: () => ensure(path.join(workspace(), 'Audiobooks')),
  audioLibrary: () => ensure(path.join(workspace(), 'Audio Library')),
  voiceLibrary: () => ensure(path.join(workspace(), 'Voice Library')),
  downloads: () => ensure(path.join(workspace(), 'Downloads')),
  ensure,
  setOverrides,
  tempFile(ext) {
    const name = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}${ext || ''}`;
    return path.join(P.temp(), name);
  },
  tempDir(prefix) {
    return fs.mkdtempSync(path.join(P.temp(), (prefix || 'd') + '_'));
  },
};

module.exports = P;
