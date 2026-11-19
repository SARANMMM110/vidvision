'use strict';
// Bridge to the hidden "engine" window that runs in-browser AI models (Kokoro TTS, NLLB-200 offline translation)
// with WebGPU when available, WASM otherwise. Models download once and are cached on disk.
let electron = null;
try { electron = require('electron'); if (!electron.BrowserWindow) electron = null; } catch (_) { electron = null; }
const path = require('path');

let win = null;
let ready = null;
let seq = 0;
const pending = new Map();

function ensure() {
  if (!electron) return Promise.reject(new Error('Local AI engines need the desktop app.'));
  if (win && !win.isDestroyed() && ready) return ready;
  const { BrowserWindow, ipcMain } = electron;
  win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'engine-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      partition: 'persist:engine',
    },
  });
  let lastError = '';
  win.webContents.on('console-message', (e, level, message) => {
    const lvl = typeof level === 'number' ? level : (e && e.level);
    const msg = message || (e && e.message) || '';
    if (lvl === 3 || lvl === 'error') lastError = String(msg).slice(0, 300);
    if (process.env.AME_DEBUG) console.log('[engine]', msg);
  });
  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('The local AI engine did not start' + (lastError ? ': ' + lastError : '.'))); if (win && !win.isDestroyed()) win.destroy(); }, 45000);
    const onReady = (e) => { if (e.sender === win.webContents) { clearTimeout(timer); ipcMain.removeListener('engine:ready', onReady); resolve(); } };
    ipcMain.on('engine:ready', onReady);
    win.webContents.once('did-fail-load', (_e, code, desc) => { clearTimeout(timer); reject(new Error('Engine failed to load: ' + desc)); });
  });
  ready.catch(() => { ready = null; });
  win.on('closed', () => {
    win = null;
    ready = null;
    for (const [, p] of pending) p.reject(new Error('Local engine stopped.'));
    pending.clear();
  });
  win.loadURL('app://renderer/engine.html');
  return ready;
}

function wire() {
  if (!electron) return;
  const { ipcMain } = electron;
  ipcMain.on('engine:progress', (_e, id, pct, msg) => {
    const p = pending.get(id);
    if (p && p.ctx && p.ctx.progress) p.ctx.progress(pct, msg);
  });
  ipcMain.on('engine:result', (_e, id, ok, data) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(data); else p.reject(new Error(data && data.message ? data.message : String(data)));
  });
}

/**
 * Run a task in the engine window.
 * @param {'kokoro'|'translate'|'status'|'clear'} task
 */
async function run(task, payload, ctx) {
  await ensure();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, ctx });
    if (ctx && ctx.signal) ctx.signal.addEventListener('abort', () => { if (pending.has(id)) { pending.delete(id); reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' })); } }, { once: true });
    win.webContents.send('engine:task', id, task, payload);
  });
}

function shutdown() { if (win && !win.isDestroyed()) win.destroy(); }

module.exports = { run, wire, shutdown };
