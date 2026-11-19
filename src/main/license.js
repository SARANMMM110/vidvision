'use strict';
// Licence client for the Vid Vision Server WordPress plugin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');
const store = require('./store');
const appCfg = require('./appconfig');

const APP_VERSION = require('../../package.json').version;
const MODULES = ['vision', 'voice', 'scribe'];
const RECHECK_MS = 6 * 3600 * 1000;

const state = { profile: null, verifiedAt: 0, offline: false, config: null, lastError: '' };
const listeners = new Set();

function cacheFile() { return path.join(P.userData(), 'license.json'); }

function load() {
  const c = store.readJson(cacheFile(), {});
  state.profile = c.profile || null;
  state.verifiedAt = c.verifiedAt || 0;
  state.config = c.config || null;
}

function save() {
  store.writeJsonAtomic(cacheFile(), { profile: state.profile, verifiedAt: state.verifiedAt, config: state.config, brand: lastBrand() });
}

function lastBrand() {
  if (state.profile && state.profile.brand) return state.profile.brand;
  const c = store.readJson(cacheFile(), {});
  return state.profile ? null : (c.brand || null);
}

function serverUrl() {
  const s = store.getSettings().serverUrl || process.env.AME_SERVER_URL || appCfg.serverUrl || '';
  return s.replace(/\/+$/, '');
}

function deviceId() {
  const f = path.join(P.userData(), 'device.json');
  const c = store.readJson(f, null);
  if (c && c.id) return c.id;
  const id = 'dev-' + crypto.randomUUID();
  store.writeJsonAtomic(f, { id, created: Date.now() });
  return id;
}

function osLabel() {
  const map = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  return `${map[process.platform] || process.platform} ${os.release()} (${os.arch()})`;
}

function token() { return store.getSecret('license_token'); }

async function api(route, opts = {}) {
  const base = serverUrl();
  if (!base) throw Object.assign(new Error('No licence server is configured.'), { code: 'no_server' });
  const headers = { Accept: 'application/json' };
  const t = opts.auth === false ? '' : token();
  if (t) { headers.Authorization = 'Bearer ' + t; headers['X-AME-Token'] = t; }
  let body;
  if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const urls = [`${base}/wp-json/ame/v1/${route}`, `${base}/?rest_route=${encodeURIComponent('/ame/v1/' + route.split('?')[0])}${route.includes('?') ? '&' + route.split('?')[1] : ''}`];
  let lastErr;
  for (const url of urls) {
    let res;
    try {
      res = await fetch(url, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, signal: AbortSignal.timeout(opts.timeout || 20000) });
    } catch (e) {
      throw Object.assign(new Error('Could not reach the licence server. Check your internet connection.'), { code: 'offline', cause: e });
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    if (!json) { lastErr = Object.assign(new Error(`Licence server returned an unexpected response (${res.status}).`), { code: 'bad_response', status: res.status }); continue; }
    if (!res.ok) throw Object.assign(new Error(json.message || `Request failed (${res.status})`), { code: json.code || 'error', status: res.status });
    return json;
  }
  throw lastErr;
}

function emit() { for (const fn of listeners) { try { fn(status()); } catch (_) { /* ignore */ } } }

function graceOk() {
  const days = (state.profile && state.profile.limits && state.profile.limits.offline_grace_days) || 7;
  return Date.now() - state.verifiedAt < days * 86400000;
}

function status() {
  const signedIn = Boolean(token() && state.profile && (!state.offline || graceOk()));
  return {
    signedIn,
    offline: state.offline,
    profile: signedIn ? state.profile : null,
    modules: signedIn ? state.profile.modules : [],
    brand: (signedIn ? state.profile.brand : lastBrand()) || null,
    config: state.config,
    serverUrl: serverUrl(),
    verifiedAt: state.verifiedAt,
    appVersion: APP_VERSION,
    deviceName: os.hostname(),
    lastError: state.lastError,
  };
}

async function fetchConfig() {
  try {
    const b = (state.profile && state.profile.brand && state.profile.brand.slug) || (lastBrand() && lastBrand().slug) || '';
    state.config = await api('config' + (b ? '?brand=' + encodeURIComponent(b) : ''), { auth: false });
    save();
  } catch (_) { /* keep cached */ }
  return state.config;
}

async function login(email, password) {
  const res = await api('auth/login', {
    auth: false,
    body: { email, password, device_id: deviceId(), device_name: os.hostname(), os: osLabel(), app_version: APP_VERSION },
  });
  store.setSecret('license_token', res.token);
  state.profile = res.profile;
  state.verifiedAt = Date.now();
  state.offline = false;
  state.lastError = '';
  save();
  await fetchConfig();
  emit();
  return status();
}

async function refresh() {
  if (!token()) { state.profile = null; emit(); return status(); }
  try {
    state.profile = await api('me');
    state.verifiedAt = Date.now();
    state.offline = false;
    state.lastError = '';
    save();
    fetchConfig();
  } catch (e) {
    if (e.code === 'offline' || e.code === 'bad_response') {
      state.offline = true;
      state.lastError = e.message;
    } else if (e.status === 401 || e.status === 403) {
      state.lastError = e.message;
      clearLocal();
    } else {
      state.offline = true;
      state.lastError = e.message;
    }
  }
  emit();
  return status();
}

function clearLocal() {
  store.setSecret('license_token', '');
  state.profile = null;
  state.verifiedAt = 0;
  save();
}

async function logout() {
  try { if (token()) await api('auth/logout', { body: {} }); } catch (_) { /* ignore */ }
  clearLocal();
  emit();
  return status();
}

async function forgot(email) { return api('auth/forgot', { auth: false, body: { email } }); }

function hasModule(m) {
  const s = status();
  return s.signedIn && s.modules.includes(m);
}

function startTimer() {
  setInterval(() => { if (token()) refresh(); }, RECHECK_MS).unref();
}

load();

module.exports = {
  MODULES, APP_VERSION, api, login, logout, refresh, forgot, status, hasModule, fetchConfig, serverUrl, deviceId, startTimer,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
