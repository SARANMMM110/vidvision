'use strict';
// App configuration: config/app.json (built in) merged with an optional app-config.json next to the
// installed app (resources/app-config.json), so the licence server address can be changed after install.
const fs = require('fs');
const path = require('path');
const DEFAULTS = {
  appName: 'Vid Vision',
  serverUrl: '',
  primaryColor: '#6d5efc',
  accentColor: '#22d3ee',
  supportUrl: '',
  modules: { vision: 'Vision Engine', voice: 'Voice Engine', scribe: 'Scribe Engine' },
};
// In development config/app.json is read directly; installed builds ship it as resources/app-config.json.
let base = DEFAULTS;
try { base = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'app.json'), 'utf8'))); } catch (_) { /* packaged */ }

let override = {};
const candidates = [];
if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'app-config.json'));
candidates.push(path.join(path.dirname(process.execPath), 'app-config.json'));
for (const f of candidates) {
  try { override = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch (_) { /* not present */ }
}

module.exports = Object.assign({}, base, override, { modules: Object.assign({}, base.modules, override.modules || {}) });
