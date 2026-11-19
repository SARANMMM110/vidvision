'use strict';
// Settings (plain JSON) + secrets (API keys, tokens) encrypted with the OS keychain (DPAPI on Windows).
const fs = require('fs');
const path = require('path');
const P = require('./paths');

let safeStorage = null;
try {
  const e = require('electron');
  if (e && e.safeStorage) safeStorage = e.safeStorage;
} catch (_) { safeStorage = null; }

const DEFAULTS = {
  ai: {
    textProvider: 'builtin',
    textModel: 'standard',
    visionProvider: 'builtin',
    visionModel: 'vision',
    models: {
      builtin: 'standard',
      openai: 'gpt-5-mini',
      anthropic: 'claude-sonnet-5-5',
      gemini: 'gemini-2.5-flash',
      openrouter: 'openai/gpt-5-mini',
      xai: 'grok-4',
      mistral: 'mistral-medium-latest',
      deepseek: 'deepseek-chat',
      perplexity: 'sonar',
      groq: 'llama-3.3-70b-versatile',
      ollama: 'qwen2.5vl:7b',
      lmstudio: '',
      custom: '',
    },
    ollamaUrl: 'http://127.0.0.1:11434',
    lmstudioUrl: 'http://127.0.0.1:1234/v1',
    customBaseUrl: '',
    temperature: 0.5,
  },
  transcription: {
    engine: 'cloud', // cloud (built in) | local | openai | groq | gladia
    model: 'base',
    language: 'auto',
    threads: 0,
    gpu: 'cpu', // cpu | cuda
    useCaptions: true,
    openaiModel: 'whisper-1',
    groqModel: 'whisper-large-v3-turbo',
  },
  translation: { engine: 'ai' }, // ai | local
  tts: { engine: 'cloud', voice: 'marin' },
  images: { provider: 'builtin', models: { openai: 'gpt-image-1', gemini: 'gemini-2.5-flash-image', openrouter: 'google/gemini-2.5-flash-image', fal: 'fal-ai/flux/dev' } },
  vision: { frameDetail: 'standard', sceneThreshold: 0.32, maxGap: 20 },
  folders: { workspace: '', exports: '', models: '' },
  network: { proxy: '', market: 'US' },
  wordpress: [],
  ui: { sidebarCollapsed: false },
  serverUrl: '',
  advanced: false, // vendor-only: shows "use your own API key" engines (Ctrl+Shift+K in Settings)
  privateMode: false, // nothing goes to online AI: writing, transcription, voices and translation use the offline engines
  v: 2,
};

const SECRET_KEYS = ['openai', 'anthropic', 'gemini', 'openrouter', 'xai', 'mistral', 'deepseek', 'perplexity', 'groq', 'custom', 'elevenlabs', 'fal', 'freesound', 'jamendo', 'gladia'];

function file(name) { return path.join(P.userData(), name); }

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = Object.assign({}, base);
    if (over && typeof over === 'object' && !Array.isArray(over)) {
      for (const k of Object.keys(over)) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
    }
    return out;
  }
  return over === undefined ? base : over;
}

function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return fallback; }
}

function writeJsonAtomic(f, data) {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

let cache = null;

/** 1.0.x → 1.1: move people who never added keys onto the built-in AI (offline engines stay one click away). */
function migrate(saved) {
  if (!saved || !Object.keys(saved).length || saved.v >= 2) return saved;
  const raw = secretsRaw();
  const has = (k) => Boolean(raw[k]);
  const ai = saved.ai || {};
  const keyless = (prov) => !prov || (!['ollama', 'lmstudio', 'custom'].includes(prov) && !has(prov));
  if (keyless(ai.textProvider)) Object.assign(ai, { textProvider: 'builtin', textModel: 'standard' });
  if (keyless(ai.visionProvider)) Object.assign(ai, { visionProvider: 'builtin', visionModel: 'vision' });
  saved.ai = ai;
  const t = saved.transcription || {};
  if (!t.engine || t.engine === 'local' || (t.engine !== 'local' && !has(t.engine))) t.engine = 'cloud';
  saved.transcription = t;
  const v = saved.tts || {};
  if (!v.engine || v.engine === 'kokoro' || (['openai', 'gemini', 'elevenlabs'].includes(v.engine) && !has(v.engine))) Object.assign(v, { engine: 'cloud', voice: 'marin' });
  saved.tts = v;
  const im = saved.images || {};
  if (!im.provider || !has(im.provider)) im.provider = 'builtin';
  saved.images = im;
  saved.v = 2;
  return saved;
}

function getSettings() {
  if (!cache) {
    const saved = readJson(file('settings.json'), {});
    const before = saved.v;
    cache = deepMerge(DEFAULTS, migrate(saved));
    if (before !== cache.v && Object.keys(saved).length) { try { writeJsonAtomic(file('settings.json'), cache); } catch (_) { /* read-only */ } }
    P.setOverrides(cache.folders);
  }
  return cache;
}

function setSettings(patch) {
  cache = deepMerge(getSettings(), patch || {});
  writeJsonAtomic(file('settings.json'), cache);
  P.setOverrides(cache.folders);
  return cache;
}

// ---- secrets
function encrypt(str) {
  if (safeStorage && safeStorage.isEncryptionAvailable()) return 'e:' + safeStorage.encryptString(str).toString('base64');
  return 'p:' + Buffer.from(str, 'utf8').toString('base64');
}
function decrypt(v) {
  if (typeof v !== 'string') return '';
  try {
    if (v.startsWith('e:') && safeStorage) return safeStorage.decryptString(Buffer.from(v.slice(2), 'base64'));
    if (v.startsWith('p:')) return Buffer.from(v.slice(2), 'base64').toString('utf8');
  } catch (_) { return ''; }
  return '';
}

function secretsRaw() { return readJson(file('secrets.json'), {}); }

function getSecret(key) { return decrypt(secretsRaw()[key]); }

function setSecret(key, value) {
  const all = secretsRaw();
  if (value) all[key] = encrypt(String(value)); else delete all[key];
  writeJsonAtomic(file('secrets.json'), all);
}

/** Which API keys are set (never returns the values). */
function keyStatus() {
  const all = secretsRaw();
  const out = {};
  for (const k of SECRET_KEYS) out[k] = Boolean(all[k]);
  return out;
}

/** Masked preview of a key, e.g. sk-...a1b2. */
function maskedKey(key) {
  const v = getSecret(key);
  if (!v) return '';
  return v.length <= 8 ? '••••' : v.slice(0, 3) + '…' + v.slice(-4);
}

module.exports = { DEFAULTS, SECRET_KEYS, getSettings, setSettings, getSecret, setSecret, keyStatus, maskedKey, readJson, writeJsonAtomic, deepMerge };
