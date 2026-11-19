'use strict';
// Pre-flight: syntax-check every main/preload/shared/script file and confirm config is sane.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
let bad = 0;
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); } catch (err) { bad++; console.error('SYNTAX', path.relative(root, p), String(err.stderr).split('\n').slice(0, 4).join('\n')); }
    }
  }
}
for (const d of ['src/main', 'src/preload', 'src/shared', 'scripts']) walk(path.join(root, d));
// Renderer files are ES modules: parse them with esbuild (catches duplicate declarations etc.).
try {
  const esbuild = require('esbuild');
  const rwalk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) rwalk(p); else if (p.endsWith('.js')) { try { esbuild.transformSync(fs.readFileSync(p, 'utf8'), { format: 'esm', loader: 'js', sourcefile: p }); } catch (err) { bad++; console.error('SYNTAX', path.relative(root, p), String(err.message).split('\n').slice(0, 4).join('\n')); } } } };
  rwalk(path.join(root, 'src', 'renderer'));
} catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config', 'app.json'), 'utf8'));
if (!/^https?:\/\//.test(cfg.serverUrl || '')) { bad++; console.error('config/app.json: serverUrl must be your licence server address'); }
const pkg = require(path.join(root, 'package.json'));
console.log(`${pkg.productName} ${pkg.version} — server ${cfg.serverUrl}`);
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); }
console.log('check ok');
