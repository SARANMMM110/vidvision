'use strict';
// Text-to-speech engines: built-in cloud voices + your cloned voices (no keys, plan credits — see cloud.js),
// Kokoro and Piper (local, free), and — in advanced mode — OpenAI, Google Gemini, ElevenLabs with your own keys
// or any OpenAI-compatible speech server (e.g. self-hosted Kokoro-FastAPI, Chatterbox, OpenVoice).
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const store = require('./store');
const media = require('./media');
const bins = require('./bins');
const net = require('./util/net');
const proc = require('./util/proc');
const engines = require('./engines');
const cloud = require('./cloud');
const localvoice = require('./localvoice');

const ENGINES = {
  cloud: { label: 'Built-in voices', local: false, cloud: true, style: true, speed: false, maxChars: 3800 },
  myvoices: { label: 'My cloned voices', local: false, cloud: true, style: false, speed: true, maxChars: 4500, clone: true, design: true },
  kokoro: { label: 'Kokoro (54 voices, 8 languages)', local: true, free: true, style: false, speed: true, maxChars: 700 },
  localclone: { label: 'Your offline voices', local: true, free: true, style: false, speed: true, maxChars: 500, clone: true, design: true },
  piper: { label: 'Piper', local: true, free: true, style: false, speed: true, maxChars: 4000 },
  openai: { label: 'OpenAI', local: false, style: true, speed: false, maxChars: 3800 },
  gemini: { label: 'Google Gemini', local: false, style: true, speed: false, maxChars: 2500, multi: true },
  elevenlabs: { label: 'ElevenLabs', local: false, style: false, speed: true, maxChars: 4500, clone: true, design: true },
  custom: { label: 'Custom server', local: false, style: true, speed: true, maxChars: 3000 },
};

const KOKORO_VOICES = localvoice.KOKORO_VOICES.map((v) => ({ id: v.id, name: v.name, lang: v.lang, gender: v.gender, desc: v.language }));
const KOKORO_EN = [
  ['af_heart', 'Heart', 'en-US', 'female'], ['af_alloy', 'Alloy', 'en-US', 'female'], ['af_aoede', 'Aoede', 'en-US', 'female'], ['af_bella', 'Bella', 'en-US', 'female'],
  ['af_jessica', 'Jessica', 'en-US', 'female'], ['af_kore', 'Kore', 'en-US', 'female'], ['af_nicole', 'Nicole', 'en-US', 'female'], ['af_nova', 'Nova', 'en-US', 'female'],
  ['af_river', 'River', 'en-US', 'female'], ['af_sarah', 'Sarah', 'en-US', 'female'], ['af_sky', 'Sky', 'en-US', 'female'], ['am_adam', 'Adam', 'en-US', 'male'],
  ['am_echo', 'Echo', 'en-US', 'male'], ['am_eric', 'Eric', 'en-US', 'male'], ['am_fenrir', 'Fenrir', 'en-US', 'male'], ['am_liam', 'Liam', 'en-US', 'male'],
  ['am_michael', 'Michael', 'en-US', 'male'], ['am_onyx', 'Onyx', 'en-US', 'male'], ['am_puck', 'Puck', 'en-US', 'male'], ['am_santa', 'Santa', 'en-US', 'male'],
  ['bf_alice', 'Alice', 'en-GB', 'female'], ['bf_emma', 'Emma', 'en-GB', 'female'], ['bf_isabella', 'Isabella', 'en-GB', 'female'], ['bf_lily', 'Lily', 'en-GB', 'female'],
  ['bm_daniel', 'Daniel', 'en-GB', 'male'], ['bm_fable', 'Fable', 'en-GB', 'male'], ['bm_george', 'George', 'en-GB', 'male'], ['bm_lewis', 'Lewis', 'en-GB', 'male'],
].map(([id, name, lang, gender]) => ({ id, name, lang, gender }));

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), lang: 'multi', gender: /^(ash|echo|onyx|ballad|verse|fable)$/.test(id) ? 'male' : 'female' }));

const CLOUD_VOICES = [
  ['marin', 'Marin', 'female', 'Most natural'], ['cedar', 'Cedar', 'male', 'Most natural'], ['nova', 'Nova', 'female', 'Bright, friendly'], ['onyx', 'Onyx', 'male', 'Deep, confident'],
  ['coral', 'Coral', 'female', 'Warm'], ['ash', 'Ash', 'male', 'Clear'], ['sage', 'Sage', 'female', 'Calm'], ['echo', 'Echo', 'male', 'Smooth'],
  ['shimmer', 'Shimmer', 'female', 'Soft'], ['ballad', 'Ballad', 'male', 'Expressive'], ['alloy', 'Alloy', 'neutral', 'Balanced'], ['fable', 'Fable', 'male', 'Storyteller'],
  ['verse', 'Verse', 'male', 'Dynamic'],
].map(([id, name, gender, desc]) => ({ id, name, gender, desc, lang: 'multi' }));

const GEMINI_VOICES = [
  ['Zephyr', 'Bright', 'female'], ['Puck', 'Upbeat', 'male'], ['Charon', 'Informative', 'male'], ['Kore', 'Firm', 'female'], ['Fenrir', 'Excitable', 'male'], ['Leda', 'Youthful', 'female'],
  ['Orus', 'Firm', 'male'], ['Aoede', 'Breezy', 'female'], ['Callirrhoe', 'Easy-going', 'female'], ['Autonoe', 'Bright', 'female'], ['Enceladus', 'Breathy', 'male'], ['Iapetus', 'Clear', 'male'],
  ['Umbriel', 'Easy-going', 'male'], ['Algieba', 'Smooth', 'male'], ['Despina', 'Smooth', 'female'], ['Erinome', 'Clear', 'female'], ['Algenib', 'Gravelly', 'male'], ['Rasalgethi', 'Informative', 'male'],
  ['Laomedeia', 'Upbeat', 'female'], ['Achernar', 'Soft', 'female'], ['Alnilam', 'Firm', 'male'], ['Schedar', 'Even', 'male'], ['Gacrux', 'Mature', 'female'], ['Pulcherrima', 'Forward', 'female'],
  ['Achird', 'Friendly', 'male'], ['Zubenelgenubi', 'Casual', 'male'], ['Vindemiatrix', 'Gentle', 'female'], ['Sadachbia', 'Lively', 'male'], ['Sadaltager', 'Knowledgeable', 'male'], ['Sulafat', 'Warm', 'female'],
].map(([id, desc, gender]) => ({ id, name: id, desc, lang: 'multi', gender }));

function ttsSettings() {
  return Object.assign({ geminiModel: 'gemini-2.5-flash-preview-tts', openaiModel: 'gpt-4o-mini-tts', elevenModel: 'eleven_multilingual_v2', customBaseUrl: '', customModel: 'tts-1', customVoices: '' }, store.getSettings().tts || {});
}

// ---------- Piper voice catalogue
function piperDir() { return P.ensure(path.join(P.models(), 'piper')); }

async function piperCatalog() {
  const f = path.join(piperDir(), 'voices.json');
  let data = store.readJson(f, null);
  if (!data || (Date.now() - fs.statSync(f).mtimeMs) > 30 * 86400000) {
    try {
      data = await net.json('https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json', { label: 'Piper voices', timeout: 30000 });
      fs.writeFileSync(f, JSON.stringify(data));
    } catch (e) { if (!data) throw e; }
  }
  return Object.values(data).map((v) => {
    const onnx = Object.keys(v.files).find((k) => k.endsWith('.onnx'));
    return {
      id: v.key,
      name: `${v.name} (${v.quality})`,
      lang: v.language.code.replace('_', '-'),
      language: `${v.language.name_english} (${v.language.country_english})`,
      quality: v.quality,
      speakers: v.num_speakers,
      mb: Math.round((v.files[onnx] && v.files[onnx].size_bytes || 0) / 1e6),
      file: onnx,
      installed: fs.existsSync(path.join(piperDir(), path.basename(onnx))),
    };
  });
}

async function ensurePiperVoice(id, ctx) {
  const list = await piperCatalog();
  const v = list.find((x) => x.id === id);
  if (!v) throw new Error('Unknown Piper voice ' + id);
  const model = path.join(piperDir(), path.basename(v.file));
  if (!fs.existsSync(model)) {
    const base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
    await net.download(base + v.file + '.json', model + '.json', { signal: ctx && ctx.signal });
    await net.download(base + v.file, model, { signal: ctx && ctx.signal, onProgress: (g, t) => ctx && ctx.progress(t ? (g / t) * 100 : 0, `Downloading Piper voice ${v.name}… ${(g / 1e6).toFixed(0)} MB`) });
  }
  return model;
}

// ---------- voices
async function voices(engine) {
  switch (engine) {
    case 'cloud': {
      // The voice list comes from the AI server, so new voices appear without an app update.
      const c = await cloud.voiceCatalog().catch(() => null);
      return c && c.voices.length ? c.voices : CLOUD_VOICES;
    }
    case 'myvoices': {
      const j = await cloud.request('/v1/voices', { method: 'GET' });
      return (j.voices || []).map((v) => ({ id: v.id, name: v.name, lang: 'multi', desc: 'Your voice', cloned: true }));
    }
    case 'kokoro': return KOKORO_VOICES;
    case 'localclone': return [];
    case 'openai': return OPENAI_VOICES;
    case 'gemini': return GEMINI_VOICES;
    case 'piper': return piperCatalog();
    case 'elevenlabs': {
      const key = store.getSecret('elevenlabs');
      if (!key) throw new Error('Add your ElevenLabs API key in Settings → AI keys.');
      const j = await net.json('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key }, label: 'ElevenLabs' });
      return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, lang: (v.labels && (v.labels.language || v.labels.accent)) || 'multi', gender: v.labels && v.labels.gender, desc: [v.category, v.labels && v.labels.description, v.labels && v.labels.use_case].filter(Boolean).join(' · '), preview: v.preview_url }));
    }
    case 'custom': {
      const s = ttsSettings();
      const manual = String(s.customVoices || '').split(',').map((x) => x.trim()).filter(Boolean).map((id) => ({ id, name: id, lang: 'multi' }));
      if (!s.customBaseUrl) return manual;
      try {
        const key = store.getSecret('custom');
        const j = await net.json(s.customBaseUrl.replace(/\/+$/, '') + '/audio/voices', { headers: key ? { Authorization: 'Bearer ' + key } : {}, timeout: 6000, label: 'Custom TTS' });
        const arr = Array.isArray(j) ? j : (j.voices || []);
        return arr.map((v) => (typeof v === 'string' ? { id: v, name: v, lang: 'multi' } : { id: v.id || v.name, name: v.name || v.id, lang: v.language || 'multi' })).concat(manual);
      } catch (_) { return manual; }
    }
    default: return [];
  }
}

// ---------- text chunking
function splitText(text, max) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?。！？\n]+[.!?。！？]*[\])'"’”]*\s*|\n+/g) || [clean];
  const out = [];
  let cur = '';
  for (let s of sentences) {
    if (/^\n+$/.test(s)) { if (cur.trim()) { out.push(cur.trim()); cur = ''; } continue; }
    while (s.length > max) {
      const cut = s.lastIndexOf(' ', max) > max / 2 ? s.lastIndexOf(' ', max) : max;
      if (cur.trim()) { out.push(cur.trim()); cur = ''; }
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut);
    }
    if ((cur + s).length > max && cur.trim()) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------- single-chunk synthesizers (return path to an audio file)
async function synthOpenAI(text, o, ctx) {
  const key = store.getSecret('openai');
  if (!key) throw new Error('Add your OpenAI API key in Settings → AI keys.');
  const s = ttsSettings();
  const body = { model: o.model || s.openaiModel, voice: o.voice || 'alloy', input: text, response_format: 'mp3' };
  if (o.style) body.instructions = String(o.style).slice(0, 2000);
  const buf = await net.buffer('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx && ctx.signal, label: 'OpenAI TTS' });
  const out = P.tempFile('.mp3');
  fs.writeFileSync(out, buf);
  return out;
}

async function synthCloud(text, o, ctx) {
  const body = { voice: o.voice || 'marin', input: text, response_format: 'mp3' };
  if (o.keepVoice) body.keep_voice = true; // part of a longer recording: wait for the same voice rather than switch engines
  if (o.style) body.instructions = String(o.style).slice(0, 2000);
  if (o.nativeSpeed && o.speed && Math.abs(o.speed - 1) > 0.01) body.speed = o.speed;
  if (o.lang || o.language) body.language = String(o.lang || o.language).slice(0, 12);
  let buf;
  for (let attempt = 0; ; attempt++) {
    try {
      buf = await cloud.request('/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx && ctx.signal }, 'buffer');
      break;
    } catch (e) {
      // The voice server is busy with other customers: wait a little and try again, so a long script keeps one voice.
      // If it stays busy, the last try lets the backup voice read this part rather than fail the whole recording.
      if (!(body.keep_voice && e.code === 'provider_busy')) throw e;
      if (ctx && ctx.signal && ctx.signal.aborted) throw e;
      if (attempt >= 3) { delete body.keep_voice; continue; }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  const out = P.tempFile('.mp3');
  fs.writeFileSync(out, buf);
  return out;
}

async function synthMyVoice(text, o, ctx) {
  if (!o.voice) throw new Error('Choose one of your cloned voices.');
  const vs = Object.assign({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true }, o.elevenSettings || {});
  if (o.speed && Math.abs(o.speed - 1) > 0.01) vs.speed = Math.max(0.7, Math.min(1.2, o.speed));
  const body = { text, voice_settings: vs };
  if (o.languageCode) body.language_code = o.languageCode;
  const buf = await cloud.request(`/v1/voices/${encodeURIComponent(o.voice)}/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx && ctx.signal }, 'buffer');
  const out = P.tempFile('.mp3');
  fs.writeFileSync(out, buf);
  return out;
}

async function synthGemini(text, o, ctx) {
  const key = store.getSecret('gemini');
  if (!key) throw new Error('Add your Google Gemini API key in Settings → AI keys.');
  const s = ttsSettings();
  const prompt = o.style ? `${o.style.trim().replace(/[.:]+$/, '')}:\n${text}` : text;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: {} } };
  if (o.speakers && o.speakers.length) {
    body.generationConfig.speechConfig.multiSpeakerVoiceConfig = { speakerVoiceConfigs: o.speakers.map((sp) => ({ speaker: sp.name, voiceConfig: { prebuiltVoiceConfig: { voiceName: sp.voice } } })) };
  } else {
    body.generationConfig.speechConfig.voiceConfig = { prebuiltVoiceConfig: { voiceName: o.voice || 'Kore' } };
  }
  const j = await net.json(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model || s.geminiModel)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx && ctx.signal, label: 'Gemini TTS' });
  const part = j.candidates && j.candidates[0] && j.candidates[0].content && (j.candidates[0].content.parts || []).find((p) => p.inlineData || p.inline_data);
  if (!part) throw new Error('Gemini returned no audio. Try a different voice or shorter text.');
  const inl = part.inlineData || part.inline_data;
  const rate = Number((/rate=(\d+)/.exec(inl.mimeType || inl.mime_type || '') || [])[1] || 24000);
  const out = P.tempFile('.wav');
  media.writeWavPcm16(Buffer.from(inl.data, 'base64'), rate, 1, out);
  return out;
}

async function synthEleven(text, o, ctx) {
  const key = store.getSecret('elevenlabs');
  if (!key) throw new Error('Add your ElevenLabs API key in Settings → AI keys.');
  const s = ttsSettings();
  const vs = Object.assign({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true }, o.elevenSettings || {});
  if (o.speed && Math.abs(o.speed - 1) > 0.01) vs.speed = Math.max(0.7, Math.min(1.2, o.speed));
  const body = { text, model_id: o.model || s.elevenModel, voice_settings: vs };
  if (o.languageCode) body.language_code = o.languageCode;
  const buf = await net.buffer(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(o.voice)}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body), signal: ctx && ctx.signal, label: 'ElevenLabs' });
  const out = P.tempFile('.mp3');
  fs.writeFileSync(out, buf);
  return out;
}

async function synthCustom(text, o, ctx) {
  const s = ttsSettings();
  if (!s.customBaseUrl) throw new Error('Set the custom TTS server address in Settings → Voice engines.');
  const key = store.getSecret('custom');
  const body = { model: s.customModel || 'tts-1', voice: o.voice, input: text, response_format: 'mp3', speed: o.speed || 1 };
  if (o.style) body.instructions = o.style;
  const buf = await net.buffer(s.customBaseUrl.replace(/\/+$/, '') + '/audio/speech', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: 'Bearer ' + key } : {}), body: JSON.stringify(body), signal: ctx && ctx.signal, label: 'Custom TTS' });
  const out = P.tempFile('.mp3');
  fs.writeFileSync(out, buf);
  return out;
}

async function synthPiper(text, o, ctx) {
  const exe = await bins.ensurePiper(ctx);
  const model = await ensurePiperVoice(o.voice || 'en_US-lessac-medium', ctx);
  const out = P.tempFile('.wav');
  const args = ['--model', model, '--output_file', out];
  if (o.speed && Math.abs(o.speed - 1) > 0.01) args.push('--length_scale', (1 / o.speed).toFixed(3));
  if (o.speaker !== undefined) args.push('--speaker', String(o.speaker));
  await proc.runOk(exe, args, { input: text, cwd: path.dirname(exe), signal: ctx && ctx.signal });
  return out;
}

async function synthKokoro(text, o, ctx) {
  try {
    return await localvoice.kokoro(text, o.voice || 'af_heart', { speed: o.speed || 1, ctx });
  } catch (e) {
    // native engine unavailable on this PC → in-app web engine (English voices only)
    if (e.code !== 'no_engine' || !KOKORO_EN.some((v) => v.id === o.voice)) throw e;
    const r = await engines.run('kokoro', { text, voice: o.voice || 'af_heart', speed: o.speed || 1 }, ctx);
    const out = P.tempFile('.wav');
    media.writeWavFloat(r.audio, r.sampleRate, out);
    return out;
  }
}

/** Voices cloned or designed on this computer (stored in the Voice Library with their sample + transcript). */
async function synthLocalClone(text, o, ctx) {
  const v = require('./library').voices.list().find((x) => x.engine === 'localclone' && x.voice === o.voice);
  if (!v) throw new Error('This offline voice is no longer in your Voice Library.');
  return localvoice.cloneSpeak(text, { sample: v.sample, refText: v.refText }, { speed: o.speed || 1, ctx });
}

const SYNTH = { localclone: synthLocalClone, cloud: synthCloud, myvoices: synthMyVoice, openai: synthOpenAI, gemini: synthGemini, elevenlabs: synthEleven, custom: synthCustom, piper: synthPiper, kokoro: synthKokoro };

/**
 * Synthesize text to an audio file.
 * @param {{engine:string, voice:string, text:string, speed?:number, style?:string, model?:string, elevenSettings?:object, speakers?:Array}} o
 * @param {string} outFile .mp3/.wav/.flac/.ogg/.m4a
 */
async function synth(o, outFile, ctx) {
  if (store.getSettings().privateMode && ENGINES[o.engine] && !ENGINES[o.engine].local) {
    // Private mode: speak with an offline Kokoro voice instead of an online one.
    const lang = String(o.lang || o.language || '').toLowerCase();
    const k = (KOKORO_VOICES || []).find((v) => lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    o = Object.assign({}, o, { engine: 'kokoro', voice: k ? k.id : 'af_heart', style: '' });
  }
  let eng = ENGINES[o.engine];
  if (!eng) throw new Error('Unknown voice engine: ' + o.engine);
  const fn = SYNTH[o.engine];
  // The AI server says how much text one request may carry and how many may run at once.
  let maxChars = eng.maxChars;
  let parallel = eng.local ? 1 : 4;
  if (o.engine === 'cloud' || o.engine === 'myvoices') {
    const c = await cloud.limits();
    const k = o.engine === 'cloud' ? 'tts' : 'clone';
    if (c && Number(c[`${k}_chars`]) > 0) maxChars = Math.min(maxChars, Number(c[`${k}_chars`]));
    if (c && Number(c[`${k}_parallel`]) > 0) parallel = Number(c[`${k}_parallel`]);
    // The natural voices on the AI server change speed themselves (cleaner than speeding up afterwards).
    if (o.engine === 'cloud' && c && c.voice_engine === 'kokoro') { eng = Object.assign({}, eng, { speed: true }); o = Object.assign({}, o, { nativeSpeed: true }); }
  }
  const chunks = splitText(o.text, maxChars);
  if (!chunks.length) throw new Error('There is no text to speak.');
  if (chunks.length > 1) o = Object.assign({}, o, { keepVoice: true });
  const parts = [];
  try {
    // Online engines generate several parts at once (much faster for long scripts); local engines run one at a time.
    let done = 0;
    ctx && ctx.progress && ctx.progress(2, chunks.length > 1 ? `Generating ${chunks.length} parts…` : 'Generating voice…');
    const made = await cloud.pool(chunks, parallel, async (chunk) => {
      ctx && ctx.check && ctx.check();
      const f = await fn(chunk, o, ctx);
      parts.push(f);
      done++;
      ctx && ctx.progress && ctx.progress((done / chunks.length) * 90, chunks.length > 1 ? `Generated part ${done}/${chunks.length}…` : 'Generating voice…');
      return f;
    });
    parts.length = 0;
    parts.push(...made);
    let joined = parts[0];
    if (parts.length > 1) {
      joined = P.tempFile('.wav');
      await media.concat(parts, joined, { gapMs: o.engine === 'kokoro' ? 120 : 60 });
    }
    // Engines without native speed get it in post.
    let finalSrc = joined;
    if (!eng.speed && o.speed && Math.abs(o.speed - 1) > 0.01) {
      finalSrc = P.tempFile('.wav');
      await media.speed(joined, finalSrc, o.speed);
    }
    const ext = path.extname(outFile).slice(1).toLowerCase() || 'mp3';
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    if (path.extname(finalSrc).slice(1) === ext) fs.copyFileSync(finalSrc, outFile);
    else await media.convertAudio(finalSrc, outFile, ext);
    ctx && ctx.progress && ctx.progress(100, 'Done');
    return { file: outFile, duration: await media.duration(outFile), chunks: chunks.length };
  } finally {
    for (const p of parts) { try { fs.unlinkSync(p); } catch (_) { /* ignore */ } }
  }
}

// ---------- built-in cloning, design and sound effects (through the AI gateway, no keys)
async function cloudClone({ name, description, files, removeNoise }, ctx) {
  const fd = new FormData();
  fd.append('name', name);
  if (description) fd.append('description', description);
  if (removeNoise) fd.append('remove_background_noise', 'true');
  for (const f of files) fd.append('files', new Blob([fs.readFileSync(f)], { type: f.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }), path.basename(f));
  ctx && ctx.progress(30, 'Cloning voice…');
  const j = await cloud.request('/v1/voices/clone', { method: 'POST', body: fd, signal: ctx && ctx.signal });
  return { voiceId: j.voice_id };
}

async function cloudDesign({ description, text }, ctx) {
  const j = await cloud.request('/v1/voices/design', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_description: description, text: text || '' }), signal: ctx && ctx.signal });
  const previews = (j.previews || []).map((p) => {
    const f = P.tempFile('.mp3');
    fs.writeFileSync(f, Buffer.from(p.audio_base_64 || '', 'base64'));
    return { generatedVoiceId: p.generated_voice_id, file: f, duration: p.duration_secs };
  });
  return { previews, text: j.text };
}

async function cloudSaveDesigned({ name, description, generatedVoiceId }) {
  const j = await cloud.request('/v1/voices/design/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, generated_voice_id: generatedVoiceId }) });
  return { voiceId: j.voice_id };
}

async function cloudDeleteVoice(id) {
  return cloud.request(`/v1/voices/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function cloudSfx({ prompt, seconds }, outFile, ctx) {
  const body = { text: prompt };
  if (seconds) body.duration_seconds = Math.max(0.5, Math.min(22, seconds));
  const buf = await cloud.request('/v1/sound-effects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx && ctx.signal }, 'buffer');
  fs.writeFileSync(outFile, buf);
  return outFile;
}

/** Cloning/design/SFX go through the built-in AI unless the vendor's advanced mode has an ElevenLabs key. */
function useOwnEleven() { return cloud.advanced() && Boolean(store.getSecret('elevenlabs')); }

// ---------- ElevenLabs cloning + design + sound effects (own key, advanced mode)
async function elevenClone({ name, description, files, removeNoise }, ctx) {
  const key = store.getSecret('elevenlabs');
  if (!key) throw new Error('Voice cloning uses ElevenLabs. Add your ElevenLabs API key in Settings → AI keys.');
  const fd = new FormData();
  fd.append('name', name);
  if (description) fd.append('description', description);
  if (removeNoise) fd.append('remove_background_noise', 'true');
  for (const f of files) fd.append('files', new Blob([fs.readFileSync(f)], { type: f.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }), path.basename(f));
  ctx && ctx.progress(30, 'Cloning voice…');
  const j = await net.json('https://api.elevenlabs.io/v1/voices/add', { method: 'POST', headers: { 'xi-api-key': key }, body: fd, signal: ctx && ctx.signal, label: 'ElevenLabs' });
  return { voiceId: j.voice_id };
}

async function elevenDesign({ description, text }, ctx) {
  const key = store.getSecret('elevenlabs');
  if (!key) throw new Error('Voice design uses ElevenLabs. Add your ElevenLabs API key in Settings → AI keys.');
  const body = { voice_description: description.slice(0, 1000) };
  if (text && text.length >= 100) body.text = text.slice(0, 1000); else body.auto_generate_text = true;
  let j;
  try {
    j = await net.json('https://api.elevenlabs.io/v1/text-to-voice/design', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ model_id: 'eleven_multilingual_ttv_v2' }, body)), signal: ctx && ctx.signal, label: 'ElevenLabs' });
  } catch (e) {
    if (e.status !== 404 && e.status !== 405) throw e;
    j = await net.json('https://api.elevenlabs.io/v1/text-to-voice/create-previews', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx && ctx.signal, label: 'ElevenLabs' });
  }
  const previews = (j.previews || []).map((p) => {
    const f = P.tempFile('.mp3');
    fs.writeFileSync(f, Buffer.from(p.audio_base_64, 'base64'));
    return { generatedVoiceId: p.generated_voice_id, file: f, duration: p.duration_secs };
  });
  return { previews, text: j.text };
}

async function elevenSaveDesigned({ name, description, generatedVoiceId }) {
  const key = store.getSecret('elevenlabs');
  const j = await net.json('https://api.elevenlabs.io/v1/text-to-voice', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_name: name, voice_description: description.slice(0, 1000), generated_voice_id: generatedVoiceId }), label: 'ElevenLabs' }).catch(async (e) => {
    if (e.status !== 404 && e.status !== 405) throw e;
    return net.json('https://api.elevenlabs.io/v1/text-to-voice/create-voice-from-preview', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_name: name, voice_description: description.slice(0, 1000), generated_voice_id: generatedVoiceId }), label: 'ElevenLabs' });
  });
  return { voiceId: j.voice_id };
}

async function elevenSfx({ prompt, seconds }, outFile, ctx) {
  const key = store.getSecret('elevenlabs');
  if (!key) throw new Error('AI sound effects use ElevenLabs. Add your ElevenLabs API key in Settings → AI keys.');
  const body = { text: prompt };
  if (seconds) body.duration_seconds = Math.max(0.5, Math.min(22, seconds));
  const buf = await net.buffer('https://api.elevenlabs.io/v1/sound-generation', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx && ctx.signal, label: 'ElevenLabs SFX' });
  fs.writeFileSync(outFile, buf);
  return outFile;
}

module.exports = { ENGINES, KOKORO_VOICES, OPENAI_VOICES, GEMINI_VOICES, CLOUD_VOICES, cloudClone, cloudDesign, cloudSaveDesigned, cloudDeleteVoice, cloudSfx, useOwnEleven, voices, synth, splitText, piperCatalog, ensurePiperVoice, elevenClone, elevenDesign, elevenSaveDesigned, elevenSfx, ttsSettings };
