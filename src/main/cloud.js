'use strict';
// Built-in AI ("Vid Vision AI"). The app holds no AI keys: it asks the licence site for a short-lived plan token
// and sends requests to the AI gateway, which checks the buyer's monthly credits and calls the provider.
const license = require('./license');
const store = require('./store');
const net = require('./util/net');

const state = { token: '', exp: 0, gateway: '', plan: null, buyUrl: '', enabled: null, inflight: null, caps: null, capsAt: 0, usage: null, usageAt: 0, lastError: '', catalog: null, catalogAt: 0 };
let emitter = null;
let usageTimer = null;

function setEmitter(fn) { emitter = fn; }

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(net.cancelled()); }, { once: true });
  });
}

/** Advanced mode shows "use your own key" options (hidden switch for the vendor). */
function advanced() { return Boolean(store.getSettings().advanced || process.env.AME_ADVANCED === '1'); }

/** Built-in AI is switched on for this site (from the public config, or a token we already hold). */
function enabled() {
  if (state.enabled === false) return false;
  const c = license.status().config;
  return Boolean((c && c.ai && c.ai.enabled) || state.token);
}

function offError(msg) {
  return Object.assign(new Error(msg || 'The built-in AI is not switched on for this account yet. Use the free offline engines in Settings → AI for now.'), { code: 'ai_off' });
}

async function session(force) {
  if (!force && state.token && state.exp - 90 > Date.now() / 1000) return state;
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      let r;
      try {
        r = await license.api('ai/token', { body: {}, timeout: 15000 });
      } catch (e) {
        if (e.code === 'offline') throw Object.assign(new Error('You are offline. The built-in AI needs an internet connection — the offline engines in Settings → AI still work.'), { code: 'offline' });
        throw e;
      }
      if (!r || !r.enabled) { state.enabled = false; state.token = ''; throw offError(r && r.message); }
      Object.assign(state, { enabled: true, token: r.token, exp: Number(r.expires) || 0, gateway: String(r.gateway || '').replace(/\/+$/, ''), plan: r.plan || null, buyUrl: r.buy_url || '' });
      return state;
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

function scheduleUsage() {
  state.usageAt = 0;
  if (usageTimer) return;
  usageTimer = setTimeout(async () => {
    usageTimer = null;
    try { const u = await usage(true); if (emitter) emitter('aiusage', u); } catch (_) { /* ignore */ }
  }, 1500);
  if (usageTimer.unref) usageTimer.unref();
}

async function toError(res) {
  let j = null;
  try { j = await res.json(); } catch (_) { j = null; }
  const e = (j && j.error) || {};
  const err = new Error(e.message || `The AI service returned an error (${res.status}). Please try again.`);
  err.status = res.status;
  err.code = e.code || 'ai_error';
  if (res.status === 402) { err.buyUrl = state.buyUrl; err.resetsAt = e.resets_at; scheduleUsage(); }
  return err;
}

/**
 * Call the gateway. kind: 'json' | 'buffer' | 'raw' (Response, for streams).
 * Retries once with a fresh token on 401.
 */
function privateError() {
  return Object.assign(new Error('Private mode is on, so nothing is sent to the online AI. Use the offline engines, or turn Private mode off in Settings → Built-in AI.'), { code: 'private' });
}

async function request(pathname, init = {}, kind = 'json') {
  if (store.getSettings().privateMode) throw privateError();
  if (!enabled()) {
    // the site may have switched it on since we last looked
    state.enabled = null;
    await license.fetchConfig();
    if (!enabled()) throw offError();
  }
  let refreshed = false;
  let replanned = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    await session(false);
    const headers = Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + state.token });
    let res;
    try {
      res = await fetch(state.gateway + pathname, Object.assign({}, init, { headers }));
    } catch (e) {
      if (init.signal && init.signal.aborted) throw net.cancelled();
      if (attempt < 2) { await wait(1500 * (attempt + 1), init.signal); continue; }
      throw Object.assign(new Error('Could not reach the AI service. Check your internet connection and try again.'), { code: 'offline' });
    }
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      try { await res.arrayBuffer(); } catch (_) { /* drain */ }
      state.exp = 0;
      continue;
    }
    // out of credits: the plan may have changed since this token was issued (credit pack bought, limit raised) — re-check once
    if (res.status === 402 && !replanned) {
      replanned = true;
      try { await res.arrayBuffer(); } catch (_) { /* drain */ }
      state.exp = 0;
      continue;
    }
    // busy / rate limited: back off and retry a few times (parallel jobs can hit the per-minute limit)
    if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < 4) {
      const ra = Number(res.headers.get('retry-after')) || 0;
      try { await res.arrayBuffer(); } catch (_) { /* drain */ }
      await wait(Math.max(ra * 1000, 2000 * (attempt + 1)), init.signal);
      continue;
    }
    if (!res.ok) throw await toError(res);
    scheduleUsage();
    if (kind === 'raw') return res;
    if (kind === 'buffer') return Buffer.from(await res.arrayBuffer());
    return res.json();
  }
  throw new Error('Sign in again to use the built-in AI.');
}

async function caps(force) {
  if (!force && state.caps && Date.now() - state.capsAt < 10 * 60 * 1000) return state.caps;
  if (!enabled()) return null;
  try {
    await session(false);
    const j = await net.json(state.gateway + '/v1/health', { label: 'AI service', timeout: 8000 });
    state.caps = j.caps || {};
    state.capsAt = Date.now();
  } catch (e) {
    state.lastError = e.message;
  }
  return state.caps;
}

async function usage(force) {
  if (!force && state.usage && Date.now() - state.usageAt < 20000) return state.usage;
  if (!enabled()) return { enabled: false };
  try {
    const u = await request('/v1/usage', { method: 'GET' });
    state.usage = Object.assign({ enabled: true, buy_url: state.buyUrl, is_owner: state.plan ? state.plan.is_owner : true }, u);
    state.usageAt = Date.now();
    state.caps = u.caps || state.caps;
    if (u.caps) state.capsAt = Date.now();
  } catch (e) {
    if (e.code === 'ai_off') return { enabled: false };
    return Object.assign({}, state.usage || { enabled: true }, { error: e.message });
  }
  return state.usage;
}

/**
 * Built-in voices offered by the AI server (the natural voices on the vendor's voice server).
 * Returns null when the server has no list (older servers), so callers can fall back to their own.
 */
async function voiceCatalog(force) {
  if (!force && state.catalog && Date.now() - state.catalogAt < 60 * 60 * 1000) return state.catalog;
  try {
    const j = await request('/v1/voices/catalog', { method: 'GET' });
    const def = j.default || '';
    const list = (j.voices || []).map((v) => ({ id: v.id, name: v.name, gender: v.gender, lang: v.lang || 'multi', language: v.language || '', desc: v.featured ? `${v.language || ''} · Top pick`.replace(/^ · /, '') : (v.language || ''), featured: Boolean(v.featured) }));
    // The default voice first, then the best-sounding ones.
    list.sort((a, b) => Number(b.id === def) - Number(a.id === def) || Number(b.featured) - Number(a.featured));
    state.catalog = { engine: j.engine || 'openai', default: j.default || (list[0] && list[0].id) || 'marin', voices: list };
    state.catalogAt = Date.now();
  } catch (e) {
    if (e.code === 'private' || e.code === 'ai_off') throw e;
    if (e.status === 404) { state.catalog = null; state.catalogAt = Date.now(); }
    return state.catalog;
  }
  return state.catalog;
}

/** Server limits for one request (chunk sizes, parallel requests); null when unknown. */
async function limits() {
  try { return (await caps()) || null; } catch (_) { return null; }
}

function reset() {
  Object.assign(state, { token: '', exp: 0, plan: null, enabled: null, caps: null, capsAt: 0, usage: null, usageAt: 0, catalog: null, catalogAt: 0 });
}

license.onChange((st) => { if (!st.signedIn) reset(); });

/** Run tasks with limited parallelism, keeping result order. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

module.exports = { setEmitter, advanced, enabled, session, request, caps, limits, voiceCatalog, usage, reset, pool, state };
