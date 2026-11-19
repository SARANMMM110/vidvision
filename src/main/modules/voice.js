'use strict';
// Voice Engine: Quick TTS, Voice Clone, Voice Lab, Studio (multi-speaker), Audiobooks, Voice/Audio libraries.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('../paths');
const store = require('../store');
const media = require('../media');
const tts = require('../tts');
const llm = require('../llm');
const dl = require('../download');
const lib = require('../library');
const sounds = require('../sounds');
const translate = require('../translate');
const importers = require('../importers');
const data = require('../../shared/data');
const cloud = require('../cloud');
const localvoice = require('../localvoice');
const tr = require('../transcribe');

const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);

/** Resolve a voice spec (may reference a Voice Library entry). */
function resolveVoice(spec) {
  if (!spec) throw new Error('Choose a voice.');
  if (spec.libId) {
    const v = lib.voices.get(spec.libId);
    if (!v) throw new Error('A voice used here was removed from your Voice Library.');
    return { engine: v.engine, voice: v.voice, style: [v.style, spec.style].filter(Boolean).join(' '), speed: spec.speed || v.speed || 1, model: v.model, elevenSettings: v.elevenSettings };
  }
  return { engine: spec.engine, voice: spec.voice, style: spec.style || '', speed: spec.speed || 1, model: spec.model, elevenSettings: spec.elevenSettings };
}

async function engineInfo() {
  const keys = store.keyStatus();
  const s = tts.ttsSettings();
  const adv = cloud.advanced();
  const caps = cloud.enabled() ? (await cloud.caps()) || {} : {};
  return Object.entries(tts.ENGINES)
    .filter(([id, e]) => e.local || e.cloud || adv)
    .filter(([id]) => id !== 'myvoices' || caps.voices)
    .map(([id, e]) => {
      let ready = e.local || (id === 'custom' ? Boolean(s.customBaseUrl) : Boolean(keys[id]));
      if (id === 'cloud') ready = Boolean(cloud.enabled() && caps.tts !== false);
      if (id === 'myvoices') ready = Boolean(cloud.enabled() && caps.voices);
      // Natural voices on the AI server: 54 voices in 8 languages, real speed control, no style direction.
      const kokoro = id === 'cloud' && caps.voice_engine === 'kokoro' ? { label: 'Built-in voices (54 natural voices, 8 languages)', style: false, speed: true } : {};
      const clone = id === 'myvoices' && Array.isArray(caps.clone_languages) ? { languages: caps.clone_languages } : {};
      return Object.assign({ id }, e, kokoro, clone, { ready });
    });
}

async function voicesFor({ engine }) {
  const mine = lib.voices.list().filter((v) => v.engine === engine).map((v) => ({ id: v.voice, name: `★ ${v.name}`, lang: v.lang || 'multi', gender: v.gender, desc: v.description, libId: v.id }));
  let base = [];
  try { base = await tts.voices(engine); } catch (e) { if (!mine.length) throw e; }
  const have = new Set(mine.map((v) => v.id));
  return mine.concat(base.filter((v) => !have.has(v.id)));
}

// ---------------------------------------------------------------- quick tts
async function preview({ engine, voice, text, style, speed }, ctx) {
  const t = text || 'Hello! This is a preview of my voice. I can read your scripts, stories and videos.';
  const key = hash({ engine, voice, t, style, speed });
  const out = path.join(P.ensure(path.join(P.cache(), 'previews')), key + '.mp3');
  if (!fs.existsSync(out)) await tts.synth({ engine, voice, text: t, style, speed }, out, ctx);
  return { file: out };
}

async function quickTTS(o, ctx) {
  const spec = resolveVoice(o.voiceSpec || { engine: o.engine, voice: o.voice, style: o.style, speed: o.speed });
  const fmt = o.format || 'mp3';
  const raw = P.tempFile('.wav');
  const stage = (a, b) => ({ progress: (p, m) => ctx.progress(a + ((b - a) * (p || 0)) / 100, m), signal: ctx.signal, check: ctx.check });
  await tts.synth(Object.assign({ text: o.text }, spec), raw, stage(0, 80));
  let cur = raw;
  if (o.trim && (o.trim.start > 0 || o.trim.end > 0)) {
    const t = P.tempFile('.wav');
    await media.trim(cur, t, o.trim.start || 0, o.trim.end || 0);
    cur = t;
  }
  if (o.bed && (o.bed.file || o.bed.item)) {
    ctx.progress(85, 'Adding background music…');
    const bedFile = o.bed.file || await sounds.fetchAsset(o.bed.item, ctx);
    const m = P.tempFile('.wav');
    await media.mix(cur, m, { bed: bedFile, bedVolume: o.bed.volume === undefined ? 0.15 : o.bed.volume, duck: Boolean(o.bed.duck) });
    cur = m;
  }
  const out = P.tempFile('.' + fmt);
  await media.convertAudio(cur, out, fmt);
  const title = o.title || String(o.text).trim().split(/\s+/).slice(0, 8).join(' ');
  const item = await lib.addAudio(out, { title, engine: spec.engine, voice: spec.voice, text: String(o.text).slice(0, 2000), source: 'quick', tags: o.tags || [], credit: o.bed && o.bed.item ? o.bed.item.credit : '' });
  ctx.progress(100, 'Saved to Audio Library');
  return item;
}

async function trimAudio({ id, file, start, end, saveAsNew }, ctx) {
  const src = id ? (lib.audio.get(id) || {}).file : file;
  if (!src || !fs.existsSync(src)) throw new Error('Audio file not found.');
  const ext = path.extname(src);
  const out = P.tempFile(ext);
  await media.trim(src, out, start || 0, end || 0, ctx);
  if (id && !saveAsNew) {
    fs.copyFileSync(out, src);
    return lib.audio.update(id, { duration: await media.duration(src), size: fs.statSync(src).size });
  }
  const orig = id ? lib.audio.get(id) : {};
  return lib.addAudio(out, Object.assign({}, orig, { title: `${(orig && orig.title) || 'Clip'} (trimmed)`, id: undefined }));
}

async function writeScript({ prompt, words = 250, tone, lang, kind }, ctx) {
  ctx.progress(20, 'Writing script…');
  const r = await llm.chat({ purpose: 'text', system: `You write scripts meant to be read aloud by a text-to-speech voice: natural spoken language, short sentences, no stage directions, no markdown, no emojis.${lang ? ' Write in ' + translate.name(lang) + '.' : ''}`, messages: [{ role: 'user', content: `Write a ${kind || 'voiceover'} script of about ${words} words${tone ? ', tone: ' + tone : ''}.\nTopic / brief: ${prompt}` }], maxTokens: 4000, signal: ctx.signal });
  return { text: r.text.trim() };
}

async function translateScript({ text, lang }, ctx) { return { text: await translate.text(text, lang, { engine: 'ai' }, ctx) }; }

// ---------------------------------------------------------------- cloning
async function sourceFromUrl({ url, start = 0, seconds = 30 }, ctx) {
  const f = await dl.fetchMedia(url, { audioOnly: true, audioFormat: 'mp3', dir: P.ensure(path.join(P.cache(), 'clone-sources')) }, { progress: (p, m) => ctx.progress(p * 0.8, m), signal: ctx.signal, check: ctx.check });
  const out = P.tempFile('.mp3');
  await media.trim(f, out, start, start + seconds, ctx);
  return { file: out, full: f, duration: await media.duration(f) };
}

// ---------------------------------------------------------------- offline cloning + design (nothing leaves this PC)
async function prepareSample(file, start, end, maxLen = 15) {
  const d = await media.duration(file);
  const s = Math.max(0, start || 0);
  const e = Math.min(end && end > s ? end : d, s + maxLen);
  if (e - s < 3) throw new Error('The sample must be at least 3 seconds long.');
  const out = path.join(P.voiceLibrary(), `local_${Date.now().toString(36)}.wav`);
  await media.ffrun(['-ss', String(s), '-i', file, '-t', String(e - s), '-vn', '-ac', '1', '-ar', '24000', '-af', 'loudnorm=I=-20:TP=-2', '-c:a', 'pcm_s16le', out], {});
  return out;
}

/** Transcript of the sample (needed by the offline cloner). Built-in AI if available, otherwise Whisper on this PC. */
async function sampleText(file, lang, ctx) {
  const sub = { progress: (p, m) => ctx.progress(20 + (p || 0) * 0.5, m), signal: ctx.signal, check: ctx.check };
  const engines = store.getSettings().privateMode ? ['local'] : [store.getSettings().transcription.engine || 'cloud', 'local'];
  let last;
  for (const engine of [...new Set(engines)]) {
    try {
      const r = await tr.transcribe(file, { engine, language: lang && lang !== 'multi' ? lang.slice(0, 2) : 'auto', model: 'base' }, sub);
      if (r.text && r.text.trim()) return r.text.trim();
    } catch (e) { if (e.code === 'cancelled') throw e; last = e; }
  }
  throw last || new Error('Could not hear any words in the sample. Use 5–10 seconds of clear speech.');
}

async function cloneLocal({ name, description, file, start, end, refText, lang, gender, tags, source }, ctx) {
  ctx.progress(5, 'Preparing the sample…');
  const keep = await prepareSample(file, start, end);
  const text = refText || await sampleText(keep, lang, ctx);
  ctx.progress(75, 'Creating your offline voice…');
  const id = 'lc_' + crypto.randomUUID().slice(0, 10);
  // first render downloads the cloning engine and proves the voice works
  const test = await localvoice.cloneSpeak('This is my new voice.', { sample: keep, refText: text }, { ctx: { progress: (p, m) => ctx.progress(75 + (p || 0) * 0.2, m), signal: ctx.signal } });
  try { fs.unlinkSync(test); } catch (_) { /* ignore */ }
  ctx.progress(100, 'Voice ready');
  return lib.voices.add({ name: name || 'My voice', engine: 'localclone', voice: id, sample: keep, refText: text, lang: lang || (/[\u3400-\u9fff]/.test(text) ? 'zh' : 'en'), gender, description: description || 'Offline voice', source: source || 'clone', tags: tags || ['clone', 'offline'], offline: true });
}

const DESIGN_TEXT = 'Here is a short sample of my voice. I can read your scripts, stories and videos with a clear, natural delivery.';
const ACCENT_PREFIX = { American: 'a', Canadian: 'a', Nigerian: 'a', Jamaican: 'a', British: 'b', Australian: 'b', Irish: 'b', Scottish: 'b', 'South African': 'b', Indian: 'h', Spanish: 'e', French: 'f', Italian: 'i', Brazilian: 'p', Japanese: 'j', Chinese: 'z' };

function designChipsFromText(t) {
  const s = String(t || '').toLowerCase();
  const pick = (map, def) => { for (const [k, v] of map) if (s.includes(k)) return v; return def; };
  return {
    gender: pick([['female', 'female'], ['woman', 'female'], ['girl', 'female'], ['male', 'male'], ['man', 'male'], ['boy', 'male']], 'female'),
    age: pick([['old', 'senior'], ['senior', 'senior'], ['elderly', 'senior'], ['middle', 'middle-aged'], ['young', 'young'], ['teen', 'young']], 'adult'),
    pitch: pick([['deep', 'low'], ['low', 'low'], ['high', 'high'], ['squeak', 'high']], 'medium'),
    accent: pick(Object.keys(ACCENT_PREFIX).map((k) => [k.toLowerCase(), k]), 'American'),
    tone: pick([['warm', 'warm'], ['bright', 'bright'], ['deep', 'deep'], ['rasp', 'raspy'], ['gravel', 'raspy'], ['soft', 'soft'], ['gentle', 'soft'], ['author', 'authoritative'], ['playful', 'playful']], 'warm'),
    pace: pick([['slow', 'slow'], ['fast', 'fast'], ['quick', 'fast']], 'natural'),
  };
}

/**
 * Offline voice design: picks the closest Kokoro voices for the chips, shapes pitch and tone on this PC,
 * and returns three previews. Saving one turns it into an offline voice (cloned locally from the preview).
 */
async function designLocal({ chips, description }, ctx) {
  let c = chips;
  if (!c && description) {
    try {
      const r = await llm.chatJSON({ purpose: 'text', system: 'Map a voice description to fixed attributes.', messages: [{ role: 'user', content: `Description: ${description}\nReturn JSON {"gender":"female|male","age":"young|adult|middle-aged|senior","pitch":"low|medium|high","accent":"${Object.keys(ACCENT_PREFIX).join('|')}","tone":"warm|bright|deep|raspy|soft|authoritative|playful","pace":"slow|natural|fast"}` }], maxTokens: 300, signal: ctx.signal });
      c = r.data;
    } catch (_) { c = null; }
    if (!c || !c.gender) c = designChipsFromText(description);
  }
  c = Object.assign({ gender: 'female', age: 'adult', pitch: 'medium', accent: 'American', tone: 'warm', pace: 'natural' }, c || {});
  const prefix = ACCENT_PREFIX[c.accent] || 'a';
  const g = c.gender === 'male' ? 'm' : 'f';
  let cands = localvoice.KOKORO_VOICES.filter((v) => v.id[0] === prefix && v.id[1] === g);
  if (cands.length < 3) cands = cands.concat(localvoice.KOKORO_VOICES.filter((v) => (v.id[0] === 'a' || v.id[0] === 'b') && v.id[1] === g && !cands.includes(v)));
  cands = cands.slice(0, 3);
  let st = { low: -2, medium: 0, high: 2.5 }[c.pitch] || 0;
  st += { young: 1, adult: 0, 'middle-aged': -0.7, senior: -1.5 }[c.age] || 0;
  if (c.tone === 'deep') st -= 1.5;
  const eq = { warm: 'bass=g=3:f=180,treble=g=-1', bright: 'treble=g=4:f=4500', deep: 'bass=g=4:f=140', raspy: 'treble=g=2,acrusher=bits=12:mix=0.15', soft: 'volume=-3dB,treble=g=-3', authoritative: 'bass=g=2,acompressor=threshold=-18dB:ratio=3', playful: 'treble=g=2' }[c.tone] || 'anull';
  const pace = { slow: 0.9, natural: 1, fast: 1.12 }[c.pace] || 1;
  const previews = [];
  for (let i = 0; i < cands.length; i++) {
    ctx.check();
    ctx.progress(10 + (i / cands.length) * 85, `Designing option ${i + 1} of ${cands.length}…`);
    const raw = await localvoice.kokoro(DESIGN_TEXT, cands[i].id, { speed: pace * (c.age === 'senior' ? 0.95 : 1), ctx: { progress: () => {}, signal: ctx.signal } });
    const shift = st + (i - 1) * 0.6; // small spread so the three options differ
    const r = Math.pow(2, shift / 12);
    const out = P.tempFile('.wav');
    await media.ffrun(['-i', raw, '-af', `asetrate=${Math.round(24000 * r)},aresample=24000,atempo=${(1 / r).toFixed(4)},${eq}`, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', out], {});
    try { fs.unlinkSync(raw); } catch (_) { /* ignore */ }
    previews.push({ file: out, base: cands[i].id, offline: true, refText: DESIGN_TEXT, label: `${cands[i].name} · ${shift >= 0 ? '+' : ''}${shift.toFixed(1)} semitones` });
  }
  ctx.progress(100, 'Done');
  return { previews, chips: c, offline: true };
}

async function saveLocalDesign({ name, description, file, refText, gender, chips }, ctx) {
  if (!file || !fs.existsSync(file)) throw new Error('Design the voice again — the preview has expired.');
  return cloneLocal({ name: name || 'Designed voice', description: description || '', file, refText: refText || DESIGN_TEXT, gender: gender || (chips && chips.gender), lang: 'en', tags: ['designed', 'offline'], source: 'design' }, ctx);
}

async function clone({ name, description, file, start, end, removeNoise, lang, gender, tags, where }, ctx) {
  if (!file || !fs.existsSync(file)) throw new Error('Choose or record a voice sample first.');
  if (where === 'local' || (where !== 'cloud' && store.getSettings().privateMode)) return cloneLocal({ name, description, file, start, end, lang, gender, tags }, ctx);
  const d = await media.duration(file);
  let sample = file;
  if ((start || 0) > 0 || (end && end < d)) { sample = P.tempFile('.mp3'); await media.trim(file, sample, start || 0, end || d); }
  const len = await media.duration(sample);
  if (len < 3) throw new Error('The sample must be at least 3 seconds long.');
  const keep = path.join(P.voiceLibrary(), `sample_${Date.now().toString(36)}${path.extname(sample)}`);
  fs.copyFileSync(sample, keep);
  const own = tts.useOwnEleven();
  const r = own ? await tts.elevenClone({ name, description, files: [keep], removeNoise }, ctx) : await tts.cloudClone({ name, description, files: [keep], removeNoise }, ctx);
  return lib.voices.add({ name: name || 'My voice', engine: own ? 'elevenlabs' : 'myvoices', voice: r.voiceId, lang: lang || 'multi', gender, description: description || 'Cloned voice', source: 'clone', sample: keep, tags: tags || ['clone'] });
}

// ---------------------------------------------------------------- voice lab
async function design({ description, text }, ctx) {
  return tts.useOwnEleven() ? tts.elevenDesign({ description, text }, ctx) : tts.cloudDesign({ description, text }, ctx);
}

async function saveDesigned({ name, description, generatedVoiceId, previewFile, gender, lang }) {
  const own = tts.useOwnEleven();
  const r = own ? await tts.elevenSaveDesigned({ name, description, generatedVoiceId }) : await tts.cloudSaveDesigned({ name, description, generatedVoiceId });
  let sample = '';
  if (previewFile && fs.existsSync(previewFile)) { sample = path.join(P.voiceLibrary(), `design_${Date.now().toString(36)}.mp3`); fs.copyFileSync(previewFile, sample); }
  return lib.voices.add({ name, engine: own ? 'elevenlabs' : 'myvoices', voice: r.voiceId, lang: lang || 'multi', gender, description, source: 'design', sample, tags: ['designed'] });
}

/** Prompted voice for engines that take style instructions (OpenAI, Gemini, custom). */
async function promptedVoice({ description, engine = 'cloud' }, ctx) {
  const list = engine === 'gemini' ? tts.GEMINI_VOICES : engine === 'cloud' ? await tts.voices('cloud') : tts.OPENAI_VOICES;
  ctx.progress(30, 'Designing voice…');
  const r = await llm.chatJSON({ purpose: 'text', system: 'You are a voice director. Pick the base voice that best matches the description and write delivery instructions (accent, age, pitch, pace, emotion, character) for a steerable TTS model.', messages: [{ role: 'user', content: `Available base voices: ${list.map((v) => `${v.id} (${v.gender || ''}${v.desc ? ', ' + v.desc : ''})`).join('; ')}\nDescription: ${description}\nReturn JSON {"voice":"<id>","name":"short catchy voice name","instructions":"…≤600 chars","gender":"male|female|neutral"}` }], maxTokens: 800, signal: ctx.signal });
  const d = r.data || {};
  if (!list.find((v) => v.id === d.voice)) d.voice = list[0].id;
  return { engine, voice: d.voice, name: d.name || 'Designed voice', style: d.instructions || description, gender: d.gender };
}

async function analyzeAudio({ file, url }, ctx) {
  let f = file;
  if (!f && url) f = (await sourceFromUrl({ url, start: 0, seconds: 30 }, ctx)).file;
  if (!f || !fs.existsSync(f)) throw new Error('Choose an audio/video file or paste a link.');
  const clip = P.tempFile('.mp3');
  await media.toMp3(f, clip, { bitrate: '64k', start: 0, end: 30 });
  ctx.progress(60, 'Listening…');
  const own = cloud.advanced() && llm.ready('gemini');
  const sel = own ? { provider: 'gemini', model: store.getSettings().ai.models.gemini || 'gemini-2.5-flash' } : { provider: 'builtin', model: 'standard' };
  const r = await llm.chat({ provider: sel.provider, model: sel.model, system: 'You are a voice casting director. Describe the speaking voice precisely so a voice designer can create an ORIGINAL voice with similar qualities (do not identify the person).', messages: [{ role: 'user', content: 'Describe this voice: gender, approximate age, accent, pitch, timbre, pace, energy, emotion, delivery style, recording quality. One paragraph of 60–120 words.', audio: [{ mime: 'audio/mpeg', data: fs.readFileSync(clip).toString('base64') }] }], maxTokens: 600, signal: ctx.signal });
  return { description: r.text.trim() };
}

// ---------------------------------------------------------------- studio
function studioFile(id) { return path.join(P.studioProjects(), `${id}.json`); }
function studioDir(id) { return P.ensure(path.join(P.studioProjects(), id)); }

function studioList() {
  return fs.readdirSync(P.studioProjects()).filter((f) => f.endsWith('.json')).map((f) => {
    const j = store.readJson(path.join(P.studioProjects(), f), null);
    return j ? { id: j.id, title: j.title, lines: (j.lines || []).length, speakers: (j.speakers || []).length, updated: j.updated || j.created, output: j.output || '' } : null;
  }).filter(Boolean).sort((a, b) => b.updated - a.updated);
}
function studioGet({ id }) { const j = store.readJson(studioFile(id), null); if (!j) throw new Error('Studio project not found.'); return j; }
function studioSave({ project }) {
  const p = Object.assign({ id: crypto.randomUUID().slice(0, 8), created: Date.now(), speakers: [], lines: [], music: null, sfx: [], gapMs: 300 }, project, { updated: Date.now() });
  store.writeJsonAtomic(studioFile(p.id), p);
  return p;
}
function studioDelete({ id }) { try { fs.unlinkSync(studioFile(id)); } catch (_) { /* ignore */ } fs.rmSync(path.join(P.studioProjects(), id), { recursive: true, force: true }); return studioList(); }

async function studioWrite({ prompt, format, speakers = 2, minutes = 2, lang, names }, ctx) {
  const f = data.STUDIO_FORMATS.find((x) => x[0] === format);
  ctx.progress(15, 'Writing the script and casting speakers…');
  const r = await llm.chatJSON({ purpose: 'text', system: `You write multi-speaker audio scripts for text-to-speech production. Natural spoken dialogue, no stage directions inside lines (put delivery notes in "style").${lang ? ' Write the dialogue in ' + translate.name(lang) + '.' : ''}`, messages: [{ role: 'user', content: `Format: ${f ? f[1] : format || 'conversation'}. Speakers: ${speakers}${names ? ' named ' + names : ''}. Length: about ${minutes} minute(s) (~${Math.round(minutes * 150)} words).\nBrief: ${prompt}\nReturn JSON {"title":"…","speakers":[{"name":"…","description":"voice/character description: gender, age, personality"}],"lines":[{"speaker":"<name>","text":"…","style":"short delivery note"}]}` }], maxTokens: 9000, signal: ctx.signal });
  const d = r.data || {};
  const sp = (d.speakers || []).map((s) => ({ id: crypto.randomUUID().slice(0, 6), name: String(s.name || 'Speaker'), description: String(s.description || ''), voice: null }));
  const byName = (n) => (sp.find((s) => s.name.toLowerCase() === String(n || '').toLowerCase()) || sp[0] || {}).id;
  const lines = (d.lines || []).map((l) => ({ id: crypto.randomUUID().slice(0, 6), speaker: byName(l.speaker), text: String(l.text || '').trim(), style: String(l.style || '') })).filter((l) => l.text);
  return { title: d.title || 'Untitled production', speakers: sp, lines };
}

async function studioCast({ project, engines }, ctx) {
  const pool = [];
  const add = async (list) => {
    for (const e of list) {
      try { (await voicesFor({ engine: e })).slice(0, 60).forEach((v) => pool.push({ engine: e, voice: v.id, name: v.name, gender: v.gender || '', lang: v.lang || '', desc: v.desc || '', libId: v.libId })); } catch (_) { /* engine unavailable */ }
    }
  };
  const ready = (await engineInfo()).filter((e) => e.ready).map((e) => e.id);
  if (engines && engines.length) await add(engines);
  else await add(cloud.advanced() ? ready.filter((e) => e !== 'piper') : ready.filter((e) => e === 'cloud' || e === 'myvoices'));
  if (!pool.length && !(engines && engines.length)) await add(['kokoro']);
  if (!pool.length) throw new Error('No voices are available right now. Check your internet connection, or use the free offline Kokoro voices.');
  ctx.progress(40, 'Casting voices…');
  const r = await llm.chatJSON({ purpose: 'text', system: 'You are a casting director. Give every speaker a DIFFERENT voice that fits their description.', messages: [{ role: 'user', content: `Speakers:\n${project.speakers.map((s) => `- ${s.id}: ${s.name} — ${s.description}`).join('\n')}\nAvailable voices (index: engine/voice — name, gender, lang, notes):\n${pool.map((v, i) => `${i}: ${v.engine}/${v.voice} — ${v.name}, ${v.gender}, ${v.lang} ${v.desc}`).join('\n')}\nReturn JSON {"cast":[{"speaker":"<speaker id>","index":<voice index>}]}` }], maxTokens: 1500, signal: ctx.signal });
  const cast = (r.data && r.data.cast) || [];
  const speakers = project.speakers.map((s, i) => {
    const c = cast.find((x) => x.speaker === s.id);
    const v = pool[c ? Number(c.index) : i % pool.length] || pool[0];
    return Object.assign({}, s, { voice: { engine: v.engine, voice: v.voice, name: v.name, libId: v.libId } });
  });
  return { speakers };
}

async function studioStyleAll({ project }, ctx) {
  ctx.progress(20, 'Directing every line…');
  const names = Object.fromEntries(project.speakers.map((s) => [s.id, s.name]));
  const r = await llm.chatJSON({ purpose: 'text', system: 'You are a voice director. For each line write a short delivery note (emotion, pace, emphasis) for a steerable TTS voice.', messages: [{ role: 'user', content: `Lines:\n${project.lines.map((l, i) => `${i}. ${names[l.speaker] || 'Speaker'}: ${l.text}`).join('\n')}\nReturn JSON {"styles":["…one per line, same order…"]}` }], maxTokens: 4000, signal: ctx.signal });
  const st = (r.data && r.data.styles) || [];
  return { lines: project.lines.map((l, i) => Object.assign({}, l, { style: st[i] || l.style })) };
}

/** Best voice for a language, keeping engine + gender where possible (Studio "translate all"). */
async function voiceForLang(cur, lang, gender) {
  const code = String(lang || '').slice(0, 2).toLowerCase();
  const nllb = { spa: 'es', fra: 'fr', ita: 'it', por: 'pt', hin: 'hi', jpn: 'ja', zho: 'zh', eng: 'en', deu: 'de', nld: 'nl', rus: 'ru', pol: 'pl', tur: 'tr', ukr: 'uk', arb: 'ar', kor: 'ko', vie: 'vi' }[String(lang || '').slice(0, 3)] || code;
  // Built-in voices from the AI server: pick one made for this language (natural voices), else an any-language one.
  if (cur && cur.engine === 'cloud') {
    const list = await tts.voices('cloud').catch(() => []);
    const native = list.filter((v) => v.lang && v.lang !== 'multi' && v.lang.slice(0, 2).toLowerCase() === nllb);
    const anyLang = list.filter((v) => v.lang === 'multi');
    if (native.length) { const v = native.find((x) => x.gender === gender) || native[0]; return { engine: 'cloud', voice: v.id, name: v.name }; }
    if (!list.length || list.every((v) => v.lang === 'multi')) return cur; // the server's voices speak every language
    if (anyLang.length) { const v = anyLang.find((x) => x.gender === gender) || anyLang[0]; return { engine: 'cloud', voice: v.id, name: v.name }; }
  }
  const multi = (e) => ['myvoices', 'openai', 'gemini', 'elevenlabs'].includes(e);
  if (cur && multi(cur.engine)) return cur; // these voices speak every language
  const kok = localvoice.KOKORO_VOICES.filter((v) => v.lang.slice(0, 2) === nllb);
  if (kok.length) { const v = kok.find((x) => x.gender === gender) || kok[0]; return { engine: 'kokoro', voice: v.id, name: v.name }; }
  try {
    const pv = (await tts.piperCatalog()).filter((v) => String(v.lang).slice(0, 2) === nllb);
    if (pv.length) return { engine: 'piper', voice: pv[0].id, name: pv[0].name };
  } catch (_) { /* offline */ }
  if (cloud.enabled()) {
    const list = (await tts.voices('cloud').catch(() => [])).filter((v) => v.lang === 'multi');
    if (list.length) { const v = list.find((x) => x.gender === gender) || list[0]; return { engine: 'cloud', voice: v.id, name: v.name }; }
  }
  return cur;
}

async function studioTranslate({ project, lang, recast = true }, ctx) {
  const out = await translate.translateLines(project.lines.map((l) => l.text), lang, { engine: 'ai' }, ctx);
  const lines = project.lines.map((l, i) => Object.assign({}, l, { text: out[i] || l.text }));
  if (!recast) return { lines };
  const speakers = [];
  for (const sp of project.speakers || []) {
    const cur = sp.voice ? resolveVoiceSafe(sp.voice) : null;
    const g = sp.voice && sp.voice.gender ? sp.voice.gender : (/\b(she|her|woman|female|girl)\b/i.test(sp.description || '') ? 'female' : 'male');
    const nv = await voiceForLang(cur, lang, g);
    speakers.push(Object.assign({}, sp, { voice: nv ? Object.assign({}, sp.voice || {}, nv, { libId: nv === cur ? (sp.voice && sp.voice.libId) : '' }) : sp.voice }));
  }
  return { lines, speakers };
}

function resolveVoiceSafe(spec) { try { return resolveVoice(spec); } catch (_) { return null; } }

/** AI rewrites the delivery note of one Studio line. */
async function studioRestyle({ project, lineId, direction }, ctx) {
  const i = project.lines.findIndex((l) => l.id === lineId);
  if (i < 0) throw new Error('Line not found.');
  const ctxLines = project.lines.slice(Math.max(0, i - 2), i + 3).map((l) => (l.id === lineId ? '>> ' : '   ') + l.text).join('\n');
  const r = await llm.chatJSON({ purpose: 'text', system: 'You are a voice director. Write one short delivery note (emotion, pace, emphasis, ≤ 20 words) for the marked line.', messages: [{ role: 'user', content: `Scene:\n${ctxLines}\nCurrent note: ${project.lines[i].style || 'none'}${direction ? '\nDirector wants: ' + direction : '\nGive a fresh, different take.'}\nReturn JSON {"style":"…"}` }], maxTokens: 200, signal: ctx.signal });
  return { style: String((r.data && r.data.style) || project.lines[i].style || '').slice(0, 300) };
}

// ---------------------------------------------------------------- voice style tools (Quick TTS, Studio)
async function styleEnhance({ style, text }, ctx) {
  const r = await llm.chatJSON({ purpose: 'text', system: 'You improve delivery directions for steerable text-to-speech voices. Keep the intent, make it specific: emotion, energy, pace, pitch, emphasis, accent if mentioned. Max 60 words.', messages: [{ role: 'user', content: `Direction: ${style || 'natural'}${text ? '\nScript start: ' + String(text).slice(0, 600) : ''}\nReturn JSON {"style":"…"}` }], maxTokens: 300, signal: ctx.signal });
  return { style: String((r.data && r.data.style) || style || '').slice(0, 600) };
}
async function styleAuto({ text }, ctx) {
  if (!String(text || '').trim()) throw new Error('Write or paste the script first.');
  const r = await llm.chatJSON({ purpose: 'text', system: 'You are a voice director. Read the script and write the best delivery direction for a steerable TTS voice (emotion, energy, pace, pitch, emphasis). Max 50 words.', messages: [{ role: 'user', content: `Script:\n${String(text).slice(0, 3000)}\nReturn JSON {"name":"2–3 word style name","style":"…"}` }], maxTokens: 300, signal: ctx.signal });
  return { name: (r.data && r.data.name) || 'Auto', style: String((r.data && r.data.style) || '').slice(0, 600) };
}
async function styleWrite({ idea }, ctx) {
  const r = await llm.chatJSON({ purpose: 'text', system: 'You write delivery directions for steerable TTS voices from a short idea. Specific and vivid: emotion, energy, pace, pitch, emphasis, character. Max 50 words.', messages: [{ role: 'user', content: `Idea: ${idea || 'friendly explainer'}\nReturn JSON {"name":"2–3 word style name","style":"…"}` }], maxTokens: 300, signal: ctx.signal });
  return { name: (r.data && r.data.name) || String(idea || 'Custom').slice(0, 30), style: String((r.data && r.data.style) || '').slice(0, 600) };
}
const styleList = () => lib.styles.list();
const styleSave = ({ name, style }) => { if (!String(style || '').trim()) throw new Error('The style is empty.'); lib.styles.add({ name: String(name || 'My style').slice(0, 60), style: String(style).slice(0, 1000) }); return lib.styles.list(); };
const styleDelete = ({ id }) => { lib.styles.remove(id); return lib.styles.list(); };

// ---------------------------------------------------------------- Voice Lab description writer + favourites
async function describeWrite({ idea }, ctx) {
  const r = await llm.chatJSON({ purpose: 'text', system: 'You are a voice casting writer. Turn a short idea into a precise voice description for a voice designer: gender, age, accent, pitch, timbre, pace, energy, emotion, character, recording quality. 50–110 words. Original voice only — never name or imitate a real person.', messages: [{ role: 'user', content: `Idea: ${idea || 'a friendly narrator'}\nReturn JSON {"name":"short catchy voice name","description":"…"}` }], maxTokens: 500, signal: ctx.signal });
  return { name: (r.data && r.data.name) || 'New voice', description: String((r.data && r.data.description) || '').slice(0, 4000) };
}
const descriptionList = () => lib.descriptions.list();
const descriptionSave = ({ name, description }) => { if (String(description || '').trim().length < 10) throw new Error('Write a longer description first.'); lib.descriptions.add({ name: String(name || 'Voice idea').slice(0, 60), description: String(description).slice(0, 4000) }); return lib.descriptions.list(); };
const descriptionDelete = ({ id }) => { lib.descriptions.remove(id); return lib.descriptions.list(); };

// ---------------------------------------------------------------- audio tools
/** Remove the part between start and end (the waveform editor's "Cut"). */
async function cutAudio({ id, file, start, end, saveAsNew }, ctx) {
  const src = id ? (lib.audio.get(id) || {}).file : file;
  if (!src || !fs.existsSync(src)) throw new Error('Audio file not found.');
  const d = await media.duration(src);
  const a = Math.max(0, Math.min(start || 0, d));
  const b = Math.max(a, Math.min(end || 0, d));
  if (b - a < 0.05) throw new Error('Select the part you want to cut.');
  if (a < 0.02 && b > d - 0.02) throw new Error('That would cut the whole clip.');
  const ext = path.extname(src);
  const out = P.tempFile(ext);
  const fmt = media.AUDIO_FORMATS[ext.slice(1).toLowerCase()] || media.AUDIO_FORMATS.mp3;
  await media.ffrun(['-i', src, '-filter_complex', `[0:a]atrim=0:${a.toFixed(3)},asetpts=PTS-STARTPTS[x];[0:a]atrim=start=${b.toFixed(3)},asetpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=0:a=1[out]`, '-map', '[out]'].concat(fmt, [out]), { ctx });
  if (id && !saveAsNew) {
    fs.copyFileSync(out, src);
    return lib.audio.update(id, { duration: await media.duration(src), size: fs.statSync(src).size });
  }
  const orig = id ? lib.audio.get(id) : {};
  return lib.addAudio(out, Object.assign({}, orig, { title: `${(orig && orig.title) || 'Clip'} (edited)`, id: undefined }));
}

/** Transcribe an Audio Library item (Voice Engine includes transcription). */
async function audioTranscribe({ id }, ctx) {
  const it = lib.audio.get(id);
  if (!it || !fs.existsSync(it.file)) throw new Error('Audio file not found.');
  const r = await tr.transcribe(it.file, {}, ctx);
  return lib.audio.update(id, { transcript: r.text, transcriptSegments: r.segments, transcriptLang: r.language });
}

async function studioImport({ file, mode = 'auto' }, ctx) {
  const r = await importers.read(file);
  const sp = { id: crypto.randomUUID().slice(0, 6), name: 'Narrator', description: 'Narrator', voice: null };
  if (r.segments && r.segments.length) {
    return { title: r.name, speakers: [sp], lines: r.segments.map((s) => ({ id: crypto.randomUUID().slice(0, 6), speaker: sp.id, text: s.text, style: '', at: s.start })) };
  }
  if (mode === 'single') {
    const paras = r.text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
    return { title: r.name, speakers: [sp], lines: paras.map((t) => ({ id: crypto.randomUUID().slice(0, 6), speaker: sp.id, text: t, style: '' })) };
  }
  // Script-style "Name: text" lines?
  const scriptLines = r.text.split('\n').map((l) => /^\s*([A-Z][\w .'-]{0,30}):\s+(.+)$/.exec(l)).filter(Boolean);
  if (scriptLines.length >= 3) {
    const map = new Map();
    const lines = scriptLines.map((m) => {
      if (!map.has(m[1])) map.set(m[1], { id: crypto.randomUUID().slice(0, 6), name: m[1].trim(), description: '', voice: null });
      return { id: crypto.randomUUID().slice(0, 6), speaker: map.get(m[1]).id, text: m[2].trim(), style: '' };
    });
    return { title: r.name, speakers: [...map.values()], lines };
  }
  ctx.progress(30, 'Turning the document into a multi-speaker script…');
  return studioWrite({ prompt: `Adapt this document faithfully into a multi-speaker audio script (keep its content):\n\n${r.text.slice(0, 30000)}`, format: 'conversation', speakers: 2, minutes: Math.max(1, Math.round(r.text.split(/\s+/).length / 150)) }, ctx);
}

function lineSpec(project, line) {
  const sp = project.speakers.find((s) => s.id === line.speaker);
  if (!sp || !sp.voice) throw new Error(`Give ${sp ? sp.name : 'every speaker'} a voice first.`);
  const v = resolveVoice(sp.voice);
  if (line.style) v.style = [v.style, line.style].filter(Boolean).join('. ');
  return v;
}

async function renderLine(project, line, ctx) {
  const spec = lineSpec(project, line);
  const key = hash({ spec, text: line.text });
  const out = path.join(studioDir(project.id), 'lines', `${line.id}_${key}.wav`);
  if (!fs.existsSync(out)) {
    P.ensure(path.dirname(out));
    await tts.synth(Object.assign({ text: line.text }, spec), out, ctx);
  }
  return out;
}

async function studioRenderLine({ project, lineId }, ctx) {
  const line = project.lines.find((l) => l.id === lineId);
  if (!line) throw new Error('Line not found.');
  studioSave({ project });
  return { file: await renderLine(project, line, ctx) };
}

async function studioRender({ project, format = 'mp3', normalize = true }, ctx) {
  const saved = studioSave({ project });
  const files = [];
  const lines = saved.lines.filter((l) => l.text.trim());
  if (!lines.length) throw new Error('Add some lines first.');
  // Generate (2 at a time for cloud engines).
  let done = 0;
  const results = new Array(lines.length);
  let i = 0;
  const worker = async () => {
    while (i < lines.length) {
      const k = i++;
      ctx.check();
      const sub = { progress: () => {}, signal: ctx.signal, check: ctx.check };
      results[k] = await renderLine(saved, lines[k], sub);
      done++;
      ctx.progress((done / lines.length) * 75, `Voicing line ${done}/${lines.length}`);
    }
  };
  await Promise.all([worker(), worker()]);
  // Loudness-match each speaker.
  for (let k = 0; k < results.length; k++) {
    if (normalize) {
      const n = results[k].replace(/\.wav$/, '_n.wav');
      if (!fs.existsSync(n)) await media.normalize(results[k], n, -18);
      files.push(n);
    } else files.push(results[k]);
    ctx.progress(75 + (k / results.length) * 10, 'Matching speaker volumes…');
  }
  ctx.progress(86, 'Stitching…');
  const gaps = lines.map((l) => (l.gapAfter != null ? Number(l.gapAfter) : saved.gapMs || 300));
  const joined = P.tempFile('.wav');
  await media.concat(files, joined, { gapMs: gaps });
  let final = joined;
  const sfx = [];
  if (saved.sfx && saved.sfx.length) {
    // Place each effect at the start of its line.
    let t = 0;
    const starts = [];
    for (let k = 0; k < files.length; k++) { starts.push(t); t += (await media.duration(files[k])) + (gaps[k] || 0) / 1000; }
    for (const s of saved.sfx) {
      const idx = lines.findIndex((l) => l.id === s.lineId);
      const f = s.file || (s.item ? await sounds.fetchAsset(s.item, ctx) : '');
      if (f && idx >= 0) sfx.push({ file: f, at: starts[idx] + (s.offset || 0), volume: s.volume });
    }
  }
  if ((saved.music && (saved.music.file || saved.music.item)) || sfx.length) {
    ctx.progress(92, 'Mixing music and effects…');
    const bed = saved.music ? (saved.music.file || await sounds.fetchAsset(saved.music.item, ctx)) : '';
    const m = P.tempFile('.wav');
    await media.mix(joined, m, { bed, bedVolume: saved.music ? saved.music.volume : 0.12, duck: saved.music ? saved.music.duck !== false : false, sfx });
    final = m;
  }
  const out = P.tempFile('.' + format);
  await media.convertAudio(final, out, format);
  const item = await lib.addAudio(out, { title: saved.title || 'Studio production', source: 'studio', engine: 'multi', text: lines.map((l) => l.text).join(' ').slice(0, 2000), tags: ['studio'] });
  saved.output = item.file;
  store.writeJsonAtomic(studioFile(saved.id), saved);
  return { item, project: saved };
}

// ---------------------------------------------------------------- audiobooks
function bookDir(id) { return P.ensure(path.join(P.audiobooks(), id)); }
function bookFile(id) { return path.join(bookDir(id), 'book.json'); }
function bookList() {
  return fs.readdirSync(P.audiobooks()).map((d) => {
    const b = store.readJson(path.join(P.audiobooks(), d, 'book.json'), null);
    return b ? { id: b.id, title: b.title, chapters: b.chapters.length, mode: b.mode, updated: b.updated || b.created, output: b.output || '' } : null;
  }).filter(Boolean).sort((a, b) => b.updated - a.updated);
}
function bookGet({ id }) { const b = store.readJson(bookFile(id), null); if (!b) throw new Error('Audiobook not found.'); return b; }
function bookSave({ book }) {
  const b = Object.assign({}, book, { updated: Date.now(), chapters: (book.chapters || []).map((c) => { const x = Object.assign({}, c); delete x._single; return x; }) });
  store.writeJsonAtomic(bookFile(b.id), b);
  return b;
}
function bookDelete({ id }) { fs.rmSync(path.join(P.audiobooks(), id), { recursive: true, force: true }); return bookList(); }

async function bookImport({ file, title, author }, ctx) {
  ctx.progress(20, 'Reading manuscript…');
  const r = await importers.read(file);
  const text = r.segments ? r.segments.map((s) => s.text).join('\n') : r.text;
  const chapters = importers.chapters(text).map((c) => ({ id: crypto.randomUUID().slice(0, 6), title: c.title, text: c.text, segments: [], status: 'draft' }));
  const id = crypto.randomUUID().slice(0, 8);
  const book = { id, title: title || r.name, author: author || '', mode: 'single', narrator: null, characters: [], chapters, created: Date.now(), source: file };
  return bookSave({ book });
}

function splitNarration(text) {
  return text.split(/\n{2,}/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

async function bookAnalyze({ id, chapterIds }, ctx) {
  const book = bookGet({ id });
  const chars = new Map((book.characters || []).map((c) => [c.name.toLowerCase(), c]));
  const targets = book.chapters.filter((c) => !chapterIds || chapterIds.includes(c.id));
  for (let ci = 0; ci < targets.length; ci++) {
    const ch = targets[ci];
    ctx.progress((ci / targets.length) * 100, `Finding speakers in "${ch.title}"…`);
    const paras = splitNarration(ch.text);
    const segs = [];
    // Work in windows of ~5000 characters.
    let win = [];
    const flush = async () => {
      if (!win.length) return;
      const r = await llm.chatJSON({ purpose: 'text', system: 'You prepare manuscripts for full-cast audiobook recording. Split text into segments: narration vs. spoken dialogue, attributing each quote to the character who speaks it. Keep EVERY word of the original in order.', messages: [{ role: 'user', content: `Known characters: ${[...chars.values()].map((c) => c.name).join(', ') || 'none yet'}.\nText:\n${win.join('\n\n')}\nReturn JSON {"characters":[{"name":"…","description":"gender, age, personality"}],"segments":[{"speaker":"Narrator or character name","text":"…"}]}` }], maxTokens: 9000, signal: ctx.signal });
      for (const c of (r.data && r.data.characters) || []) if (c.name && !/^narrator$/i.test(c.name) && !chars.has(c.name.toLowerCase())) chars.set(c.name.toLowerCase(), { id: crypto.randomUUID().slice(0, 6), name: c.name, description: c.description || '', voice: null });
      for (const s of (r.data && r.data.segments) || []) if (s.text && String(s.text).trim()) segs.push({ id: crypto.randomUUID().slice(0, 6), speaker: /^narrator$/i.test(s.speaker || '') ? 'narrator' : ((chars.get(String(s.speaker || '').toLowerCase()) || {}).id || 'narrator'), text: String(s.text).trim() });
      win = [];
    };
    for (const p of paras) { win.push(p); if (win.join('').length > 5000) await flush(); }
    await flush();
    ch.segments = segs;
    ch.status = 'cast';
    book.characters = [...chars.values()];
    bookSave({ book });
  }
  book.mode = 'cast';
  return bookSave({ book });
}

function bookSegments(book, ch) {
  if (book.mode === 'cast' && ch.segments && ch.segments.length) return ch.segments;
  if (!ch._single) ch._single = splitNarration(ch.text).map((t, i) => ({ id: 'n' + i, speaker: 'narrator', text: t }));
  return ch._single;
}

function segVoice(book, seg) {
  if (seg.speaker === 'narrator' || book.mode !== 'cast') { if (!book.narrator) throw new Error('Choose a narrator voice first.'); return resolveVoice(book.narrator); }
  const c = (book.characters || []).find((x) => x.id === seg.speaker);
  return resolveVoice(c && c.voice ? c.voice : book.narrator);
}

async function renderSeg(book, ch, seg, ctx) {
  const spec = segVoice(book, seg);
  const key = hash({ spec, t: seg.text });
  const out = path.join(bookDir(book.id), 'segments', ch.id, `${seg.id}_${key}.wav`);
  if (!fs.existsSync(out)) { P.ensure(path.dirname(out)); await tts.synth(Object.assign({ text: seg.text }, spec), out, ctx); }
  return out;
}

async function renderChapter(book, ch, ctx, fmt) {
  const segs = bookSegments(book, ch);
  const files = [];
  for (let k = 0; k < segs.length; k++) {
    ctx.check();
    files.push(await renderSeg(book, ch, segs[k], { progress: () => {}, signal: ctx.signal, check: ctx.check }));
    ctx.progress((k + 1) / segs.length * 100, `"${ch.title}": ${k + 1}/${segs.length}`);
  }
  const gaps = segs.map((s, k) => (k + 1 < segs.length && segs[k + 1].speaker !== s.speaker ? 350 : 550));
  const out = path.join(bookDir(book.id), 'chapters', `${String(book.chapters.indexOf(ch) + 1).padStart(3, '0')} ${lib.safeName(ch.title)}.${fmt}`);
  P.ensure(path.dirname(out));
  const tmp = P.tempFile('.wav');
  await media.concat(files, tmp, { gapMs: gaps });
  const n = P.tempFile('.wav');
  await media.normalize(tmp, n, -19);
  await media.convertAudio(n, out, fmt);
  ch.output = out;
  ch.status = 'rendered';
  return out;
}

async function bookRender({ id, chapterIds, format = 'mp3', combine = true }, ctx) {
  const book = bookGet({ id });
  const targets = book.chapters.filter((c) => !chapterIds || chapterIds.includes(c.id));
  for (let i = 0; i < targets.length; i++) {
    const sub = { progress: (p, m) => ctx.progress(((i + (p || 0) / 100) / targets.length) * (combine ? 90 : 100), m), signal: ctx.signal, check: ctx.check };
    await renderChapter(book, targets[i], sub, format === 'm4b' ? 'm4a' : format);
    bookSave({ book });
  }
  if (combine && book.chapters.every((c) => c.output && fs.existsSync(c.output))) {
    ctx.progress(92, 'Building the full audiobook with chapter markers…');
    const files = book.chapters.map((c) => c.output);
    const durations = [];
    for (const f of files) durations.push(await media.duration(f));
    const meta = [';FFMETADATA1', `title=${book.title}`, `artist=${book.author || ''}`];
    let t = 0;
    book.chapters.forEach((c, k) => { meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(t * 1000)}`, `END=${Math.round((t + durations[k] + 0.8) * 1000)}`, `title=${c.title}`); t += durations[k] + 0.8; });
    const metaFile = P.tempFile('.txt');
    fs.writeFileSync(metaFile, meta.join('\n'));
    const joined = P.tempFile('.wav');
    await media.concat(files, joined, { gapMs: 800 });
    const ext = format === 'm4b' ? 'm4b' : format;
    const out = path.join(bookDir(book.id), `${lib.safeName(book.title)}.${ext}`);
    const codec = ext === 'm4b' ? ['-c:a', 'aac', '-b:a', '96k', '-f', 'mp4'] : media.AUDIO_FORMATS[ext] || media.AUDIO_FORMATS.mp3;
    await media.ffrun(['-i', joined, '-i', metaFile, '-map_metadata', '1', '-map', '0:a'].concat(codec, [out]), { ctx });
    book.output = out;
    bookSave({ book });
    await lib.addAudio(out, { title: book.title, source: 'audiobook', engine: 'multi', tags: ['audiobook'] });
  }
  return bookGet({ id });
}

async function bookRenderSegment({ id, chapterId, segId, text }, ctx) {
  const book = bookGet({ id });
  const ch = book.chapters.find((c) => c.id === chapterId);
  if (!ch) throw new Error('Chapter not found.');
  const segs = bookSegments(book, ch);
  const seg = segs.find((s) => s.id === segId);
  if (!seg) throw new Error('Segment not found.');
  if (text != null) seg.text = text;
  if (book.mode !== 'cast') ch.text = segs.map((s) => s.text).join('\n\n');
  const file = await renderSeg(book, ch, seg, ctx);
  if (ch.output) await renderChapter(book, ch, ctx, path.extname(ch.output).slice(1));
  delete ch._single;
  bookSave({ book });
  return { file, book: bookGet({ id }) };
}

module.exports = {
  resolveVoice, engineInfo, voicesFor, preview, quickTTS, trimAudio, writeScript, translateScript,
  styleEnhance, styleAuto, styleWrite, styleList, styleSave, styleDelete, describeWrite, descriptionList, descriptionSave, descriptionDelete,
  cutAudio, audioTranscribe, studioRestyle,
  sourceFromUrl, clone, cloneLocal, designLocal, saveLocalDesign, design, saveDesigned, promptedVoice, analyzeAudio, voiceForLang,
  studioList, studioGet, studioSave, studioDelete, studioWrite, studioCast, studioStyleAll, studioTranslate, studioImport, studioRenderLine, studioRender,
  bookList, bookGet, bookSave, bookDelete, bookImport, bookAnalyze, bookRender, bookRenderSegment, bookSegments,
};
