// Core UI helpers: Preact + htm, app store, IPC wrappers with job tracking, formatting.
import { h, render as preactRender, Fragment } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { h, Fragment, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect };
export const render = preactRender;

const bridge = window.ame;

// ---------------------------------------------------------------- tiny store
const listeners = new Set();
export const state = {
  auth: null,
  info: null,
  route: { path: 'home', params: {} },
  jobs: {},
  toasts: [],
  ai: null, // built-in AI status: { enabled, usage, caps, buyUrl, advanced }
  visionProject: localStorage.getItem('ame.visionProject') || '',
  scribeProject: localStorage.getItem('ame.scribeProject') || '',
};
let version = 0;
export function setState(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  version++;
  for (const fn of listeners) fn(state);
}
export function useStore(select) {
  const [, force] = useState(0);
  const seen = version;
  // Subscribe synchronously after render (not on the next frame) and catch updates that happened in between.
  useLayoutEffect(() => {
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    if (version !== seen) fn();
    return () => listeners.delete(fn);
  }, []);
  return select ? select(state) : state;
}

export function go(path, params = {}) {
  setState({ route: { path, params } });
  const main = document.querySelector('.main-scroll');
  if (main) main.scrollTop = 0;
}

// ---------------------------------------------------------------- IPC
function unwrap(r) {
  if (r && r.ok) return r.data;
  const er = (r && r.error) || {};
  const e = new Error(er.message || 'Something went wrong');
  e.code = er.code;
  e.module = er.module;
  if (er.buyUrl) e.buyUrl = er.buyUrl;
  throw e;
}
function rawCall(channel, payload) { return bridge.callRaw ? bridge.callRaw(channel, payload).then(unwrap) : bridge.call(channel, payload); }

export function call(channel, payload) {
  return rawCall(channel, payload).catch((e) => {
    if (e.code === 'auth') refreshAuth();
    noteCreditError(e);
    throw e;
  });
}

// Out-of-credit errors: remember them so any error toast showing that message gets a "Buy credits" button.
let lastCredit = null;
function noteCreditError(e) {
  if (!e || (e.code !== 'credits_exhausted' && e.code !== 'user_cap')) return;
  lastCredit = { message: String(e.message), code: e.code, buyUrl: e.buyUrl || (state.ai && state.ai.buyUrl) || '', at: Date.now() };
  if (state.ai) refreshAi(true);
}

/**
 * Run a long job; tracked in the job tray. Returns the result promise.
 * opts.onProgress(progress, message)
 */
export function job(channel, payload, label, opts = {}) {
  const j0 = bridge.jobRaw ? bridge.jobRaw(channel, payload, label) : bridge.job(channel, payload, label);
  const j = { id: j0.id, promise: bridge.jobRaw ? j0.promise.then(unwrap) : j0.promise };
  setState((s) => ({ jobs: Object.assign({}, s.jobs, { [j.id]: { id: j.id, label, progress: 0, message: 'Starting…', state: 'running', module: opts.module || '' } }) }));
  if (opts.onStart) opts.onStart(j.id);
  return j.promise.catch((e) => { noteCreditError(e); throw e; }).finally(() => {
    setTimeout(() => setState((s) => { const n = Object.assign({}, s.jobs); if (n[j.id] && n[j.id].state !== 'running') delete n[j.id]; return { jobs: n }; }), 2500);
  });
}
export function cancelJob(id) { return bridge.cancel(id); }
export function on(event, fn) { return bridge.on(event, fn); }

bridge.on('job', (d) => {
  setState((s) => {
    const prev = s.jobs[d.id];
    if (!prev) return {}; // late event for a job already cleared (or not started from this window)
    return { jobs: Object.assign({}, s.jobs, { [d.id]: Object.assign({}, prev, d, { label: prev.label || d.label }) }) };
  });
});
bridge.on('auth', (st) => setState({ auth: st }));
bridge.on('aiusage', (u) => { if (u && state.ai) setState({ ai: Object.assign({}, state.ai, { usage: Object.assign({}, state.ai.usage, u), enabled: u.enabled !== false }) }); });

/** Load built-in AI status + credits (sidebar meter, Settings → Built-in AI). */
export async function refreshAi(force) {
  try { setState({ ai: await rawCall('ai.status', { force: Boolean(force) }) }); } catch (_) { /* signed out or offline */ }
  return state.ai;
}

/** Show an error toast (out-of-credit errors get a Buy credits button, see toast()). */
export function errorToast(e) {
  if (!e || e.code === 'cancelled') return;
  noteCreditError(e);
  toast(e.message, 'error');
}

export function useJobProgress(jobId) {
  return useStore((s) => (jobId ? s.jobs[jobId] : null));
}

/** Hook: run a job with local busy/progress state. */
export function useRunner(module) {
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState('');
  const prog = useJobProgress(jobId);
  const run = useCallback(async (channel, payload, label, okMsg) => {
    setBusy(true);
    try {
      const r = await job(channel, payload, label, { module, onStart: setJobId });
      if (okMsg) toast(okMsg, 'ok');
      return r;
    } catch (e) {
      errorToast(e);
      return null;
    } finally {
      setBusy(false);
    }
  }, [module]);
  const stop = useCallback(() => { if (jobId) cancelJob(jobId); }, [jobId]);
  return { busy, run, stop, progress: prog ? prog.progress : 0, message: prog ? prog.message : '', jobId };
}

export async function refreshAuth() {
  try { setState({ auth: await rawCall('auth.status') }); } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------- toasts
let tid = 0;
export function toast(message, kind = 'info', ms = 4200, action) {
  const id = ++tid;
  if (kind === 'error' && !action && lastCredit && String(message) === lastCredit.message && Date.now() - lastCredit.at < 60000) {
    ms = Math.max(ms, 10000);
    if (lastCredit.code === 'credits_exhausted' && lastCredit.buyUrl) { const u = lastCredit.buyUrl; action = { label: 'Buy credits', onClick: () => openUrl(u) }; }
  }
  setState((s) => ({ toasts: s.toasts.concat([{ id, message: String(message), kind, action }]) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

// ---------------------------------------------------------------- helpers
export function mediaUrl(p) { return p ? 'media://file/' + encodeURIComponent(p) : ''; }
export function clock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
export function parseClock(str) {
  const p = String(str).trim().split(':').map(Number);
  if (p.some((x) => Number.isNaN(x))) return 0;
  return p.reduce((a, b) => a * 60 + b, 0);
}
export function bytes(n) {
  if (!n) return '0 MB';
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  return Math.max(0.1, n / 1e6).toFixed(n > 1e7 ? 0 : 1) + ' MB';
}
export function ago(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}
export function count(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
export function pathFor(file) { return bridge.pathForFile(file); }
export function copy(text, what = 'Copied') { return call('clipboard.write', { text }).then(() => toast(what, 'ok', 1800)); }
export async function pickFiles(opts) { return call('dialog.open', opts); }
export async function saveFile(opts) { return call('dialog.save', opts); }
export function openPath(file) { return call('shell.open', { file }); }
export function showInFolder(file) { return call('shell.show', { file }); }
export function openUrl(url) { return call('shell.open', { url }); }

export const MEDIA_FILTERS = [{ name: 'Audio & video', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ts', 'mts', 'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma', 'aiff', 'aif', 'amr'] }, { name: 'All files', extensions: ['*'] }];
export const AUDIO_FILTERS = [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'opus', 'webm', 'mp4'] }];
export const DOC_FILTERS = [{ name: 'Documents', extensions: ['txt', 'md', 'docx', 'pdf', 'srt', 'vtt', 'lrc', 'sbv'] }];
export const SUB_FILTERS = [{ name: 'Transcripts & documents', extensions: ['txt', 'srt', 'vtt', 'csv', 'json', 'md', 'docx', 'pdf', 'lrc', 'sbv'] }];

/** Split text into parts, turning [mm:ss] / [h:mm:ss] into timecode tokens. */
export function splitTimecodes(text) {
  const out = [];
  const re = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ t: parseClock(m[1]), label: m[1] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function moduleOf(path) { return path.split('.')[0]; }
