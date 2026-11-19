'use strict';
// Exposes a minimal, safe API to the UI.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

let seq = 0;
const listeners = new Map();

ipcRenderer.on('ame:event', (_e, event, data) => {
  const set = listeners.get(event);
  if (set) for (const fn of set) { try { fn(data); } catch (_) { /* ignore */ } }
  const all = listeners.get('*');
  if (all) for (const fn of all) { try { fn(event, data); } catch (_) { /* ignore */ } }
});

function unwrap(r) {
  if (r && r.ok) return r.data;
  const e = new Error((r && r.error && r.error.message) || 'Something went wrong');
  e.code = r && r.error && r.error.code;
  e.module = r && r.error && r.error.module;
  if (r && r.error && r.error.buyUrl) e.buyUrl = r.error.buyUrl;
  throw e;
}

contextBridge.exposeInMainWorld('ame', {
  /** Quick call. */
  call: (channel, payload) => ipcRenderer.invoke('ame:invoke', channel, payload || {}).then(unwrap),
  /** Same as call/job but never rejects: resolves to { ok, data } or { ok:false, error:{ message, code, … } }.
   *  (Errors crossing the context bridge lose their code, so the renderer rebuilds them from this.) */
  callRaw: (channel, payload) => ipcRenderer.invoke('ame:invoke', channel, payload || {}),
  jobRaw: (channel, payload, label) => {
    const id = `j${Date.now().toString(36)}${(++seq).toString(36)}`;
    return { id, promise: ipcRenderer.invoke('ame:invoke', channel, payload || {}, id, label || channel) };
  },
  /** Long-running job with progress. Returns { id, promise }. */
  job: (channel, payload, label) => {
    const id = `j${Date.now().toString(36)}${(++seq).toString(36)}`;
    const promise = ipcRenderer.invoke('ame:invoke', channel, payload || {}, id, label || channel).then(unwrap);
    return { id, promise };
  },
  cancel: (jobId) => ipcRenderer.invoke('ame:cancel', jobId),
  on: (event, fn) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  platform: process.platform,
});
