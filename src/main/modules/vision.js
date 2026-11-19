'use strict';
// Vision Engine: Discover, Analysis, Findings, Assets, Clips, Documents, Posts, Images, Chat, Export knowledge.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('../paths');
const store = require('../store');
const media = require('../media');
const dl = require('../download');
const tr = require('../transcribe');
const llm = require('../llm');
const cloud = require('../cloud');
const docs = require('../docs');
const images = require('../images');
const wp = require('../wordpress');
const translate = require('../translate');
const subs = require('../subtitles');
const data = require('../../shared/data');

const clock = subs.clock;

// ---------------------------------------------------------------- storage
function projDir(id) {
  const root = P.visionProjects();
  const hit = fs.readdirSync(root).find((d) => d.endsWith('_' + id));
  if (!hit) throw new Error('Project not found.');
  return path.join(root, hit);
}
function readProject(id) {
  const dir = projDir(id);
  const p = store.readJson(path.join(dir, 'project.json'), null);
  if (!p) throw new Error('Project file is missing.');
  p.dir = dir;
  return p;
}
function saveProject(p) {
  const dir = p.dir;
  const copy = Object.assign({}, p, { updated: Date.now() });
  delete copy.dir;
  store.writeJsonAtomic(path.join(dir, 'project.json'), copy);
  return p;
}
function vDir(p, vid) { return P.ensure(path.join(p.dir, 'videos', vid)); }
function readVideo(p, vid) {
  const v = store.readJson(path.join(vDir(p, vid), 'video.json'), null);
  if (!v) throw new Error('Video not found in this project.');
  return v;
}
function saveVideo(p, v) {
  store.writeJsonAtomic(path.join(vDir(p, v.id), 'video.json'), v);
  return v;
}
function frameFile(p, v, f) { return path.join(vDir(p, v.id), 'frames', f.file); }
function outDir(p) { return P.ensure(path.join(P.exports(), 'Vision', p.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Project')); }

function listProjects() {
  const root = P.visionProjects();
  return fs.readdirSync(root).map((d) => {
    const pj = store.readJson(path.join(root, d, 'project.json'), null);
    if (!pj) return null;
    let thumb = '';
    for (const vid of pj.videos || []) {
      const v = store.readJson(path.join(root, d, 'videos', vid, 'video.json'), null);
      if (v && v.frames && v.frames[0]) { thumb = path.join(root, d, 'videos', vid, 'frames', v.frames[0].file); break; }
    }
    return { id: pj.id, name: pj.name, videos: (pj.videos || []).length, updated: pj.updated || pj.created, thumb };
  }).filter(Boolean).sort((a, b) => b.updated - a.updated);
}

function createProject({ name }) {
  const id = crypto.randomUUID().slice(0, 8);
  const safe = String(name || 'Untitled project').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Untitled project';
  const dir = P.ensure(path.join(P.visionProjects(), `${safe}_${id}`));
  const pj = { id, name: safe, created: Date.now(), updated: Date.now(), videos: [], docs: [], posts: [], images: [], findings: [], chats: [], reports: {} };
  store.writeJsonAtomic(path.join(dir, 'project.json'), pj);
  return pj;
}

function deleteProject({ id }) { fs.rmSync(projDir(id), { recursive: true, force: true }); return listProjects(); }

function renameProject({ id, name }) { const p = readProject(id); p.name = String(name || p.name).slice(0, 60); saveProject(p); return { ok: true }; }

function videoSummary(p, v) {
  return {
    id: v.id, title: v.title, status: v.status, error: v.error || '', duration: v.duration, source: v.source,
    thumb: v.frames && v.frames[0] ? frameFile(p, v, v.frames[0]) : (v.thumbnail || ''),
    frames: (v.frames || []).length, described: (v.frames || []).filter((f) => f.desc).length,
    hasTranscript: Boolean(v.transcript && v.transcript.segments && v.transcript.segments.length),
    reports: Object.keys(v.reports || {}), clips: (v.clips || []).length, file: v.file || '',
  };
}

function getProject({ id }) {
  const p = readProject(id);
  const videos = (p.videos || []).map((vid) => { try { return videoSummary(p, readVideo(p, vid)); } catch (_) { return null; } }).filter(Boolean);
  return Object.assign({}, p, { videos, outDir: outDir(p) });
}

function getVideo({ projectId, videoId }) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  return Object.assign({}, v, { frames: (v.frames || []).map((f) => Object.assign({}, f, { path: frameFile(p, v, f) })) });
}

function addVideos({ projectId, files = [], urls = [], items = [] }) {
  const p = readProject(projectId);
  const added = [];
  const mk = (src, title) => {
    const id = crypto.randomUUID().slice(0, 8);
    const v = { id, title: title || 'Video', source: src, status: 'queued', created: Date.now(), frames: [], reports: {}, clips: [] };
    if (src.type === 'file') { v.file = src.path; v.title = title || path.basename(src.path, path.extname(src.path)); }
    saveVideo(p, v);
    p.videos.push(id);
    added.push(v);
  };
  for (const f of files) mk({ type: 'file', path: f });
  for (const u of urls) if (/^https?:\/\//i.test(String(u).trim())) mk({ type: 'url', url: String(u).trim() }, String(u).trim());
  for (const it of items) mk({ type: 'url', url: it.url, meta: it }, it.title);
  saveProject(p);
  return added.map((v) => videoSummary(p, v));
}

function removeVideo({ projectId, videoId }) {
  const p = readProject(projectId);
  p.videos = p.videos.filter((x) => x !== videoId);
  saveProject(p);
  fs.rmSync(path.join(p.dir, 'videos', videoId), { recursive: true, force: true });
  return getProject({ id: projectId });
}

// ---------------------------------------------------------------- pipeline
function detailLimit() {
  const d = (store.getSettings().vision || {}).frameDetail || 'standard';
  return d === 'low' ? 40 : d === 'high' ? 400 : 120;
}

function nearestFrame(v, t) {
  let best = null;
  for (const f of v.frames || []) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  return best;
}

function transcriptAround(v, t, span = 12) {
  const segs = (v.transcript && v.transcript.segments) || [];
  return segs.filter((s) => s.end >= t - span && s.start <= t + span).map((s) => s.text).join(' ').slice(0, 400);
}

/** A frame as the AI sees it: 512 px wide is enough to describe a scene and read on-screen text, at a third of the cost of full size. */
function frameForAI(file, width = 512) {
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage && nativeImage.createFromPath(file);
    if (img && !img.isEmpty() && img.getSize().width > width) return img.resize({ width, quality: 'good' }).toJPEG(82).toString('base64');
  } catch (_) { /* not running in Electron */ }
  return fs.readFileSync(file).toString('base64');
}

async function describeFrames(p, v, ctx, override) {
  const limit = detailLimit();
  const frames = v.frames || [];
  let targets = frames.filter((f) => !f.desc);
  if (targets.length > limit) {
    const step = targets.length / limit;
    targets = Array.from({ length: limit }, (_, i) => targets[Math.floor(i * step)]);
  }
  const sel = llm.pick('vision', override);
  const local = llm.PROVIDERS[sel.provider] && llm.PROVIDERS[sel.provider].local;
  let batch = local ? 2 : 6;
  let parallel = 1;
  if (sel.provider === 'builtin') {
    // The AI server says how many frames fit in one request; batches go out a few at a time.
    const c = await cloud.limits();
    if (c && Number(c.vision_batch) > 0) batch = Number(c.vision_batch);
    parallel = 3;
  }
  const groups = [];
  for (let i = 0; i < targets.length; i += batch) groups.push(targets.slice(i, i + batch));
  let done = 0;
  let stopped = false;
  ctx.progress(0, `Describing ${targets.length} frames…`);
  await cloud.pool(groups, parallel, async (group, gi) => {
    if (stopped) return;
    ctx.check();
    const imgs = group.map((f) => ({ mime: 'image/jpeg', data: frameForAI(frameFile(p, v, f)) }));
    const lines = group.map((f, k) => `Image ${k + 1} @ ${f.t}s (${clock(f.t)}). Speech nearby: "${transcriptAround(v, f.t)}"`).join('\n');
    try {
      const r = await llm.chatJSON(Object.assign({
        purpose: 'vision',
        system: 'You index video frames so they can be searched and cited. For each image give a factual visual description (people, setting, actions, objects, slides/UI shown, framing) in 1–3 sentences, and copy any readable on-screen text verbatim.',
        messages: [{ role: 'user', content: `Video: "${v.title}". Describe each image in order.\n${lines}\nReturn JSON {"frames":[{"i":1,"description":"…","text":"…"}]}`, images: imgs }],
        maxTokens: 3000,
        signal: ctx.signal,
      }, override || {}));
      const arr = (r.data && r.data.frames) || [];
      group.forEach((f, k) => {
        const d = arr.find((x) => Number(x.i) === k + 1) || arr[k];
        if (d) { f.desc = String(d.description || '').trim(); f.text = String(d.text || '').trim(); }
      });
    } catch (e) {
      if (e.code === 'cancelled' || e.code === 'nokey' || e.code === 'private' || e.status === 402 || gi === 0) { stopped = true; throw e; }
    }
    done += group.length;
    ctx.progress((done / targets.length) * 100, `Described ${done} of ${targets.length} frames`);
    saveVideo(p, v);
  });
}

/**
 * Full processing: fetch → probe → transcript → frames → descriptions → report.
 */
async function processVideo({ projectId, videoId, steps = {} }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  const want = Object.assign({ transcript: true, frames: true, describe: true, report: true }, steps);
  const stage = (name, a, b) => ({ progress: (pct, msg) => ctx.progress(a + ((b - a) * (pct || 0)) / 100, `${name}: ${msg || ''}`), signal: ctx.signal, check: ctx.check, emit: ctx.emit });
  try {
    v.status = 'processing'; v.error = ''; saveVideo(p, v);
    // 1. media
    if (!v.file || !fs.existsSync(v.file)) {
      if (v.source.type !== 'url') throw new Error('The video file is missing: ' + (v.file || ''));
      const meta = await dl.info(v.source.url, stage('Reading link', 0, 3)).catch(() => null);
      if (meta) { v.title = meta.title || v.title; v.meta = meta; v.thumbnail = meta.thumbnail; }
      v.file = await dl.fetchMedia(v.source.url, { dir: P.ensure(path.join(vDir(p, v.id), 'media')), maxHeight: 1080 }, stage('Downloading', 3, 25));
      saveVideo(p, v);
    }
    const info = await media.probe(v.file, ctx);
    Object.assign(v, { duration: info.duration, width: info.width, height: info.height, hasVideo: info.hasVideo });
    if (!v.title || /^https?:/.test(v.title)) v.title = info.title || path.basename(v.file, path.extname(v.file));
    saveVideo(p, v);
    // 2. transcript
    if (want.transcript && !(v.transcript && v.transcript.segments && v.transcript.segments.length)) {
      const s = store.getSettings().transcription;
      let t = null;
      if (s.useCaptions && v.source.type === 'url') {
        ctx.progress(26, 'Transcript: checking platform captions…');
        const cap = await dl.captions(v.source.url, s.language, ctx).catch(() => null);
        if (cap) t = tr.fromCaptions(cap.file, cap.lang);
      }
      if (!t && info.hasAudio) t = await tr.transcribe(v.file, {}, stage('Transcript', 26, 55));
      v.transcript = t || { segments: [], text: '', language: '', engine: 'none' };
      saveVideo(p, v);
    }
    // 3. frames
    if (want.frames && info.hasVideo && !(v.frames && v.frames.length)) {
      const s = store.getSettings().vision || {};
      const frames = await media.keyFrames(v.file, path.join(vDir(p, v.id), 'frames'), { duration: info.duration, threshold: s.sceneThreshold || 0.32, maxGap: s.maxGap || 20 }, stage('Key frames', 55, 70));
      v.frames = frames.map((f) => ({ t: f.t, file: path.basename(f.file), desc: '', text: '' }));
      saveVideo(p, v);
    }
    // 4. frame descriptions
    if (want.describe && (v.frames || []).some((f) => !f.desc)) await describeFrames(p, v, stage('Frames', 70, 90));
    // 5. report
    if (want.report && !Object.keys(v.reports || {}).length) await buildReport(p, v, null, stage('Report', 90, 100));
    v.status = 'ready';
    saveVideo(p, v);
    return videoSummary(p, v);
  } catch (e) {
    v.status = e.code === 'cancelled' ? 'queued' : 'error';
    v.error = e.code === 'cancelled' ? '' : e.message;
    saveVideo(p, v);
    throw e;
  }
}

// ---------------------------------------------------------------- context
function transcriptText(v, every = 0) {
  const segs = (v.transcript && v.transcript.segments) || [];
  if (!every) return segs.map((s) => `[${clock(s.start)}] ${s.text}`).join('\n');
  const out = [];
  let bucket = -1;
  let buf = [];
  for (const s of segs) {
    const b = Math.floor(s.start / every);
    if (b !== bucket && buf.length) { out.push(`[${clock(bucket * every)}] ${buf.join(' ')}`); buf = []; }
    bucket = b;
    buf.push(s.text);
  }
  if (buf.length) out.push(`[${clock(bucket * every)}] ${buf.join(' ')}`);
  return out.join('\n');
}

function framesText(v) {
  return (v.frames || []).filter((f) => f.desc || f.text).map((f) => `[${clock(f.t)}] (frame:${f.t}) ${f.desc}${f.text ? ` | On-screen text: "${f.text}"` : ''}`).join('\n');
}

function maxContext(purpose) {
  const sel = llm.pick(purpose || 'text');
  return llm.PROVIDERS[sel.provider] && llm.PROVIDERS[sel.provider].local ? 22000 : 240000;
}

function buildContext(p, videoIds, purpose) {
  const ids = videoIds && videoIds.length ? videoIds : p.videos;
  const budget = maxContext(purpose);
  const vids = ids.map((id) => { try { return readVideo(p, id); } catch (_) { return null; } }).filter(Boolean);
  const per = Math.floor(budget / Math.max(1, vids.length));
  const parts = vids.map((v) => {
    const head = `### VIDEO: ${v.title} (id ${v.id}, duration ${clock(v.duration || 0)})\n`;
    const fr = framesText(v);
    let tx = transcriptText(v);
    const room = per - head.length - Math.min(fr.length, per * 0.35);
    if (tx.length > room) tx = transcriptText(v, 30);
    if (tx.length > room) tx = transcriptText(v, 90);
    if (tx.length > room) tx = tx.slice(0, Math.max(0, room));
    return `${head}#### Transcript\n${tx || '(no speech)'}\n#### Key frames\n${fr.slice(0, Math.floor(per * 0.35)) || '(no frame descriptions)'}`;
  });
  return { text: parts.join('\n\n'), videos: vids };
}

// ---------------------------------------------------------------- analysis report
async function buildReport(p, v, override, ctx) {
  const ctxText = buildContext(p, [v.id], 'text').text;
  const r = await llm.chat(Object.assign({
    purpose: 'text',
    system: 'You are an expert video analyst. You combine what is SAID (transcript) with what is SHOWN (key frames) into one report. Cite moments as [mm:ss] using the timestamps provided. Be specific and factual; do not invent.',
    messages: [{ role: 'user', content: `${ctxText}\n\nWrite a Markdown report with these sections:\n## Summary\n## Key moments (bullet list, each starting with [mm:ss])\n## What is shown on screen (visual breakdown with [mm:ss])\n## Structure & techniques (hook, pacing, persuasion, editing)\n## Takeaways\n## Notable quotes (verbatim with [mm:ss])` }],
    maxTokens: 6000,
    signal: ctx.signal,
  }, override || {}));
  const key = `${r.provider}/${r.model}`;
  v.reports = v.reports || {};
  v.reports[key] = { markdown: r.text.trim(), created: Date.now(), provider: r.provider, model: r.model };
  saveVideo(p, v);
  return { key, report: v.reports[key] };
}

async function report({ projectId, videoId, provider, model }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  return buildReport(p, v, provider ? { provider, model } : null, ctx);
}

async function projectReport({ projectId, provider, model }, ctx) {
  const p = readProject(projectId);
  if ((p.videos || []).length < 2) throw new Error('Add at least two videos to compare them.');
  const c = buildContext(p, p.videos, 'text');
  ctx.progress(20, 'Comparing videos…');
  const r = await llm.chat(Object.assign({ purpose: 'text', system: 'You are an expert video analyst comparing several videos. Cite as [Video title @ mm:ss].', messages: [{ role: 'user', content: `${c.text}\n\nWrite a Markdown cross-video report: ## Overview, ## Common themes, ## Differences, ## Best hooks and moments (cite), ## What the best-performing approaches share, ## Recommendations.` }], maxTokens: 7000, signal: ctx.signal }, provider ? { provider, model } : {}));
  const key = `${r.provider}/${r.model}`;
  p.reports = p.reports || {};
  p.reports[key] = { markdown: r.text.trim(), created: Date.now() };
  saveProject(p);
  return { key, report: p.reports[key] };
}

async function translateReport({ projectId, videoId, key, lang }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  const rep = v.reports && v.reports[key];
  if (!rep) throw new Error('Report not found.');
  const md = await translate.markdown(rep.markdown, lang, ctx);
  const nk = `${key} · ${translate.name(lang)}`;
  v.reports[nk] = Object.assign({}, rep, { markdown: md, created: Date.now(), lang });
  saveVideo(p, v);
  return { key: nk, report: v.reports[nk] };
}

function deleteReport({ projectId, videoId, key }) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  delete v.reports[key];
  saveVideo(p, v);
  return { ok: true };
}

// Watch with Gemini — full video upload. ~300 tokens per second of video (frames at 1 fps + audio).
const GEMINI_PRICES = { 'gemini-2.5-flash': 0.30, 'gemini-2.5-flash-lite': 0.10, 'gemini-2.5-pro': 1.25, 'gemini-3-flash': 0.5, 'gemini-3-pro': 2.0 };
function geminiEstimate({ projectId, videoId, model }) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  const m = model || store.getSettings().ai.models.gemini || 'gemini-2.5-flash';
  const tokens = Math.round((v.duration || 0) * 300 + 2000);
  const price = GEMINI_PRICES[Object.keys(GEMINI_PRICES).find((k) => m.startsWith(k)) || 'gemini-2.5-flash'];
  return { model: m, tokens, usd: +((tokens / 1e6) * price + 0.01).toFixed(3), pricePerMillion: price, note: 'Estimate for input tokens; output is extra and usually small.' };
}

async function watchGemini({ projectId, videoId, model }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  if (!v.file || !fs.existsSync(v.file)) throw new Error('Process the video first so the file is on this computer.');
  const ext = path.extname(v.file).slice(1).toLowerCase();
  const mime = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' }[ext] || 'video/mp4';
  const up = await llm.geminiUpload(v.file, mime, ctx);
  ctx.progress(75, 'Gemini is watching the video…');
  const m = model || store.getSettings().ai.models.gemini || 'gemini-2.5-flash';
  const r = await llm.chat({ provider: 'gemini', model: m, system: 'You are an expert video analyst. Cite moments as [mm:ss].', messages: [{ role: 'user', content: 'Watch this full video and write a Markdown report: ## Summary, ## Key moments ([mm:ss] bullets), ## What is shown on screen, ## Structure & techniques, ## Takeaways, ## Notable quotes.', files: [{ mime: up.mime, uri: up.uri }] }], maxTokens: 8000, signal: ctx.signal });
  const key = `gemini-watch/${m}`;
  v.reports[key] = { markdown: r.text.trim(), created: Date.now(), provider: 'gemini', model: m, watched: true };
  saveVideo(p, v);
  return { key, report: v.reports[key] };
}

// ---------------------------------------------------------------- findings
async function findings({ projectId, videoIds, lens, question }, ctx) {
  const p = readProject(projectId);
  const L = data.LENSES.find((x) => x[0] === lens);
  const ask = question ? `Custom question: ${question}` : `Lens: ${L ? L[1] + ' — ' + L[2] : lens}`;
  const c = buildContext(p, videoIds, 'text');
  ctx.progress(15, 'Extracting findings…');
  const r = await llm.chatJSON({
    purpose: 'text',
    system: 'You extract structured findings from videos. Every finding must cite the video id and the second it occurs (use the timestamps given). Only report what is actually in the material.',
    messages: [{ role: 'user', content: `${c.text}\n\n${ask}\n\nReturn JSON {"findings":[{"video":"<video id>","t":<seconds>,"title":"short label","detail":"1–3 sentences","quote":"verbatim words if relevant"}]}. Order by time. Up to 25 findings.` }],
    maxTokens: 6000,
    signal: ctx.signal,
  });
  const items = ((r.data && r.data.findings) || []).map((f) => {
    const v = c.videos.find((x) => x.id === f.video) || c.videos[0];
    const t = Number(f.t) || 0;
    const fr = v ? nearestFrame(v, t) : null;
    return { video: v ? v.id : '', videoTitle: v ? v.title : '', t, title: String(f.title || ''), detail: String(f.detail || ''), quote: String(f.quote || ''), frame: fr && v ? frameFile(p, v, fr) : '' };
  });
  const entry = { id: crypto.randomUUID().slice(0, 8), lens: L ? L[1] : 'Custom', question: question || '', videoIds: c.videos.map((v) => v.id), items, created: Date.now(), model: `${r.provider}/${r.model}` };
  p.findings = [entry].concat(p.findings || []);
  saveProject(p);
  return entry;
}

function deleteFindings({ projectId, id }) { const p = readProject(projectId); p.findings = (p.findings || []).filter((f) => f.id !== id); saveProject(p); return { ok: true }; }

// ---------------------------------------------------------------- assets
function assets({ projectId, query }) {
  const p = readProject(projectId);
  const q = String(query || '').toLowerCase().trim();
  const out = [];
  for (const vid of p.videos) {
    let v;
    try { v = readVideo(p, vid); } catch (_) { continue; }
    for (const f of v.frames || []) {
      if (q && !(`${f.desc} ${f.text}`.toLowerCase().includes(q))) continue;
      out.push({ video: v.id, videoTitle: v.title, t: f.t, desc: f.desc, text: f.text, path: frameFile(p, v, f) });
    }
  }
  return out;
}

async function saveFullFrame({ projectId, videoId, t, dir }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  if (!v.file || !fs.existsSync(v.file)) throw new Error('The original video is not on this computer.');
  const out = path.join(dir || P.ensure(path.join(outDir(p), 'Frames')), `${v.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 40)} ${clock(t).replace(/:/g, '-')}.png`);
  await media.frameAt(v.file, t, out, {}, ctx);
  return out;
}

// ---------------------------------------------------------------- clips
async function findClips({ projectId, videoId, count = 6, minLen = 20, maxLen = 60, focus }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  if (!(v.transcript && v.transcript.segments && v.transcript.segments.length)) throw new Error('This video has no transcript yet. Process it first.');
  ctx.progress(20, 'Finding highlight moments…');
  const r = await llm.chatJSON({
    purpose: 'text',
    system: 'You are a short-form video editor. Pick self-contained moments that hook in the first 3 seconds and deliver a payoff.',
    messages: [{ role: 'user', content: `${transcriptText(v)}\n\nFind the ${count} best clips, each ${minLen}–${maxLen} seconds long${focus ? ', focused on: ' + focus : ''}. Start and end on sentence boundaries using the timestamps. Return JSON {"clips":[{"title":"…","hook":"first words / on-screen hook","start":<seconds>,"end":<seconds>,"why":"…","score":1-10}]}.` }],
    maxTokens: 3000,
    signal: ctx.signal,
  });
  const segs = v.transcript.segments;
  const snap = (t, edge) => {
    let best = t;
    let d = Infinity;
    for (const s of segs) { const x = edge === 'start' ? s.start : s.end; if (Math.abs(x - t) < d) { d = Math.abs(x - t); best = x; } }
    return d < 4 ? best : t;
  };
  const clips = ((r.data && r.data.clips) || []).map((c) => {
    let start = Math.max(0, snap(Number(c.start) || 0, 'start'));
    let end = Math.min(v.duration || 1e9, snap(Number(c.end) || start + 30, 'end'));
    if (end - start < 5) end = Math.min(v.duration || start + 30, start + Math.max(minLen, 15));
    return { id: crypto.randomUUID().slice(0, 8), title: String(c.title || 'Clip'), hook: String(c.hook || ''), why: String(c.why || ''), score: Number(c.score) || 0, start: +start.toFixed(2), end: +end.toFixed(2), renders: [] };
  });
  v.clips = clips.concat((v.clips || []).filter((c) => c.renders && c.renders.length));
  saveVideo(p, v);
  return v.clips;
}

/** Save an analysis report as Text, Markdown, Word, PDF, web page — or a narrated summary video. */
async function exportReport({ projectId, videoId, key, format = 'pdf', file, voiceSpec }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  const rep = (v.reports || {})[key] || Object.values(v.reports || {}).sort((a, b) => b.created - a.created)[0];
  if (!rep) throw new Error('Write a report first.');
  const safe = (v.title || 'Report').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Report';
  if (format === 'video') return reportVideo(p, v, rep, file || path.join(P.ensure(path.join(outDir(p), 'Reports')), `${safe} - summary.mp4`), voiceSpec, ctx);
  const ext = { pdf: 'pdf', docx: 'docx', html: 'html', md: 'md', txt: 'txt' }[format] || 'pdf';
  const out = file || path.join(P.ensure(path.join(outDir(p), 'Reports')), `${safe}.${ext}`);
  const doc = { title: v.title || 'Video report', subtitle: `Video analysis${rep.lang ? ' (' + rep.lang + ')' : ''}`, markdown: rep.markdown, typeName: 'Video report' };
  await docs.exportDoc(Object.assign({ kicker: 'Video report', date: new Date(rep.created || Date.now()).toLocaleDateString(), author: theme().brand }, doc), ext, out, { resolve: frameResolver(p), theme: Object.assign(theme(), { pageSize: 'A4' }) });
  return { file: out };
}

/** Narrated slideshow: summary + key moments read aloud over the matching key frames (1920×1080 MP4). */
async function reportVideo(p, v, rep, out, voiceSpec, ctx) {
  const tts = require('../tts');
  const summary = section(rep.markdown, 'Summary').replace(/[*_`>#]/g, '').trim();
  const moments = section(rep.markdown, 'Key moments').split('\n').map((l) => /\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)/.exec(l)).filter(Boolean).slice(0, 8).map((m) => ({ t: m[1].split(':').map(Number).reduce((a, b) => a * 60 + b, 0), text: m[2].replace(/[*_`]/g, '').trim() }));
  const items = [{ t: 0, text: `${v.title}. ${summary}`.slice(0, 900) }].concat(moments.map((m) => ({ t: m.t, text: `At ${clock(m.t)}: ${m.text}` })));
  if (items.length < 2 && !summary) throw new Error('The report has no Summary or Key moments to narrate.');
  const s = store.getSettings().tts || {};
  const spec = voiceSpec || { engine: s.engine || 'cloud', voice: s.voice || 'marin' };
  const frames = (v.frames || []).filter((f) => f.file && fs.existsSync(frameFile(p, v, f)));
  const pickFrame = (t) => { let best = frames[0]; for (const f of frames) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f; return best ? frameFile(p, v, best) : null; };
  const work = P.tempDir('reportvid');
  const fd = fontsDir();
  const font = fd ? (fs.readdirSync(fd).find((f) => /Poppins-Bold\.ttf$/i.test(f)) || fs.readdirSync(fd).find((f) => /\.ttf$/i.test(f))) : '';
  try {
    const parts = [];
    for (let i = 0; i < items.length; i++) {
      ctx.check();
      ctx.progress(5 + (i / items.length) * 85, `Narrating part ${i + 1} of ${items.length}…`);
      const wav = path.join(work, `n${i}.wav`);
      await tts.synth(Object.assign({}, spec, { text: items[i].text }), wav, { progress: () => {}, signal: ctx.signal, check: ctx.check });
      const img = pickFrame(items[i].t);
      const seg = path.join(work, `s${String(i).padStart(2, '0')}.mp4`);
      const cap = path.join(work, `c${i}.txt`);
      fs.writeFileSync(cap, (i === 0 ? v.title : `${clock(items[i].t)}  ${moments[i - 1].text}`).replace(/(.{1,60})(\s+|$)/g, '$1\n').trim().split('\n').slice(0, 3).join('\n'));
      const vf = ['scale=1920:1080:force_original_aspect_ratio=decrease', 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0d1024', 'zoompan=z=\'min(zoom+0.0006,1.08)\':d=1:s=1920x1080:fps=25'];
      if (font) vf.push(`drawbox=x=0:y=ih-230:w=iw:h=230:color=black@0.55:t=fill`, `drawtext=fontfile='${path.join(fd, font).replace(/\\/g, '/').replace(/:/g, '\\:')}':textfile='${cap.replace(/\\/g, '/').replace(/:/g, '\\:')}':fontsize=46:fontcolor=white:line_spacing=10:x=80:y=h-200`);
      const args = img ? ['-loop', '1', '-i', img, '-i', wav] : ['-f', 'lavfi', '-i', 'color=c=0x0d1024:s=1920x1080:r=25', '-i', wav];
      await media.ffrun(args.concat(['-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '25', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-shortest', seg]), { ctx: null });
      parts.push(seg);
    }
    ctx.progress(92, 'Joining…');
    const list = path.join(work, 'list.txt');
    fs.writeFileSync(list, parts.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await media.ffrun(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { ctx: null });
    ctx.progress(100, 'Video ready');
    return { file: out };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** "Write a caption": social caption + hashtags for a clip, per platform. */
async function clipCaption({ projectId, videoId, clipId, platforms = ['tiktok', 'instagram', 'youtube'] }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  const c = (v.clips || []).find((x) => x.id === clipId);
  if (!c) throw new Error('Clip not found.');
  const said = (v.transcript && v.transcript.segments ? v.transcript.segments.filter((s) => s.end > c.start && s.start < c.end).map((s) => s.text).join(' ') : '').slice(0, 6000);
  ctx.progress(30, 'Writing captions…');
  const r = await llm.chatJSON({ purpose: 'text', system: 'You write scroll-stopping captions for short vertical videos. Hook first line, value, call to action, relevant hashtags. Platform-native tone.', messages: [{ role: 'user', content: `Clip title: ${c.title}\nHook: ${c.hook}\nWhat is said: ${said}\nWrite captions for: ${platforms.join(', ')}. Return JSON {"captions":{"<platform>":{"text":"…","hashtags":["…"]}}}` }], maxTokens: 1500, signal: ctx.signal });
  c.captions = (r.data && r.data.captions) || {};
  saveVideo(p, v);
  return { captions: c.captions, clips: v.clips };
}

function updateClip({ projectId, videoId, clip }) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  const i = (v.clips || []).findIndex((c) => c.id === clip.id);
  if (i >= 0) v.clips[i] = Object.assign({}, v.clips[i], clip); else v.clips.push(Object.assign({ id: crypto.randomUUID().slice(0, 8), renders: [] }, clip));
  saveVideo(p, v);
  return v.clips;
}

function fontsDir() {
  const cands = [process.resourcesPath && path.join(process.resourcesPath, 'fonts'), path.join(__dirname, '..', '..', '..', 'resources', 'fonts')].filter(Boolean);
  return cands.find((d) => fs.existsSync(d)) || '';
}

function assColor(hex, alpha = 0) {
  const h = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f');
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function buildAss(segs, start, end, W, H, style) {
  const st = Object.assign({ preset: 'bold', color: '#ffffff', highlight: '#ffd400', position: 'bottom', size: 0, uppercase: false }, style || {});
  const size = st.size || Math.round(H * (W < H ? 0.052 : 0.06));
  const margin = st.position === 'middle' ? Math.round(H * 0.45) : st.position === 'top' ? Math.round(H * 0.12) : Math.round(H * (W < H ? 0.2 : 0.08));
  const align = st.position === 'top' ? 8 : 2;
  const box = st.preset === 'box';
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Cap,${st.font || 'Poppins'},${size},${assColor(st.preset === 'karaoke' ? st.highlight : st.color)},${assColor(st.color)},${box ? assColor('#000000', 0x40) : '&H00000000'},${assColor('#000000', 0x80)},-1,0,0,0,100,100,0,0,${box ? 3 : 1},${box ? Math.round(size * 0.25) : Math.max(2, Math.round(size * 0.08))},${box ? 0 : 2},${align},${Math.round(W * 0.06)},${Math.round(W * 0.06)},${margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const ts = (s) => { const x = Math.max(0, s); const h = Math.floor(x / 3600); const m = Math.floor((x % 3600) / 60); const sec = (x % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${sec}`; };
  const inRange = segs.filter((s) => s.end > start && s.start < end).map((s) => ({ start: Math.max(s.start, start) - start, end: Math.min(s.end, end) - start, text: s.text }));
  const chunks = subs.captionChunks(inRange, { maxWords: st.preset === 'karaoke' ? 4 : 5, maxChars: W < H ? 22 : 34 });
  const lines = chunks.map((c) => {
    let text = st.uppercase ? c.text.toUpperCase() : c.text;
    if (st.preset === 'karaoke') {
      const per = Math.max(1, Math.round(((c.end - c.start) * 100) / c.words.length));
      text = c.words.map((w) => `{\\k${per}}${st.uppercase ? w.toUpperCase() : w}`).join(' ');
    } else if (st.preset === 'pop') {
      text = `{\\fscx80\\fscy80\\t(0,120,\\fscx100\\fscy100)}${text}`;
    }
    return `Dialogue: 0,${ts(c.start)},${ts(c.end)},Cap,,0,0,0,,${text.replace(/\n/g, ' ')}`;
  });
  return header + lines.join('\n') + '\n';
}

/**
 * Render a clip.
 * @param {{aspect:'9:16'|'1:1'|'16:9', framing:'crop'|'fit'|'split', offsetX?:number, captions?:{on:boolean, preset?:string, color?:string, highlight?:string, position?:string, uppercase?:boolean}, title?:string}} o
 */
async function renderClip({ projectId, videoId, clipId, start, end, aspect = '9:16', framing = 'crop', offsetX = 0.5, captions = { on: true } }, ctx) {
  const p = readProject(projectId);
  const v = readVideo(p, videoId);
  if (!v.file || !fs.existsSync(v.file)) throw new Error('The original video is not on this computer.');
  const clip = (v.clips || []).find((c) => c.id === clipId) || { id: clipId || crypto.randomUUID().slice(0, 8), title: 'Clip', start, end, renders: [] };
  const s0 = Number(start != null ? start : clip.start);
  const s1 = Number(end != null ? end : clip.end);
  if (!(s1 > s0)) throw new Error('The clip end must be after the start.');
  const [W, H] = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] }[aspect] || [1080, 1920];
  const work = P.tempDir('clip');
  const filters = [];
  const ox = Math.max(0, Math.min(1, Number(offsetX)));
  if (framing === 'fit') {
    filters.push(`[0:v]split=2[a][b]`, `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:6,eq=brightness=-0.08[bg]`, `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`, `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]`);
  } else if (framing === 'split' && W < H) {
    const half = Math.round(H / 2);
    filters.push(`[0:v]split=2[l][r]`, `[l]crop=iw/2:ih:0:0,scale=${W}:${half}:force_original_aspect_ratio=increase,crop=${W}:${half}[t]`, `[r]crop=iw/2:ih:iw/2:0,scale=${W}:${half}:force_original_aspect_ratio=increase,crop=${W}:${half}[u]`, `[t][u]vstack=inputs=2,setsar=1[base]`);
  } else {
    filters.push(`[0:v]scale=w='if(gt(iw/ih,${W}/${H}),-2,${W})':h='if(gt(iw/ih,${W}/${H}),${H},-2)',crop=${W}:${H}:(iw-${W})*${ox.toFixed(3)}:(ih-${H})/2,setsar=1[base]`);
  }
  let last = '[base]';
  const ffArgs = ['-ss', s0.toFixed(3), '-t', (s1 - s0).toFixed(3), '-i', v.file];
  const segs = (v.transcript && v.transcript.segments) || [];
  if (captions && captions.on && segs.length) {
    fs.writeFileSync(path.join(work, 'captions.ass'), buildAss(segs, s0, s1, W, H, captions));
    const fd = fontsDir();
    if (fd) { P.ensure(path.join(work, 'fonts')); for (const f of fs.readdirSync(fd)) fs.copyFileSync(path.join(fd, f), path.join(work, 'fonts', f)); }
    filters.push(`${last}subtitles=captions.ass${fd ? ':fontsdir=fonts' : ''}[cap]`);
    last = '[cap]';
  }
  fs.writeFileSync(path.join(work, 'graph.txt'), filters.join(';\n'));
  const dir = P.ensure(path.join(outDir(p), 'Clips'));
  const name = `${(clip.title || 'Clip').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 50).trim()} ${aspect.replace(':', 'x')} ${Date.now().toString(36)}.mp4`;
  const out = path.join(dir, name);
  try {
    await media.ffrun(ffArgs.concat(['-filter_complex_script', 'graph.txt', '-map', last, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]), { ctx, duration: s1 - s0, label: 'Rendering clip…', cwd: work });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  clip.renders = (clip.renders || []).concat([{ file: out, aspect, framing, created: Date.now() }]);
  clip.start = s0; clip.end = s1;
  const i = (v.clips || []).findIndex((c) => c.id === clip.id);
  if (i >= 0) v.clips[i] = clip; else v.clips = (v.clips || []).concat([clip]);
  saveVideo(p, v);
  return { file: out, clip };
}

// ---------------------------------------------------------------- documents
function frameResolver(p) {
  const all = [];
  for (const vid of p.videos) { try { const v = readVideo(p, vid); for (const f of v.frames || []) all.push({ t: f.t, file: frameFile(p, v, f), vid }); } catch (_) { /* skip */ } }
  return (t) => {
    let best = null;
    for (const f of all) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    return best ? best.file : '';
  };
}

async function generateDoc({ projectId, videoIds, type, instructions, images = 8 }, ctx) {
  const p = readProject(projectId);
  const T = data.DOC_TYPES.find((x) => x[0] === type) || data.DOC_TYPES[0];
  const c = buildContext(p, videoIds, 'text');
  ctx.progress(10, `Writing ${T[1].toLowerCase()}…`);
  const r = await llm.chat({
    purpose: 'text',
    system: 'You are a senior instructional designer and editor who turns videos into beautiful, genuinely useful documents.',
    messages: [{ role: 'user', content: `${c.text}\n\nCreate: ${T[1]} — ${T[2]}\n${instructions ? 'Extra instructions: ' + instructions + '\n' : ''}\nRules:\n- Output Markdown only.\n- First line: "# <compelling title>". Second line: "_<one-line subtitle>_".\n- Use ## for sections and ### for sub-sections.\n- Illustrate with up to ${images} real screenshots from the video using ![short caption](frame:SECONDS) on its own line, choosing SECONDS from the "(frame:…)" markers in the Key frames list that best match the text.\n- Use > blockquotes for tips, exercises or important notes.\n- Be specific: use the actual steps, names and numbers from the video.` }],
    maxTokens: 12000,
    signal: ctx.signal,
    onToken: (_t, all) => ctx.progress(Math.min(95, 10 + all.length / 120), `Writing ${T[1].toLowerCase()}… ${all.length.toLocaleString()} characters`),
  });
  let md = r.text.trim().replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/, '');
  const lines = md.split('\n');
  let title = T[1];
  let subtitle = '';
  if (/^#\s+/.test(lines[0])) { title = lines.shift().replace(/^#\s+/, '').trim(); }
  if (lines[0] !== undefined && /^\s*_.+_\s*$/.test(lines[0])) subtitle = lines.shift().trim().replace(/^_|_$/g, '');
  md = lines.join('\n').trim();
  const doc = { id: crypto.randomUUID().slice(0, 8), type, typeName: T[1], title, subtitle, markdown: md, videoIds: c.videos.map((v) => v.id), created: Date.now(), model: `${r.provider}/${r.model}` };
  p.docs = [doc].concat(p.docs || []);
  saveProject(p);
  return doc;
}

function updateDoc({ projectId, doc }) {
  const p = readProject(projectId);
  p.docs = (p.docs || []).map((d) => (d.id === doc.id ? Object.assign({}, d, doc, { updated: Date.now() }) : d));
  saveProject(p);
  return p.docs.find((d) => d.id === doc.id);
}

function deleteDoc({ projectId, id }) { const p = readProject(projectId); p.docs = (p.docs || []).filter((d) => d.id !== id); saveProject(p); return { ok: true }; }

function theme(brand) {
  return { primary: (brand && brand.primary_color) || '#6d5efc', accent: (brand && brand.accent_color) || '#22d3ee', brand: (brand && brand.app_name) || 'Vid Vision' };
}

async function exportDoc({ projectId, id, format, brand, pageSize }, ctx) {
  const p = readProject(projectId);
  const d = (p.docs || []).find((x) => x.id === id);
  if (!d) throw new Error('Document not found.');
  const ext = { pdf: 'pdf', docx: 'docx', html: 'html', md: 'md', txt: 'txt' }[format] || 'pdf';
  const out = path.join(P.ensure(path.join(outDir(p), 'Documents')), `${d.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 70).trim()}.${ext}`);
  ctx.progress(30, `Exporting ${ext.toUpperCase()}…`);
  await docs.exportDoc(Object.assign({ kicker: d.typeName, date: new Date().toLocaleDateString(), author: theme(brand).brand }, d), ext, out, { resolve: docResolver(p), theme: Object.assign(theme(brand), { pageSize: pageSize || 'A4', design: d.design || 'modern' }) });
  return { file: out };
}

function previewDoc({ projectId, id, brand }) {
  const p = readProject(projectId);
  const d = (p.docs || []).find((x) => x.id === id);
  if (!d) throw new Error('Document not found.');
  return docs.html(Object.assign({ kicker: d.typeName, date: new Date().toLocaleDateString(), author: theme(brand).brand }, d), { resolve: docResolver(p), theme: Object.assign(theme(brand), { design: d.design || 'modern' }), imageSrc: (f) => 'media://file/' + encodeURIComponent(f) });
}

async function translateDoc({ projectId, id, lang }, ctx) {
  const p = readProject(projectId);
  const d = (p.docs || []).find((x) => x.id === id);
  if (!d) throw new Error('Document not found.');
  const md = await translate.markdown(`# ${d.title}\n_${d.subtitle}_\n\n${d.markdown}`, lang, ctx);
  const lines = md.split('\n');
  const title = /^#\s/.test(lines[0]) ? lines.shift().replace(/^#\s+/, '') : d.title;
  const subtitle = lines[0] && /^_.*_$/.test(lines[0].trim()) ? lines.shift().trim().replace(/^_|_$/g, '') : d.subtitle;
  const nd = Object.assign({}, d, { id: crypto.randomUUID().slice(0, 8), title, subtitle, markdown: lines.join('\n').trim(), lang, created: Date.now(), typeName: `${d.typeName} (${translate.name(lang)})` });
  p.docs = [nd].concat(p.docs);
  saveProject(p);
  return nd;
}

// ---------------------------------------------------------------- documents: outline → sections → diagrams
/** "## Heading" sections of a document (text before the first heading is the intro, heading ''). */
function splitSections(md) {
  const out = [];
  let cur = { heading: '', body: [] };
  for (const line of String(md || '').split('\n')) {
    if (/^##\s+\S/.test(line)) {
      if (cur.heading || cur.body.join('').trim()) out.push(cur);
      cur = { heading: line.replace(/^##\s+/, '').trim(), body: [] };
    } else cur.body.push(line);
  }
  if (cur.heading || cur.body.join('').trim()) out.push(cur);
  return out.map((s) => ({ heading: s.heading, markdown: s.body.join('\n').trim() }));
}
function joinSections(secs) { return secs.map((s) => (s.heading ? `## ${s.heading}\n\n${s.markdown}`.trim() : s.markdown)).filter(Boolean).join('\n\n').trim(); }
function cleanMd(t) { return String(t || '').trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim(); }
function assetDir(p) { return P.ensure(path.join(p.dir, 'assets')); }
function docResolver(p) { const r = frameResolver(p); r.asset = (name) => path.join(p.dir, 'assets', path.basename(name)); return r; }
function findDoc(p, id) { const d = (p.docs || []).find((x) => x.id === id); if (!d) throw new Error('Document not found.'); return d; }
function storeDoc(p, d) { d.updated = Date.now(); p.docs = (p.docs || []).map((x) => (x.id === d.id ? d : x)); saveProject(p); return d; }

/** Step 1 — an editable outline (title, subtitle, sections with key points). */
async function docOutline({ projectId, videoIds, type, instructions, sections = 6 }, ctx) {
  const p = readProject(projectId);
  const T = data.DOC_TYPES.find((x) => x[0] === type) || data.DOC_TYPES[0];
  const c = buildContext(p, videoIds, 'text');
  ctx.progress(20, 'Planning the outline…');
  const r = await llm.chatJSON({
    purpose: 'text',
    system: 'You are a senior editor who plans clear, genuinely useful documents from video material.',
    messages: [{ role: 'user', content: `${c.text.slice(0, 120000)}\n\nPlan: ${T[1]} — ${T[2]}\n${instructions ? 'Extra instructions: ' + instructions + '\n' : ''}Return JSON {"title":"compelling title","subtitle":"one line","intro":"2–3 sentence introduction","sections":[{"heading":"…","points":["what this section covers, specific to the video", "…"]}]} with about ${sections} sections in reading order. Use the real names, steps and numbers from the material.` }],
    maxTokens: 4000,
    signal: ctx.signal,
  });
  const o = r.data || {};
  return {
    type: T[0], typeName: T[1],
    title: String(o.title || T[1]), subtitle: String(o.subtitle || ''), intro: String(o.intro || ''),
    sections: (Array.isArray(o.sections) ? o.sections : []).map((s) => ({ heading: String(s.heading || '').trim(), points: (Array.isArray(s.points) ? s.points : []).map(String) })).filter((s) => s.heading),
    videoIds: c.videos.map((v) => v.id),
  };
}

function sectionPrompt(c, T, o, s, i, imgs, extra) {
  const plan = o.sections.map((x, k) => `${k + 1}. ${x.heading}${k === i ? '   ← write this one' : ''}`).join('\n');
  return `${c.text}\n\nDocument: ${T[1]} — "${o.title}"${o.subtitle ? ' (' + o.subtitle + ')' : ''}\nOutline:\n${plan}\n\nWrite section ${i + 1}: "${s.heading}".\n${s.points && s.points.length ? 'Cover: ' + s.points.join('; ') + '\n' : ''}${extra ? 'Instructions: ' + extra + '\n' : ''}Rules:\n- Output Markdown for this section's body only — do NOT repeat the "## ${s.heading}" heading. Use ### for sub-sections.\n- ${imgs ? `Illustrate with up to ${imgs} real screenshots using ![short caption](frame:SECONDS) on its own line, choosing SECONDS from the "(frame:…)" markers that match the text.` : 'No images.'}\n- Use > blockquotes for tips, exercises or important notes; tables where they help.\n- Be specific: use the actual steps, names and numbers. Do not overlap with the other sections.`;
}

/** Step 2 — write every section of an outline (in parallel) into a new document. */
async function docWrite({ projectId, outline, instructions, images = 8, design = 'modern' }, ctx) {
  const p = readProject(projectId);
  const o = outline || {};
  if (!o.sections || !o.sections.length) throw new Error('Add at least one section to the outline.');
  const T = data.DOC_TYPES.find((x) => x[0] === o.type) || data.DOC_TYPES[0];
  const c = buildContext(p, o.videoIds, 'text');
  const per = Math.max(0, Math.ceil(images / o.sections.length));
  let done = 0;
  ctx.progress(5, `Writing ${o.sections.length} sections…`);
  const parallel = require('../cloud').pool;
  const bodies = await parallel(o.sections, 3, async (s, i) => {
    const r = await llm.chat({ purpose: 'text', system: 'You are a senior instructional designer and editor who turns videos into beautiful, genuinely useful documents.', messages: [{ role: 'user', content: sectionPrompt(c, T, o, s, i, per, instructions) }], maxTokens: 4000, signal: ctx.signal });
    done++;
    ctx.progress(5 + (done / o.sections.length) * 90, `Written ${done} of ${o.sections.length} sections…`);
    return { text: cleanMd(r.text).replace(/^##\s+.*\n+/, ''), model: `${r.provider}/${r.model}` };
  });
  const secs = [{ heading: '', markdown: o.intro || '' }].concat(o.sections.map((s, i) => ({ heading: s.heading, markdown: bodies[i].text })));
  const doc = { id: crypto.randomUUID().slice(0, 8), type: T[0], typeName: T[1], title: o.title || T[1], subtitle: o.subtitle || '', markdown: joinSections(secs), outline: o.sections, design: docs.DESIGNS[design] ? design : 'modern', videoIds: c.videos.map((v) => v.id), created: Date.now(), model: bodies[0] ? bodies[0].model : '' };
  p.docs = [doc].concat(p.docs || []);
  saveProject(p);
  return doc;
}

/** The sections of a saved document (for the per-section tools). */
function docSections({ projectId, id }) { const p = readProject(projectId); return splitSections(findDoc(p, id).markdown); }

/** Rewrite, expand, shorten or add one section. index ≥ number of sections (or heading given with index -1) appends a new one. */
async function docSection({ projectId, id, index, heading, instructions, mode = 'rewrite' }, ctx) {
  const p = readProject(projectId);
  const d = findDoc(p, id);
  const secs = splitSections(d.markdown);
  const T = data.DOC_TYPES.find((x) => x[0] === d.type) || data.DOC_TYPES[0];
  let i = Number(index);
  if (!(i >= 0 && i < secs.length)) { if (!heading) throw new Error('Name the new section.'); secs.push({ heading: String(heading), markdown: '' }); i = secs.length - 1; }
  const s = secs[i];
  if (heading && s.heading) s.heading = String(heading);
  const c = buildContext(p, d.videoIds, 'text');
  const how = !s.markdown ? 'Write this new section.' : { rewrite: 'Rewrite this section from scratch, better.', expand: 'Expand this section with more depth, examples and steps (keep what is good).', shorten: 'Tighten this section to about half the length, keeping the essentials.', simplify: 'Rewrite this section in plain, simple language for beginners.' }[mode] || 'Rewrite this section.';
  ctx.progress(15, s.heading ? `Writing “${s.heading}”…` : 'Writing the introduction…');
  const outline = { title: d.title, subtitle: d.subtitle, sections: secs.filter((x) => x.heading).map((x) => ({ heading: x.heading })) };
  const k = outline.sections.findIndex((x) => x.heading === s.heading);
  const prompt = s.heading
    ? sectionPrompt(c, T, outline, { heading: s.heading, points: [] }, Math.max(0, k), 2, [how, instructions].filter(Boolean).join(' ')) + (s.markdown ? `\n\nCurrent version of this section:\n${s.markdown}` : '')
    : `${c.text}\n\nWrite a 2–4 sentence introduction for the ${T[1].toLowerCase()} "${d.title}". ${instructions || ''}\nCurrent introduction:\n${s.markdown || '(none)'}\nOutput Markdown only.`;
  const r = await llm.chat({ purpose: 'text', system: 'You are a senior instructional designer and editor.', messages: [{ role: 'user', content: prompt }], maxTokens: 4000, signal: ctx.signal, onToken: (_t, all) => ctx.progress(Math.min(95, 15 + all.length / 60), 'Writing…') });
  s.markdown = cleanMd(r.text).replace(/^##\s+.*\n+/, '');
  d.markdown = joinSections(secs);
  storeDoc(p, d);
  return { doc: d, index: i, section: s };
}

/** Move or delete a section. */
function docSectionEdit({ projectId, id, index, action, to }) {
  const p = readProject(projectId);
  const d = findDoc(p, id);
  const secs = splitSections(d.markdown);
  const i = Number(index);
  if (!secs[i]) throw new Error('Section not found.');
  if (action === 'delete') secs.splice(i, 1);
  else if (action === 'move') { const j = Math.max(0, Math.min(secs.length - 1, Number(to))); const [s] = secs.splice(i, 1); secs.splice(j, 0, s); }
  d.markdown = joinSections(secs);
  return storeDoc(p, d);
}

const DIAGRAM_KINDS = {
  auto: 'whichever diagram explains it best',
  flowchart: 'a flowchart (flowchart TD) of the process or decisions',
  mindmap: 'a mind map (mindmap) of the main ideas',
  sequence: 'a sequence diagram (sequenceDiagram) of who does what, in order',
  timeline: 'a timeline (timeline) of the events or phases',
  pie: 'a pie chart (pie) of the numbers mentioned',
  quadrant: 'a quadrant chart (quadrantChart) comparing the options',
};

/** Rasterise an SVG in a hidden window (used when the engine canvas is tainted). */
async function svgToPng(svg, w, h) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, width: Math.min(4000, w), height: Math.min(4000, h), webPreferences: { offscreen: true, javascript: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:#fff"><div style="padding:40px">${svg}</div></body></html>`));
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage();
    return img.toPNG();
  } finally { win.destroy(); }
}

/** AI diagram (Mermaid → PNG) inserted at the end of a section. */
async function docDiagram({ projectId, id, index, kind = 'auto', prompt, brand }, ctx) {
  const p = readProject(projectId);
  const d = findDoc(p, id);
  const secs = splitSections(d.markdown);
  const i = Math.max(0, Math.min(secs.length - 1, Number(index) || 0));
  const s = secs[i];
  const want = DIAGRAM_KINDS[kind] || DIAGRAM_KINDS.auto;
  ctx.progress(15, 'Designing the diagram…');
  const ask = [{ role: 'user', content: `Section "${s.heading || d.title}":\n${s.markdown.slice(0, 12000)}\n\nDraw ${want}${prompt ? ' — ' + prompt : ''}. Keep labels short (≤ 6 words), 4–14 nodes, no styling or click directives, valid Mermaid 11 syntax. Return JSON {"caption":"short caption","code":"the Mermaid code"}` }];
  const engines = require('../engines');
  let out = null;
  let lastErr = '';
  for (let attempt = 0; attempt < 3 && !out; attempt++) {
    const r = await llm.chatJSON({ purpose: 'text', system: 'You are an information designer who writes clean, valid Mermaid diagrams.', messages: ask, maxTokens: 2500, signal: ctx.signal });
    const j = r.data || {};
    const code = String(j.code || '').replace(/^```(?:mermaid)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      ctx.progress(55 + attempt * 10, 'Drawing the diagram…');
      const th = theme(brand);
      const res = await engines.run('mermaid', { code, primary: th.primary, accent: th.accent }, ctx);
      const png = res.png ? Buffer.from(res.png, 'base64') : await svgToPng(res.svg, res.width, res.height);
      out = { caption: String(j.caption || 'Diagram'), code, png };
    } catch (e) {
      if (e.code === 'cancelled') throw e;
      lastErr = e.message;
      ask.push({ role: 'assistant', content: JSON.stringify(j) }, { role: 'user', content: `That Mermaid code failed to render: ${lastErr.slice(0, 400)}. Fix it and return the same JSON.` });
    }
  }
  if (!out) throw new Error('The diagram could not be drawn. Try another diagram type. (' + lastErr.slice(0, 120) + ')');
  const name = `diagram_${d.id}_${Date.now().toString(36)}.png`;
  fs.writeFileSync(path.join(assetDir(p), name), out.png);
  s.markdown = `${s.markdown}\n\n![${out.caption.replace(/[[\]]/g, '')}](asset:${name})`.trim();
  d.markdown = joinSections(secs);
  d.diagrams = (d.diagrams || []).concat([{ name, code: out.code, caption: out.caption, kind }]);
  storeDoc(p, d);
  return { doc: d, file: path.join(assetDir(p), name), caption: out.caption, code: out.code };
}

/** AI infographic (image model) for a section, or the whole document when index is -1. */
async function docInfographic({ projectId, id, index = -1, prompt, style }, ctx) {
  const p = readProject(projectId);
  const d = findDoc(p, id);
  const secs = splitSections(d.markdown);
  const i = Number(index);
  const target = i >= 0 && secs[i] ? secs[i] : null;
  const text = target ? `## ${target.heading}\n${target.markdown}` : `# ${d.title}\n${d.markdown}`;
  ctx.progress(10, 'Designing the infographic…');
  const r = await llm.chatJSON({
    purpose: 'text',
    system: 'You are an art director who writes precise prompts for AI image models that render readable text well.',
    messages: [{ role: 'user', content: `${text.slice(0, 20000)}\n\nDesign a clean portrait infographic summarising this.${prompt ? ' Extra: ' + prompt : ''} Style: ${style || 'modern flat vector, generous white space, clear hierarchy, icons'}. On-image text: headline ≤ 8 words, 3–6 points ≤ 6 words each.\nReturn JSON {"caption":"short caption","prompt":"a complete image-generation prompt that spells out the exact text to render, layout, colours and typography"}` }],
    maxTokens: 1500,
    signal: ctx.signal,
  });
  const j = r.data || {};
  const file = await images.generate(String(j.prompt || prompt || d.title), { size: '1024x1536', style: 'infographic' }, assetDir(p), ctx);
  const name = path.basename(file);
  const md = `![${String(j.caption || 'Infographic').replace(/[[\]]/g, '')}](asset:${name})`;
  if (target) target.markdown = `${target.markdown}\n\n${md}`.trim();
  else secs.splice(secs[0] && !secs[0].heading ? 1 : 0, 0, { heading: '', markdown: md });
  d.markdown = joinSections(secs);
  storeDoc(p, d);
  return { doc: d, file, caption: j.caption || 'Infographic' };
}

// ---------------------------------------------------------------- posts
async function generatePosts({ projectId, videoIds, platforms, tone, instructions, wordCount = 1200 }, ctx) {
  const p = readProject(projectId);
  const want = (platforms && platforms.length ? platforms : data.SOCIAL.map((s) => s[0]));
  const c = buildContext(p, videoIds, 'text');
  const spec = want.map((k) => {
    const s = data.SOCIAL.find((x) => x[0] === k);
    if (k === 'wordpress') return `"wordpress": {"title":"…","slug":"…","excerpt":"≤155 chars","tags":["…"],"markdown":"${wordCount}-word SEO article in Markdown with ## headings; you may include up to 3 images as ![caption](frame:SECONDS)"}`;
    if (k === 'x') return `"x": {"text":"≤280 characters","thread":["post 1 ≤280","post 2 ≤280","…up to 8"]}`;
    if (k === 'pinterest') return `"pinterest": {"title":"≤100 characters","text":"≤500 characters with keywords"}`;
    return `"${k}": {"text":"≤${s ? s[2] : 2000} characters, platform-native formatting${k === 'instagram' ? ', end with 10–20 hashtags' : ''}"}`;
  });
  ctx.progress(15, 'Writing posts…');
  const r = await llm.chatJSON({
    purpose: 'text',
    system: `You are a top social media and SEO copywriter. Tone: ${tone || 'engaging, clear, authentic'}. Respect every character limit.`,
    messages: [{ role: 'user', content: `${c.text}\n\n${instructions ? 'Extra instructions: ' + instructions + '\n' : ''}Write posts based on this content. Return JSON {${spec.join(', ')}}` }],
    maxTokens: 12000,
    signal: ctx.signal,
  });
  const entry = { id: crypto.randomUUID().slice(0, 8), platforms: want, posts: r.data || {}, videoIds: c.videos.map((v) => v.id), created: Date.now(), model: `${r.provider}/${r.model}` };
  p.posts = [entry].concat(p.posts || []);
  saveProject(p);
  return entry;
}

function updatePosts({ projectId, entry }) {
  const p = readProject(projectId);
  p.posts = (p.posts || []).map((x) => (x.id === entry.id ? Object.assign({}, x, entry) : x));
  saveProject(p);
  return { ok: true };
}

async function publishWordPress({ projectId, siteId, title, markdown, status, date, categories, tags, excerpt, slug, featuredT }, ctx) {
  const p = readProject(projectId);
  const resolve = frameResolver(p);
  const inline = [];
  let n = 0;
  const md = String(markdown || '').replace(/!\[([^\]]*)\]\(frame:([\d.]+)\)/g, (all, cap, t) => {
    const f = resolve(Number(t));
    if (!f) return '';
    const ph = `__AME_IMG_${++n}__`;
    inline.push({ file: f, placeholder: ph });
    return `![${cap}](${ph})`;
  });
  const { marked } = require('marked');
  const html = marked.parse(md, { gfm: true });
  return wp.publish(siteId, { title, html, status, date, categories, tags, excerpt, slug, featuredImage: featuredT != null ? resolve(Number(featuredT)) : '', inlineImages: inline }, ctx);
}

// ---------------------------------------------------------------- images
async function imagePrompt({ projectId, videoIds, layout, type, instructions, style }, ctx) {
  const p = readProject(projectId);
  const t = data.IMAGE_TYPES.find((x) => x[0] === type) || data.IMAGE_TYPES[0];
  const c = buildContext(p, videoIds, 'text');
  ctx.progress(20, 'Designing the image…');
  const r = await llm.chatJSON({
    purpose: 'text',
    system: 'You are an art director who writes precise prompts for AI image models that render readable text well.',
    messages: [{ role: 'user', content: `${c.text.slice(0, 60000)}\n\nDesign a ${t[1]} (${t[2]}) using the "${layout}" layout that communicates the most valuable idea from this content.${instructions ? ' Extra: ' + instructions : ''} Visual style: ${style || 'modern, clean, high-contrast, brand-friendly flat illustration'}.\nKeep on-image text short (headline ≤ 8 words, each point ≤ 6 words, max 6 points).\nReturn JSON {"headline":"…","points":["…"],"prompt":"a complete, detailed image-generation prompt that spells out the exact text to render, layout, colours, typography and composition"}` }],
    maxTokens: 2000,
    signal: ctx.signal,
  });
  return Object.assign({ size: t[3], aspect: t[2], typeName: t[1], layout }, r.data || {});
}

async function generateImage({ projectId, prompt, provider, model, size, meta }, ctx) {
  const p = readProject(projectId);
  const file = await images.generate(prompt, { provider, model, size }, P.ensure(path.join(outDir(p), 'Images')), ctx);
  const entry = Object.assign({ id: crypto.randomUUID().slice(0, 8), file, prompt, provider: provider || store.getSettings().images.provider, created: Date.now() }, meta || {});
  p.images = [entry].concat(p.images || []);
  saveProject(p);
  return entry;
}

function deleteImage({ projectId, id }) { const p = readProject(projectId); p.images = (p.images || []).filter((x) => x.id !== id); saveProject(p); return { ok: true }; }

// ---------------------------------------------------------------- chat
async function chat({ projectId, videoId, chatId, message, attachments = [] }, ctx) {
  const p = readProject(projectId);
  const c = buildContext(p, videoId ? [videoId] : p.videos, 'text');
  p.chats = p.chats || [];
  let thread = p.chats.find((x) => x.id === chatId);
  if (!thread) { thread = { id: chatId || crypto.randomUUID().slice(0, 8), videoId: videoId || '', title: String(message).slice(0, 60), messages: [], created: Date.now() }; p.chats.unshift(thread); }
  const imgs = [];
  let extra = '';
  for (const a of attachments) {
    if (/\.(jpe?g|png|webp)$/i.test(a)) imgs.push({ mime: /png$/i.test(a) ? 'image/png' : 'image/jpeg', data: fs.readFileSync(a).toString('base64') });
    else {
      try { const r = await require('../importers').read(a); extra += `\n\n[Attached file ${path.basename(a)}]\n${r.text.slice(0, 40000)}`; } catch (_) { /* ignore */ }
    }
  }
  const history = thread.messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  const msgs = history.concat([{ role: 'user', content: message + extra, images: imgs }]);
  const sys = `You answer questions about the user's video${videoId ? '' : 's'} using ONLY the material below. When you use a fact, cite its moment as [mm:ss]${videoId ? '' : ' and name the video'}. If the material does not contain the answer, say so.\n\n${c.text}`;
  let streamed = '';
  const r = await llm.chat({ purpose: imgs.length ? 'vision' : 'text', system: sys, messages: msgs, maxTokens: 4000, signal: ctx.signal, onToken: (tok, all) => { streamed = all; ctx.emit('chat-token', { jobId: ctx.jobId, text: all }); } });
  const answer = (r.text || streamed).trim();
  thread.messages.push({ role: 'user', content: message, attachments, at: Date.now() }, { role: 'assistant', content: answer, at: Date.now(), model: `${r.provider}/${r.model}` });
  thread.updated = Date.now();
  saveProject(p);
  return { chatId: thread.id, answer, thread };
}

function deleteChat({ projectId, id }) { const p = readProject(projectId); p.chats = (p.chats || []).filter((x) => x.id !== id); saveProject(p); return { ok: true }; }

// ---------------------------------------------------------------- export knowledge
function section(md, name) {
  const re = new RegExp(`##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const m = re.exec(md || '');
  return m ? m[1].trim() : '';
}

const KNOWLEDGE_TARGETS = {
  chatgpt: { label: 'ChatGPT', note: 'Upload this file to ChatGPT (a chat, a Project or a custom GPT) and ask questions about the videos.' },
  claude: { label: 'Claude', note: 'Add this file to a Claude Project or chat and ask questions about the videos.' },
  gemini: { label: 'Gemini', note: 'Upload this file to Gemini (or a Gem) and ask questions about the videos.' },
  notebooklm: { label: 'NotebookLM', note: 'Add this file as a source in NotebookLM.' },
  agents: { label: 'Codex · Claude Code', note: 'Put this file in your repository (as AGENTS.md / CLAUDE.md or under docs/). Coding agents read it as project context.', name: 'AGENTS.md' },
  local: { label: 'Ollama · LM Studio', note: 'Attach this file in Open WebUI / LM Studio chat, or paste it into the system prompt of your local model.' },
};

/** Videos added (or analysed) since the last knowledge export — the "Created" tab. */
function knowledgeNew({ projectId }) {
  const p = readProject(projectId);
  const since = p.lastKnowledgeExport || 0;
  return { since, videos: p.videos.map((id) => { try { const v = readVideo(p, id); return { id: v.id, title: v.title, created: v.created, status: v.status }; } catch (_) { return null; } }).filter((v) => v && v.created > since) };
}

async function exportKnowledge({ projectId, level = 'standard', format = 'md', videoIds, includeChats = false, overview = false, target = '', onlyNew = false }, ctx) {
  const p = readProject(projectId);
  let ids = videoIds && videoIds.length ? videoIds : p.videos;
  if (onlyNew) { const nw = knowledgeNew({ projectId }).videos.map((v) => v.id); ids = ids.filter((id) => nw.includes(id)); if (!ids.length) throw new Error('No new videos since the last export.'); }
  const vids = ids.map((id) => { try { return readVideo(p, id); } catch (_) { return null; } }).filter(Boolean);
  const T = KNOWLEDGE_TARGETS[target];
  const out = [`# ${p.name} — Knowledge File`, '', `_${level[0].toUpperCase() + level.slice(1)} export · ${vids.length} video(s) · ${new Date().toLocaleString()}${onlyNew ? ' · new since the last export' : ''}_`, '', 'This file describes the videos in this project: what was said (transcript) and what was shown (frames). Timestamps are [mm:ss].', ''];
  if (T) out.push(`> For ${T.label}: ${T.note}`, '');
  if (overview && vids.length) {
    ctx.progress(2, 'Writing a one-page overview…');
    const digest = vids.map((v) => { const rep = Object.values(v.reports || {}).sort((a, b) => b.created - a.created)[0]; return `## ${v.title}\n${rep ? section(rep.markdown, 'Summary') : (v.transcript && v.transcript.text ? v.transcript.text.slice(0, 3000) : '')}`; }).join('\n\n').slice(0, 120000);
    const r = await llm.chat({ purpose: 'text', system: 'You write one-page overviews of video collections for a knowledge file.', messages: [{ role: 'user', content: `${digest}\n\nWrite a one-page Markdown overview (≤ 400 words): ## Overview (what these videos are about), ## Main themes, ## Most useful videos and why, ## Questions this file can answer.` }], maxTokens: 1500, signal: ctx.signal }).catch(() => ({ text: '' }));
    if (r.text.trim()) out.push(r.text.trim().replace(/^# .*\n/, ''), '');
  }
  for (let i = 0; i < vids.length; i++) {
    const v = vids[i];
    ctx.progress((i / vids.length) * 100, `Building knowledge file… ${i + 1}/${vids.length}`);
    out.push(`## ${v.title}`, '', `- Duration: ${clock(v.duration || 0)}`, v.source && v.source.url ? `- Source: ${v.source.url}` : `- File: ${path.basename(v.file || '')}`, '');
    const rep = Object.values(v.reports || {}).sort((a, b) => b.created - a.created)[0];
    let summary = rep ? section(rep.markdown, 'Summary') : '';
    if (!summary && v.transcript && v.transcript.text) {
      const r = await llm.chat({ purpose: 'text', system: 'Summarize this video transcript in 5 sentences.', messages: [{ role: 'user', content: v.transcript.text.slice(0, 60000) }], maxTokens: 800, signal: ctx.signal }).catch(() => ({ text: '' }));
      summary = r.text.trim();
    }
    out.push('### Summary', '', summary || '(no summary)', '');
    const moments = rep ? section(rep.markdown, 'Key moments') : '';
    if (moments) out.push('### Key moments', '', moments, '');
    if (level === 'brief') continue;
    if (rep && level === 'standard') {
      const take = section(rep.markdown, 'Takeaways');
      if (take) out.push('### Takeaways', '', take, '');
      const shown = section(rep.markdown, 'What is shown');
      if (shown) out.push('### What is shown on screen', '', shown, '');
    }
    if (level === 'complete') for (const [k, r2] of Object.entries(v.reports || {})) out.push(`### Analysis report (${k})`, '', r2.markdown, '');
    const fr = (v.frames || []).filter((f) => f.desc);
    if (fr.length) out.push('### Visual timeline', '', ...(level === 'complete' ? fr : fr.filter((_, k) => k % 2 === 0)).map((f) => `- [${clock(f.t)}] ${f.desc}${f.text ? ` — on screen: "${f.text}"` : ''}`), '');
    out.push('### Transcript', '', level === 'complete' ? transcriptText(v) : transcriptText(v, 60), '');
  }
  const pf = (p.findings || []).filter((f) => level !== 'brief');
  if (pf.length) {
    out.push('## Findings', '');
    for (const f of pf.slice(0, level === 'complete' ? 50 : 5)) {
      out.push(`### ${f.lens}${f.question ? ': ' + f.question : ''}`, '');
      for (const it of f.items) out.push(`- [${clock(it.t)}] **${it.title}** — ${it.detail}${it.quote ? ` ("${it.quote}")` : ''}`);
      out.push('');
    }
  }
  if (includeChats && (p.chats || []).length) {
    out.push('## Questions already asked (chats)', '');
    for (const c of p.chats.slice(0, level === 'complete' ? 40 : 12)) {
      out.push(`### ${c.title || 'Chat'}`, '');
      for (const m of (c.messages || []).slice(0, level === 'complete' ? 60 : 12)) out.push(`**${m.role === 'user' ? 'Q' : 'A'}:** ${String(m.content || '').trim()}`, '');
    }
  }
  let text = out.join('\n').replace(/\n{3,}/g, '\n\n');
  if (format === 'txt') text = text.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/_([^_\n]+)_/g, '$1');
  const base = T && T.name && format !== 'txt' ? `${p.name} - ${T.name}` : `${p.name} - ${level}${onlyNew ? ' (new)' : ''}${T ? ' - ' + T.label.replace(/[^\w ]+/g, '') : ''}.${format === 'txt' ? 'txt' : 'md'}`;
  const file = path.join(P.ensure(path.join(outDir(p), 'Knowledge')), base);
  fs.writeFileSync(file, text);
  p.lastKnowledgeExport = Date.now();
  saveProject(p);
  return { file, text: level === 'brief' ? text : text.slice(0, 2000), chars: text.length };
}

// ---------------------------------------------------------------- discover
/** Export Discover results: spreadsheet (.csv), web page, Markdown or text. */
function discoverExport({ results, format = 'csv', file, title, mode }) {
  const rows = (results || []).map((e, i) => ({ rank: e.rank || i + 1, title: e.title || '', channel: e.channel || '', followers: e.followers || 0, views: e.views || 0, likes: e.likes || 0, comments: e.comments || 0, duration: e.duration || 0, uploaded: e.uploadDate && e.uploadDate.length === 8 ? `${e.uploadDate.slice(0, 4)}-${e.uploadDate.slice(4, 6)}-${e.uploadDate.slice(6, 8)}` : '', url: e.url || '', license: e.license || '' }));
  const cols = ['rank', 'title', 'channel', 'followers', 'views', 'likes', 'comments', 'duration', 'uploaded', 'url', 'license'];
  const head = `Discover — ${title || 'results'}${mode ? ` (ranked by ${mode})` : ''} — ${new Date().toLocaleString()}`;
  let out;
  if (format === 'csv') {
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    out = '\ufeff' + [cols.join(',')].concat(rows.map((r) => cols.map((c) => q(r[c])).join(','))).join('\r\n');
  } else if (format === 'html') {
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    out = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(head)}</title><style>body{font:14px system-ui,sans-serif;margin:32px;color:#1b1e2e}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e3e5ec;padding:8px;text-align:left;vertical-align:top}th{background:#f4f5f9}td.n{text-align:right;font-variant-numeric:tabular-nums}</style></head><body><h1>${esc(head)}</h1><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => (c === 'url' ? `<td><a href="${esc(r.url)}">open</a></td>` : `<td class="${typeof r[c] === 'number' ? 'n' : ''}">${esc(r[c])}</td>`)).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  } else if (format === 'md') {
    out = `# ${head}\n\n| # | Title | Channel | Views | Likes | Comments | Uploaded |\n|---|---|---|---:|---:|---:|---|\n` + rows.map((r) => `| ${r.rank} | [${r.title.replace(/\|/g, '/')}](${r.url}) | ${r.channel.replace(/\|/g, '/')} | ${r.views} | ${r.likes} | ${r.comments} | ${r.uploaded} |`).join('\n') + '\n';
  } else {
    out = head + '\n\n' + rows.map((r) => `${r.rank}. ${r.title}\n   ${r.channel} — ${r.views} views, ${r.likes} likes, ${r.comments} comments${r.uploaded ? ', ' + r.uploaded : ''}\n   ${r.url}`).join('\n\n') + '\n';
  }
  fs.writeFileSync(file, out);
  return { file, rows: rows.length };
}

async function discover({ query, market, filter, mode, limit = 30, platform = 'youtube', url }, ctx) {
  let list;
  if (url) {
    ctx.progress(5, 'Reading link…');
    list = await dl.flat(url, limit, ctx);
    if (list.length && list.length <= 40) list = await dl.enrich(list, ctx);
  } else {
    if (!query) throw new Error('Type something to search for.');
    if (platform === 'tiktok' || platform === 'instagram') list = await dl.searchSocial(platform, query, { limit, filter: filter || 'any' }, ctx);
    else list = await dl.searchYouTube(query, { market: market || 'US', filter: filter || 'any', limit, enrichTop: Math.min(limit, 25) }, ctx);
  }
  return dl.rank(list, mode || 'relevance');
}

module.exports = {
  discoverExport, knowledgeNew, clipCaption, exportReport,
  listProjects, createProject, deleteProject, renameProject, getProject, getVideo, addVideos, removeVideo, processVideo,
  report, projectReport, translateReport, deleteReport, geminiEstimate, watchGemini,
  findings, deleteFindings, assets, saveFullFrame, findClips, updateClip, renderClip, buildAss,
  generateDoc, updateDoc, deleteDoc, exportDoc, previewDoc, translateDoc,
  docOutline, docWrite, docSections, docSection, docSectionEdit, docDiagram, docInfographic, DIAGRAM_KINDS, splitSections, joinSections,
  generatePosts, updatePosts, publishWordPress, imagePrompt, generateImage, deleteImage,
  chat, deleteChat, exportKnowledge, discover, buildContext, readProject, readVideo,
};
