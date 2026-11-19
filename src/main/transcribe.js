'use strict';
// Transcription: built-in cloud AI (default — fast, no keys, plan credits), local whisper.cpp (6 model sizes,
// CPU or NVIDIA, free/offline), own-key OpenAI, Groq and Gladia engines (advanced mode), or platform captions. Output is always { language, segments:[{start,end,text}], text, engine, model }.
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./paths');
const store = require('./store');
const bins = require('./bins');
const media = require('./media');
const net = require('./util/net');
const proc = require('./util/proc');
const subs = require('./subtitles');
const cloud = require('./cloud');

const WHISPER_MODELS = [
  { id: 'tiny', label: 'Tiny', mb: 75, note: 'Fastest, lowest accuracy' },
  { id: 'base', label: 'Base', mb: 142, note: 'Fast, good for clear speech' },
  { id: 'small', label: 'Small', mb: 466, note: 'Balanced' },
  { id: 'medium', label: 'Medium', mb: 1530, note: 'High accuracy, slower' },
  { id: 'large-v3-turbo-q5_0', label: 'Large v3 Turbo (compact)', mb: 547, note: 'Near-best accuracy, small download' },
  { id: 'large-v3-turbo', label: 'Large v3 Turbo', mb: 1620, note: 'Best accuracy; NVIDIA GPU recommended' },
  { id: 'base.en', label: 'Base (English only)', mb: 142, note: 'English-only, faster' },
  { id: 'small.en', label: 'Small (English only)', mb: 466, note: 'English-only' },
];

function modelsDir() { return P.ensure(path.join(P.models(), 'whisper')); }
function modelFile(id) { return path.join(modelsDir(), id.startsWith('custom:') ? id.slice(7) : `ggml-${id}.bin`); }

/** Built-in list plus models the vendor adds to the catalogue (wp-admin → Model catalogue). */
function allModels() {
  let extra = [];
  try { extra = (require('./bins').catalog().whisper || []).filter((m) => m && m.id && /^[\w.-]+$/.test(m.id) && !WHISPER_MODELS.some((x) => x.id === m.id)).map((m) => ({ id: String(m.id), label: String(m.label || m.id), mb: Number(m.mb) || 0, note: String(m.note || ''), url: String(m.url || ''), isNew: true })); } catch (_) { /* offline */ }
  return WHISPER_MODELS.concat(extra);
}

function listModels() {
  const dir = modelsDir();
  const custom = fs.readdirSync(dir).filter((f) => f.endsWith('.bin') && !f.startsWith('ggml-')).map((f) => ({ id: 'custom:' + f, label: f.replace(/\.bin$/, '') + ' (custom)', mb: Math.round(fs.statSync(path.join(dir, f)).size / 1e6), note: 'Imported model', custom: true }));
  return allModels().concat(custom).map((m) => Object.assign({}, m, { installed: fs.existsSync(modelFile(m.id)) }));
}

/** Add a ggml Whisper model straight from a Hugging Face file link. */
async function addFromHf(link, ctx) {
  const { url, name } = require('./bins').hfFileUrl(link);
  if (!/\.bin$/i.test(name)) throw new Error('Whisper needs a ggml model file ending in .bin (for example ggml-large-v3-turbo.bin).');
  const dest = path.join(modelsDir(), name.replace(/^ggml-/, 'custom-'));
  if (!fs.existsSync(dest)) {
    const part = dest + '.part';
    await net.download(url, part, { signal: ctx.signal, onProgress: (g, t) => ctx.progress(t ? (g / t) * 100 : 0, `Downloading ${name}… ${(g / 1e6).toFixed(0)}${t ? ' / ' + (t / 1e6).toFixed(0) : ''} MB`) });
    fs.renameSync(part, dest);
  }
  return listModels();
}

async function downloadModel(id, ctx) {
  const m = allModels().find((x) => x.id === id);
  if (!m) throw new Error('Unknown model ' + id);
  const dest = modelFile(id);
  if (fs.existsSync(dest)) return dest;
  const url = m.url ? require('./bins').hfFileUrl(m.url).url : `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`;
  await net.download(url, dest, { signal: ctx.signal, onProgress: (g, t) => ctx.progress(t ? (g / t) * 100 : 0, `Downloading Whisper ${m.label}… ${(g / 1e6).toFixed(0)} / ${(t / 1e6 || m.mb).toFixed(0)} MB`) });
  return dest;
}

function deleteModel(id) {
  const f = modelFile(id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  return listModels();
}

function importModel(file) {
  if (!/\.bin$/i.test(file)) throw new Error('Pick a ggml Whisper model (.bin) file.');
  const dest = path.join(modelsDir(), path.basename(file).replace(/^ggml-/, 'custom-'));
  fs.copyFileSync(file, dest);
  return listModels();
}

function threads() {
  const s = store.getSettings().transcription;
  return s.threads > 0 ? s.threads : Math.max(2, Math.min(8, os.cpus().length - 1));
}

async function runLocal(input, opt, ctx) {
  const s = store.getSettings().transcription;
  const modelId = opt.model || s.model || 'base';
  if (!fs.existsSync(modelFile(modelId))) {
    if (modelId.startsWith('custom:')) throw new Error('Custom model file is missing.');
    await downloadModel(modelId, ctx);
  }
  const flavor = (opt.gpu || s.gpu) === 'cuda' ? 'cuda' : 'cpu';
  const cli = await bins.ensureWhisper(flavor, ctx);
  const info = await media.probe(input, ctx);
  const wav = P.tempFile('.wav');
  ctx.progress(0, 'Preparing audio…');
  await media.toWav16k(input, wav, ctx, info.duration);
  const base = P.tempFile('');
  const args = ['-m', modelFile(modelId), '-f', wav, '-oj', '-of', base, '-pp', '-t', String(threads()), '-l', opt.language && opt.language !== 'auto' ? opt.language : 'auto'];
  if (opt.translate) args.push('-tr');
  if (opt.prompt) args.push('--prompt', String(opt.prompt).slice(0, 800));
  if (opt.maxLen) args.push('-ml', String(opt.maxLen), '-sow');
  ctx.progress(0, 'Transcribing on this computer…');
  const onLine = (line) => {
    const m = /progress\s*=\s*(\d+)%/.exec(line);
    if (m) ctx.progress(Number(m[1]), `Transcribing… ${m[1]}%`);
  };
  try {
    await proc.runOk(cli, args, { signal: ctx.signal, onStderr: onLine, onStdout: onLine, cwd: path.dirname(cli) });
    const j = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
    const segments = (j.transcription || []).map((x) => ({ start: x.offsets.from / 1000, end: x.offsets.to / 1000, text: String(x.text || '').trim() })).filter((x) => x.text && !/^\[(BLANK_AUDIO|MUSIC|Music)\]$/.test(x.text));
    return { language: (j.result && j.result.language) || opt.language || '', segments, engine: 'local', model: modelId, duration: info.duration };
  } finally {
    for (const f of [wav, base + '.json']) { try { fs.unlinkSync(f); } catch (_) { /* ignore */ } }
  }
}

async function runOpenAICompat(input, opt, ctx, provider) {
  const s = store.getSettings().transcription;
  const key = store.getSecret(provider);
  if (!key) throw new Error(`Add your ${provider === 'groq' ? 'Groq' : 'OpenAI'} API key in Settings → AI keys.`);
  const url = process.env.AME_OPENAI_BASE ? process.env.AME_OPENAI_BASE.replace(/\/+$/, '') + '/audio/' : provider === 'groq' ? 'https://api.groq.com/openai/v1/audio/' : 'https://api.openai.com/v1/audio/';
  const model = provider === 'groq' ? (s.groqModel || 'whisper-large-v3-turbo') : (s.openaiModel || 'whisper-1');
  const info = await media.probe(input, ctx);
  const { dir, chunks } = await media.chunkAudio(input, info.duration || 1, 600, ctx);
  const segments = [];
  let language = '';
  try {
    for (let i = 0; i < chunks.length; i++) {
      ctx.check();
      ctx.progress((i / chunks.length) * 100, `Transcribing in the cloud… part ${i + 1}/${chunks.length}`);
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(chunks[i].file)], { type: 'audio/mpeg' }), 'audio.mp3');
      fd.append('model', model);
      fd.append('response_format', 'verbose_json');
      fd.append('timestamp_granularities[]', 'segment');
      if (opt.language && opt.language !== 'auto' && !opt.translate) fd.append('language', opt.language);
      if (opt.prompt) fd.append('prompt', String(opt.prompt).slice(0, 800));
      const endpoint = opt.translate ? 'translations' : 'transcriptions';
      const j = await net.json(url + endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd, signal: ctx.signal, label: provider === 'groq' ? 'Groq' : 'OpenAI' });
      language = language || j.language || '';
      const segs = j.segments && j.segments.length ? j.segments : [{ start: 0, end: Math.min(600, info.duration), text: j.text || '' }];
      for (const sg of segs) segments.push({ start: sg.start + chunks[i].offset, end: sg.end + chunks[i].offset, text: String(sg.text || '').trim() });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { language: langCode(language), segments: segments.filter((x) => x.text), engine: provider, model, duration: info.duration };
}

/**
 * Built-in cloud transcription. The audio is cut into parts (the AI server sets the length, ~3–5 minutes) that are
 * encoded small (16 kHz mono) and sent several at a time, so a one-hour video takes roughly as long as its slowest few parts.
 */
async function runCloud(input, opt, ctx) {
  const info = await media.probe(input, ctx);
  const duration = Number(info.duration) || 0;
  const lim = await cloud.limits();
  const partSeconds = Math.max(60, Math.min(600, Number(lim && lim.transcribe_part_seconds) || 300));
  const n = duration > 0 ? Math.max(1, Math.round(duration / partSeconds)) : 1;
  const size = n > 1 ? duration / n : duration;
  const dir = P.tempDir('chunks');
  const endpoint = opt.translate ? '/v1/audio/translations' : '/v1/audio/transcriptions';
  let done = 0;
  ctx.progress(1, n > 1 ? `Transcribing ${n} parts at once…` : 'Transcribing…');
  try {
    const parts = await cloud.pool(Array.from({ length: n }, (_, i) => i), 4, async (i) => {
      ctx.check();
      const start = i * size;
      const out = path.join(dir, `c${String(i).padStart(3, '0')}.mp3`);
      await media.toMp3(input, out, { start: n > 1 ? start : undefined, end: n > 1 ? (i === n - 1 ? duration : start + size) : undefined, bitrate: '32k', rate: 16000 }, null);
      ctx.check();
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(out)], { type: 'audio/mpeg' }), 'audio.mp3');
      if (opt.language && opt.language !== 'auto' && !opt.translate) fd.append('language', opt.language);
      if (opt.prompt) fd.append('prompt', String(opt.prompt).slice(0, 800));
      const j = await cloud.request(endpoint, { method: 'POST', body: fd, signal: ctx.signal });
      try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
      done++;
      ctx.progress(Math.min(99, (done / n) * 100), n > 1 ? `Transcribed ${done} of ${n} parts…` : 'Transcribing…');
      return { j, offset: n > 1 ? start : 0, len: n > 1 ? size : duration };
    });
    const segments = [];
    let language = '';
    for (const { j, offset, len } of parts) {
      language = language || j.language || '';
      const segs = j.segments && j.segments.length ? j.segments : [{ start: 0, end: len || 0, text: j.text || '' }];
      for (const sg of segs) segments.push({ start: Number(sg.start) + offset, end: Number(sg.end) + offset, text: String(sg.text || '').trim() });
    }
    return { language: langCode(opt.translate ? 'en' : language), segments: segments.filter((x) => x.text), engine: 'cloud', model: 'built-in', duration };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runGladia(input, opt, ctx) {
  const key = store.getSecret('gladia');
  if (!key) throw new Error('Add your Gladia API key in Settings → AI keys.');
  const info = await media.probe(input, ctx);
  const mp3 = P.tempFile('.mp3');
  await media.toMp3(input, mp3, { bitrate: '96k' }, ctx);
  try {
    ctx.progress(10, 'Uploading to Gladia…');
    const fd = new FormData();
    fd.append('audio', new Blob([fs.readFileSync(mp3)], { type: 'audio/mpeg' }), 'audio.mp3');
    const up = await net.json('https://api.gladia.io/v2/upload', { method: 'POST', headers: { 'x-gladia-key': key }, body: fd, signal: ctx.signal, label: 'Gladia' });
    const body = { audio_url: up.audio_url };
    if (opt.language && opt.language !== 'auto') body.language_config = { languages: [opt.language], code_switching: false };
    if (opt.translate) body.translation = true, body.translation_config = { target_languages: ['en'] };
    const job = await net.json('https://api.gladia.io/v2/pre-recorded', { method: 'POST', headers: { 'x-gladia-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx.signal, label: 'Gladia' });
    const started = Date.now();
    for (;;) {
      ctx.check();
      await new Promise((r) => setTimeout(r, 3000));
      const st = await net.json(job.result_url || `https://api.gladia.io/v2/pre-recorded/${job.id}`, { headers: { 'x-gladia-key': key }, signal: ctx.signal, label: 'Gladia' });
      if (st.status === 'done') {
        const tr = st.result && st.result.transcription;
        const utter = (tr && tr.utterances) || [];
        return { language: (tr && tr.languages && tr.languages[0]) || opt.language || '', segments: utter.map((u) => ({ start: u.start, end: u.end, text: String(u.text || '').trim() })), engine: 'gladia', model: 'gladia', duration: info.duration };
      }
      if (st.status === 'error') throw new Error('Gladia: ' + (st.error_code || 'transcription failed'));
      ctx.progress(Math.min(95, 15 + ((Date.now() - started) / 1000 / Math.max(30, info.duration / 4)) * 80), 'Gladia is transcribing…');
    }
  } finally {
    try { fs.unlinkSync(mp3); } catch (_) { /* ignore */ }
  }
}

const LANG_NAMES = { english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', dutch: 'nl', russian: 'ru', chinese: 'zh', japanese: 'ja', korean: 'ko', arabic: 'ar', hindi: 'hi', turkish: 'tr', polish: 'pl', ukrainian: 'uk', vietnamese: 'vi', indonesian: 'id', thai: 'th', swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi', greek: 'el', czech: 'cs', romanian: 'ro', hungarian: 'hu', hebrew: 'he', persian: 'fa', bengali: 'bn', urdu: 'ur', tamil: 'ta', telugu: 'te', malay: 'ms', tagalog: 'tl' };
function langCode(l) { const s = String(l || '').toLowerCase(); return LANG_NAMES[s] || s; }

/**
 * Transcribe a media file.
 * @param {string} input
 * @param {{engine?:string, model?:string, language?:string, translate?:boolean, prompt?:string, gpu?:string}} opt
 */
async function transcribe(input, opt, ctx) {
  const s = store.getSettings().transcription;
  let engine = opt.engine || s.engine || 'cloud';
  if (store.getSettings().privateMode && engine !== 'local') engine = 'local'; // Private mode: offline Whisper only
  const o = Object.assign({ language: s.language }, opt);
  let r;
  if (engine === 'cloud') r = await runCloud(input, o, ctx);
  else if (engine === 'openai' || engine === 'groq') r = await runOpenAICompat(input, o, ctx, engine);
  else if (engine === 'gladia') r = await runGladia(input, o, ctx);
  else r = await runLocal(input, o, ctx);
  r.text = subs.toTXT(r.segments);
  r.words = r.text.split(/\s+/).filter(Boolean).length;
  r.createdAt = Date.now();
  return r;
}

/** Turn a VTT caption file into a transcript result. */
function fromCaptions(vttFile, lang) {
  const segs = subs.dedupeRolling(subs.parseSRTorVTT(fs.readFileSync(vttFile, 'utf8')));
  const text = subs.toTXT(segs);
  return { language: lang || '', segments: segs, text, words: text.split(/\s+/).filter(Boolean).length, engine: 'captions', model: 'platform captions', createdAt: Date.now() };
}

module.exports = { WHISPER_MODELS, listModels, downloadModel, deleteModel, importModel, addFromHf, transcribe, fromCaptions, modelFile, langCode };
