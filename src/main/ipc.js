'use strict';
// One IPC entry point ("ame:invoke") with a handler registry, licence gating per module,
// and long-running job contexts (progress events + cancellation).
const license = require('./license');

const handlers = new Map();
const jobs = new Map();
let sender = null;

/**
 * Register a handler.
 * @param {string} channel e.g. "vision.analyze"
 * @param {(payload:any, ctx:object)=>Promise<any>} fn
 * @param {{module?: 'vision'|'voice'|'scribe'|'agency'|'whitelabel'|'any', public?: boolean}} opts
 */
function handle(channel, fn, opts = {}) {
  handlers.set(channel, { fn, module: opts.module || null, public: Boolean(opts.public) });
}

function emit(event, data) {
  if (sender && !sender.isDestroyed()) sender.send('ame:event', event, data);
}

function makeCtx(jobId, channel, label) {
  const controller = new AbortController();
  const job = { id: jobId, channel, label: label || channel, progress: 0, message: '', started: Date.now(), controller };
  if (jobId) {
    jobs.set(jobId, job);
    emit('job', { id: jobId, label: job.label, state: 'running', progress: 0, message: '' });
  }
  let last = 0;
  return {
    jobId,
    signal: controller.signal,
    progress(p, message) {
      if (!jobId) return;
      if (typeof p === 'number' && Number.isFinite(p)) job.progress = Math.max(0, Math.min(100, p));
      if (message !== undefined) job.message = message;
      const now = Date.now();
      if (now - last < 120 && p !== 100) return;
      last = now;
      emit('job', { id: jobId, label: job.label, state: 'running', progress: job.progress, message: job.message });
    },
    log(message) { if (jobId) emit('job', { id: jobId, label: job.label, state: 'running', progress: job.progress, message }); },
    check() { if (controller.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'cancelled' }); },
    emit,
  };
}

function finish(jobId, state, error, extra) {
  if (!jobId) return;
  const job = jobs.get(jobId);
  jobs.delete(jobId);
  emit('job', Object.assign({ id: jobId, label: job ? job.label : '', state, progress: state === 'done' ? 100 : (job ? job.progress : 0), message: error || '' }, extra || {}));
}

function cancel(jobId) {
  const j = jobs.get(jobId);
  if (j) { j.controller.abort(); return true; }
  return false;
}

function gateError(module) {
  const names = { vision: 'Vision Engine', voice: 'Voice Engine', scribe: 'Scribe Engine', agency: 'Agency', whitelabel: 'White Label' };
  return Object.assign(new Error(`${names[module] || module} is not active on your account.`), { code: 'locked', module });
}

async function dispatch(channel, payload, jobId, label) {
  const h = handlers.get(channel);
  if (!h) throw Object.assign(new Error('Unknown action: ' + channel), { code: 'unknown' });
  if (!h.public) {
    const st = license.status();
    if (!st.signedIn) throw Object.assign(new Error('Please sign in.'), { code: 'auth' });
    if (h.module && h.module !== 'any' && !license.hasModule(h.module)) throw gateError(h.module);
  }
  const ctx = makeCtx(jobId, channel, label);
  try {
    const data = await h.fn(payload || {}, ctx);
    finish(jobId, 'done');
    return data;
  } catch (e) {
    finish(jobId, e && e.code === 'cancelled' ? 'cancelled' : 'error', e && e.message, e && e.buyUrl ? { code: e.code, buyUrl: e.buyUrl } : null);
    throw e;
  }
}

function register(ipcMain, getWebContents) {
  ipcMain.handle('ame:invoke', async (event, channel, payload, jobId, label) => {
    sender = event.sender;
    try {
      const data = await dispatch(channel, payload, jobId, label);
      return { ok: true, data };
    } catch (e) {
      if (process.env.AME_DEBUG) console.error('[ipc]', channel, e);
      return { ok: false, error: { message: (e && e.message) || String(e), code: (e && e.code) || 'error', module: e && e.module, buyUrl: (e && e.buyUrl) || undefined } };
    }
  });
  ipcMain.handle('ame:cancel', (_e, jobId) => cancel(jobId));
  if (getWebContents) sender = getWebContents();
}

function setSender(wc) { sender = wc; }

module.exports = { handle, register, dispatch, emit, cancel, setSender, handlers };
