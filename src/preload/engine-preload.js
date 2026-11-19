'use strict';
// Preload for the hidden local-AI engine window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('engineHost', {
  ready: () => ipcRenderer.send('engine:ready'),
  onTask: (fn) => ipcRenderer.on('engine:task', (_e, id, task, payload) => fn(id, task, payload)),
  progress: (id, pct, msg) => ipcRenderer.send('engine:progress', id, pct, msg),
  result: (id, ok, data) => ipcRenderer.send('engine:result', id, ok, data),
});
