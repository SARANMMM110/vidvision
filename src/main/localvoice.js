'use strict';
// Offline voices on sherpa-onnx (native ONNX runtime — no Python, no internet once downloaded, nothing uploaded):
//  • Kokoro — 54 voices in 8 languages (English US/UK, Spanish, French, Hindi, Italian, Japanese, Portuguese, Chinese)
//  • ZipVoice — clone a voice from a 3–15 s sample; the sample and the voice stay on this computer (English + Chinese)
// Models download on first use from the sherpa-onnx GitHub releases. Phonemes for languages the models do not
// tokenise themselves come from `phonemize` (Japanese, bundled, MIT) and `espeak-phonemizer` (es/fr/it/pt/hi,
// GPL — downloaded on demand and run in its own process, like the Piper engine).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const P = require('./paths');
const kokoroEn = require('./kokoro-en');
const net = require('./util/net');
const proc = require('./util/proc');

const REL = process.env.AME_SHERPA_RELEASES || 'https://github.com/k2-fsa/sherpa-onnx/releases/download/';
const PACKS = {
  kokoro: { label: 'Kokoro voices (54 voices, 8 languages)', url: REL + 'tts-models/kokoro-multi-lang-v1_0.tar.bz2', dir: 'kokoro-multi-lang-v1_0', mb: 350, check: 'model.onnx' },
  zipvoice: { label: 'Offline voice cloning', url: REL + 'tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2', dir: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia', mb: 110, check: 'encoder.int8.onnx' },
  vocos: { label: 'Voice vocoder', url: REL + 'vocoder-models/vocos_24khz.onnx', file: 'vocos_24khz.onnx', mb: 54 },
  espeak: { label: 'Pronunciation pack (Spanish, French, Italian, Portuguese, Hindi)', url: process.env.AME_ESPEAK_TGZ || 'https://registry.npmjs.org/espeak-phonemizer/-/espeak-phonemizer-0.2.0.tgz', dir: 'espeak-phonemizer', mb: 6, check: 'package/package.json' },
};

// Kokoro v1.0 speaker ids (sherpa-onnx kokoro-multi-lang-v1_0). Prefix: language + gender.
const KOKORO_IDS = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis', 'ef_dora', 'em_alex', 'ff_siwis', 'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi', 'if_sara', 'im_nicola', 'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo', 'pf_dora', 'pm_alex', 'pm_santa', 'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi', 'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang', 'em_santa'];
const LANG = { a: ['en-US', 'English (US)'], b: ['en-GB', 'English (UK)'], e: ['es', 'Spanish'], f: ['fr', 'French'], h: ['hi', 'Hindi'], i: ['it', 'Italian'], j: ['ja', 'Japanese'], p: ['pt-BR', 'Portuguese (Brazil)'], z: ['zh', 'Chinese'] };
const ESPEAK = { e: 'es', f: 'fr', i: 'it', p: 'pt-br', h: 'hi' };
const KOKORO_VOICES = KOKORO_IDS.map((id, sid) => {
  const n = id.split('_')[1];
  return { id, sid, name: n[0].toUpperCase() + n.slice(1), lang: LANG[id[0]][0], language: LANG[id[0]][1], gender: id[1] === 'f' ? 'female' : 'male' };
});

function root() { return P.ensure(path.join(P.models(), 'voices-local')); }
function packPath(name) { const p = PACKS[name]; return path.join(root(), p.file || p.dir); }
function installed(name) { const p = PACKS[name]; return fs.existsSync(p.file ? packPath(name) : path.join(packPath(name), p.check)); }

function tarExe() {
  if (process.platform === 'win32') {
    const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(sys)) return sys;
  }
  return 'tar';
}

const pending = {};
/** Download + unpack a model pack once (concurrent callers share the same download). */
async function ensure(name, ctx) {
  if (installed(name)) return packPath(name);
  if (pending[name]) return pending[name];
  const p = PACKS[name];
  pending[name] = (async () => {
    const tmp = path.join(root(), `.${name}.part`);
    try {
      await net.download(p.url, tmp, { signal: ctx && ctx.signal, onProgress: (g, t) => ctx && ctx.progress && ctx.progress(t ? (g / t) * 100 : 0, `Downloading ${p.label}… ${(g / 1e6).toFixed(0)} / ${((t || p.mb * 1e6) / 1e6).toFixed(0)} MB`) });
      if (p.file) { fs.renameSync(tmp, packPath(name)); return packPath(name); }
      ctx && ctx.progress && ctx.progress(99, `Unpacking ${p.label}…`);
      const dest = name === 'espeak' ? packPath(name) : root();
      fs.mkdirSync(dest, { recursive: true });
      await proc.runOk(tarExe(), [/\.tgz$|\.tar\.gz$/.test(p.url) ? '-xzf' : '-xjf', tmp, '-C', dest], { signal: ctx && ctx.signal });
      if (!installed(name)) throw new Error(`${p.label} could not be unpacked.`);
      return packPath(name);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      delete pending[name];
    }
  })();
  return pending[name];
}

function status() {
  return Object.fromEntries(Object.entries(PACKS).map(([k, p]) => [k, { label: p.label, mb: p.mb, installed: installed(k) }]));
}

function remove(name) {
  if (!PACKS[name]) throw new Error('Unknown pack ' + name);
  fs.rmSync(packPath(name), { recursive: true, force: true });
  if (name === 'kokoro') cache.kokoro = null;
  if (name === 'zipvoice' || name === 'vocos') cache.zipvoice = null;
  return status();
}

// ---------------------------------------------------------------- sherpa-onnx
let sherpa = null;
function lib() {
  if (!sherpa) {
    try { sherpa = require('sherpa-onnx-node'); } catch (e) { throw Object.assign(new Error('The offline voice engine could not start on this computer (' + e.message + ').'), { code: 'no_engine' }); }
  }
  return sherpa;
}
const threads = () => Math.max(1, Math.min(4, os.cpus().length - 1));
const cache = { kokoro: null, zipvoice: null };

async function kokoroTts(ctx) {
  if (cache.kokoro) return cache.kokoro;
  const dir = await ensure('kokoro', ctx);
  ctx && ctx.progress && ctx.progress(5, 'Loading offline voices…');
  const K = (f) => path.join(dir, f);
  cache.kokoro = lib().OfflineTts.createAsync({ model: { kokoro: { model: K('model.onnx'), voices: K('voices.bin'), tokens: K('tokens.txt'), lexicon: `${K('lexicon-us-en.txt')},${K('lexicon-zh.txt')}` }, numThreads: threads(), provider: 'cpu' }, maxNumSentences: 2 })
    .then((t) => { t.vocab = new Set(fs.readFileSync(K('tokens.txt'), 'utf8').split('\n').map((l) => l.replace(/[ \t]\d+\r?$/, '')).filter((x) => x.length)); return t; })
    .catch((e) => { cache.kokoro = null; throw e; });
  return cache.kokoro;
}

async function zipvoiceTts(ctx) {
  if (cache.zipvoice) return cache.zipvoice;
  const [dir, vocos] = await Promise.all([ensure('zipvoice', ctx), ensure('vocos', ctx)]);
  ctx && ctx.progress && ctx.progress(5, 'Loading offline voice cloning…');
  const Z = (f) => path.join(dir, f);
  cache.zipvoice = lib().OfflineTts.createAsync({ model: { zipvoice: { tokens: Z('tokens.txt'), encoder: Z('encoder.int8.onnx'), decoder: Z('decoder.int8.onnx'), vocoder: vocos, lexicon: Z('lexicon.txt') }, numThreads: threads(), provider: 'cpu' } })
    .then((t) => { t.vocab = new Set(fs.readFileSync(Z('tokens.txt'), 'utf8').split('\n').map((l) => l.replace(/[ \t]\d+\r?$/, '')).filter((x) => x.length)); return t; })
    .catch((e) => { cache.zipvoice = null; throw e; });
  return cache.zipvoice;
}

// ---------------------------------------------------------------- phonemes
let enPh = null;
async function phonemesEn(text) {
  if (!enPh) enPh = import('phonemizer').then((m) => m.phonemize);
  const fn = await enPh;
  return (await fn(text, 'en-us')).join(' ').trim();
}

let jaPh = null;
function phonemesJa(text) {
  if (!jaPh) jaPh = require('phonemize/all');
  return String(jaPh.toIPA(text) || '').replace(/\s*([、。])\s*/g, (m, p) => (p === '、' ? ', ' : '. ')).trim();
}

let espeakProc = null;
let espeakSeq = 0;
const espeakWait = new Map();
async function espeakChild(ctx) {
  if (espeakProc && espeakProc.connected) return espeakProc;
  const dir = await ensure('espeak', ctx);
  const entry = path.join(dir, 'package', 'dist', 'espeak.mjs');
  const script = path.join(root(), 'espeak-child.mjs');
  fs.writeFileSync(script, `import { initialize, setVoice, getPhonemes } from ${JSON.stringify(require('url').pathToFileURL(entry).href)};\nawait initialize();\nprocess.on('message', async (m) => { try { await setVoice(m.voice); process.send({ id: m.id, ok: getPhonemes(m.text) }); } catch (e) { process.send({ id: m.id, error: e.message }); } });\nprocess.send({ ready: true });\n`);
  espeakProc = fork(script, [], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The pronunciation pack did not start.')), 30000);
    espeakProc.once('message', (m) => { if (m && m.ready) { clearTimeout(t); resolve(); } });
    espeakProc.once('exit', () => { clearTimeout(t); reject(new Error('The pronunciation pack stopped.')); });
  });
  espeakProc.on('message', (m) => { const w = espeakWait.get(m.id); if (w) { espeakWait.delete(m.id); m.error ? w.reject(new Error(m.error)) : w.resolve(m.ok); } });
  espeakProc.on('exit', () => { espeakProc = null; for (const w of espeakWait.values()) w.reject(new Error('The pronunciation pack stopped.')); espeakWait.clear(); });
  return espeakProc;
}
async function phonemesEspeak(text, voice, ctx) {
  const p = await espeakChild(ctx);
  const id = ++espeakSeq;
  const parts = await new Promise((resolve, reject) => { espeakWait.set(id, { resolve, reject }); p.send({ id, voice, text }); });
  return parts.map((x) => x.phonemes + (x.terminator || '')).join(' ').trim();
}

function sentences(text) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return (s.match(/[^.!?。！？]+[.!?。！？]*["')\]]*/g) || [s]).map((x) => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- synthesis
function toWav(samples, rate, out) {
  lib().writeWave(out, { samples, sampleRate: rate });
  return out;
}

/** Kokoro offline voice → wav file. */
async function kokoro(text, voice, { speed = 1, out, ctx } = {}) {
  const v = KOKORO_VOICES.find((x) => x.id === voice) || KOKORO_VOICES[3];
  const tts = await kokoroTts(ctx);
  const req = { text, sid: v.sid, speed: speed || 1 };
  const lang = v.id[0];
  if (lang !== 'z') {
    // Every language except Chinese is turned into phonemes first, so no word is ever skipped
    // (the bundled English word list misses many everyday words).
    const cps = [];
    for (const s of sentences(text)) {
      const ph = lang === 'a' || lang === 'b' ? await kokoroEn.phonemes(s, lang === 'b') : lang === 'j' ? phonemesJa(s) : await phonemesEspeak(s, ESPEAK[lang], ctx);
      const arr = Array.from(ph).filter((c) => tts.vocab.has(c)).map((c) => c.codePointAt(0));
      if (arr.length) cps.push(arr);
    }
    if (!cps.length) throw new Error('There is nothing this voice can read in that text.');
    req.text = '';
    req.generationConfig = { speed: speed || 1, sid: v.sid, phonemeCodepoints: cps };
  }
  const a = await tts.generateAsync(req);
  if (!a.samples || !a.samples.length) throw new Error('The offline voice produced no audio for this text.');
  return toWav(a.samples, a.sampleRate, out || P.tempFile('.wav'));
}

function isChinese(s) { return /[\u3400-\u9fff]/.test(s); }

/** Turn text into ZipVoice token strings (Chinese is handled by the model's lexicon). */
async function zipTokens(text, vocab) {
  const out = [];
  for (const s of sentences(text)) {
    if (isChinese(s)) return null; // let the lexicon handle Chinese / mixed text
    const end = (/[.!?,;:]$/.exec(s) || ['.'])[0];
    const ph = await phonemesEn(s.replace(/[.!?。！？]+$/, ''));
    out.push(...Array.from(ph).filter((c) => vocab.has(c)), end, ' ');
  }
  return out;
}

/**
 * Speak with a voice cloned on this computer.
 * @param {{sample:string, refText:string}} voice  reference wav (24 kHz mono) + its transcript
 */
async function cloneSpeak(text, voice, { speed = 1, out, ctx, steps = 4 } = {}) {
  if (!voice || !voice.sample || !fs.existsSync(voice.sample)) throw new Error('The sample for this offline voice is missing. Clone it again from Voice clone.');
  if (!voice.refText) throw new Error('This offline voice has no transcript for its sample. Clone it again from Voice clone.');
  const tts = await zipvoiceTts(ctx);
  const ref = lib().readWave(voice.sample);
  const gc = { referenceAudio: ref.samples, referenceSampleRate: ref.sampleRate, referenceText: voice.refText, numSteps: steps, speed: speed || 1 };
  if (!isChinese(text) && !isChinese(voice.refText)) {
    const [r, t] = await Promise.all([zipTokens(voice.refText, tts.vocab), zipTokens(text, tts.vocab)]);
    if (r && t) { gc.tokens = [r, t]; gc.referenceText = voice.refText; }
  }
  const a = await tts.generateAsync({ text: gc.tokens ? 'x' : text, sid: 0, speed: speed || 1, generationConfig: gc });
  if (!a.samples || !a.samples.length) throw new Error('The offline voice produced no audio. Try a cleaner 5–10 second sample.');
  return toWav(a.samples, a.sampleRate, out || P.tempFile('.wav'));
}

function shutdown() {
  if (espeakProc) { try { espeakProc.kill(); } catch (_) { /* ignore */ } }
}

module.exports = { PACKS, KOKORO_VOICES, LANG, ensure, status, remove, installed, kokoro, cloneSpeak, phonemesEn, sentences, shutdown };
