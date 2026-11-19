'use strict';
// Scribe Engine: single + bulk transcription, editor data, AI prompt library, translation, downloader, link extractor.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('../paths');
const store = require('../store');
const media = require('../media');
const dl = require('../download');
const tr = require('../transcribe');
const llm = require('../llm');
const subs = require('../subtitles');
const translate = require('../translate');
const importers = require('../importers');
const lib = require('../library');
const data = require('../../shared/data');
const net = require('../util/net');
const cloud = require('../cloud');

const EXT_FORMATS = { txt: 'txt', srt: 'srt', vtt: 'vtt', csv: 'csv', json: 'json' };

// ---------------------------------------------------------------- projects
function pFile(id) { return path.join(P.scribeProjects(), `${id}.amescribe`); }
function list() {
  const dir = P.scribeProjects();
  return fs.readdirSync(dir).filter((f) => f.endsWith('.amescribe')).map((f) => {
    const j = store.readJson(path.join(dir, f), null);
    return j ? { id: j.id, name: j.name, rows: (j.rows || []).length, done: (j.rows || []).filter((r) => r.status === 'done').length, updated: j.updated || j.created, kind: j.kind || 'bulk' } : null;
  }).filter(Boolean).sort((a, b) => b.updated - a.updated);
}
function read(id) {
  const j = store.readJson(pFile(id), null);
  if (!j) throw new Error('Scribe project not found.');
  return j;
}
function write(p) { p.updated = Date.now(); store.writeJsonAtomic(pFile(p.id), p); return p; }
function create({ name, kind }) {
  const p = { id: crypto.randomUUID().slice(0, 8), name: String(name || 'Untitled batch').slice(0, 80), kind: kind || 'bulk', rows: [], combined: [], created: Date.now() };
  return write(p);
}
function singleProject() {
  const hit = list().find((x) => x.kind === 'single');
  return hit ? read(hit.id) : create({ name: 'My transcripts', kind: 'single' });
}
function open({ id }) { return id === 'single' ? singleProject() : read(id); }
function remove({ id }) { try { fs.unlinkSync(pFile(id)); } catch (_) { /* ignore */ } fs.rmSync(path.join(P.scribeProjects(), id), { recursive: true, force: true }); return list(); }
function rename({ id, name }) { const p = read(id); p.name = String(name).slice(0, 80); write(p); return { ok: true }; }

/** Open a project file from anywhere (e.g. shared by a teammate). */
function importProject({ file }) {
  const j = store.readJson(file, null);
  if (!j || !Array.isArray(j.rows)) throw new Error('Not a Scribe project file.');
  j.id = crypto.randomUUID().slice(0, 8);
  j.name = (j.name || 'Imported') + ' (imported)';
  return write(j);
}
function exportProject({ id, file }) { fs.copyFileSync(pFile(id), file); return { file }; }

function mkRow(src, name) {
  return { id: crypto.randomUUID().slice(0, 8), name: name || 'Item', source: src, status: 'queued', error: '', created: Date.now(), transcript: null, ai: null, translations: {} };
}

async function addItems({ projectId, files = [], urls = [], expand = true }, ctx) {
  const p = open({ id: projectId });
  const rows = [];
  for (const f of files) rows.push(Object.assign(mkRow({ type: 'file', path: f }, path.basename(f)), { file: f }));
  const clean = urls.map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u));
  for (let i = 0; i < clean.length; i++) {
    const u = clean[i];
    if (expand && /(list=|\/playlist|\/@|\/channel\/|\/c\/|\/user\/|\/videos$|\/shorts$)/.test(u) && !/watch\?v=/.test(u)) {
      ctx && ctx.progress((i / clean.length) * 100, 'Expanding playlist/channel…');
      try {
        const entries = await dl.flat(u, 500, ctx);
        for (const e of entries) rows.push(mkRow({ type: 'url', url: e.url }, e.title || e.url));
        continue;
      } catch (_) { /* fall through as single */ }
    }
    rows.push(mkRow({ type: 'url', url: u }, u));
  }
  p.rows = p.rows.concat(rows);
  write(p);
  return p;
}

function updateRow({ projectId, row }) {
  const p = open({ id: projectId });
  const i = p.rows.findIndex((r) => r.id === row.id);
  if (i < 0) throw new Error('Row not found.');
  const merged = Object.assign({}, p.rows[i], row);
  if (row.transcript && row.transcript.segments) {
    merged.transcript = Object.assign({}, p.rows[i].transcript || {}, row.transcript);
    merged.transcript.text = subs.toTXT(merged.transcript.segments);
    merged.transcript.words = merged.transcript.text.split(/\s+/).filter(Boolean).length;
  }
  p.rows[i] = merged;
  write(p);
  return merged;
}

function deleteRows({ projectId, rowIds }) {
  const p = open({ id: projectId });
  p.rows = p.rows.filter((r) => !rowIds.includes(r.id));
  write(p);
  return p;
}

// ---------------------------------------------------------------- transcription
async function processRow(p, row, opts, ctx) {
  const save = () => { const i = p.rows.findIndex((r) => r.id === row.id); if (i >= 0) p.rows[i] = row; write(p); ctx.emit && ctx.emit('scribe-row', { projectId: p.id, row }); };
  const sub = (a, b) => ({ progress: (x, m) => ctx.progress(a + ((b - a) * (x || 0)) / 100, m), signal: ctx.signal, check: ctx.check, emit: ctx.emit });
  try {
    row.status = 'working'; row.error = ''; save();
    if (row.source.type === 'url' && (!row.file || !fs.existsSync(row.file))) {
      row.status = 'downloading'; save();
      const meta = await dl.info(row.source.url, null).catch(() => null);
      if (meta && meta.title) row.name = meta.title;
      if (opts.useCaptions && meta) {
        const cap = await dl.captions(row.source.url, opts.language, ctx).catch(() => null);
        if (cap) {
          row.transcript = tr.fromCaptions(cap.file, cap.lang);
          row.duration = meta.duration || 0;
          row.language = row.transcript.language;
        }
      }
      if (!row.transcript || opts.saveMedia) {
        const dir = P.ensure(path.join(P.scribeProjects(), p.id, 'media'));
        row.file = await dl.fetchMedia(row.source.url, { dir, audioOnly: !opts.saveVideo, audioFormat: 'mp3' }, sub(0, 35));
      }
      save();
    }
    if (!row.transcript) {
      if (!row.file || !fs.existsSync(row.file)) throw new Error('Media file not found.');
      row.status = 'transcribing'; save();
      const info = await media.probe(row.file, ctx);
      row.duration = info.duration;
      if (!info.hasAudio) throw new Error('This file has no audio track.');
      row.transcript = await tr.transcribe(row.file, { engine: opts.engine, model: opts.model, language: opts.language, translate: opts.translate, prompt: opts.initialPrompt }, sub(35, 85));
      row.language = row.transcript.language;
    }
    save();
    if (opts.promptText) {
      row.status = 'ai'; save();
      ctx.progress(88, 'Running AI prompt…');
      row.ai = await runPromptOn(row, opts.promptText, opts.target || 'text', ctx);
      save();
    }
    for (const lang of opts.translateTo || []) {
      row.status = 'translating'; save();
      const segs = await translate.segments(row.transcript.segments, lang, { engine: opts.translateEngine || store.getSettings().translation.engine, source: row.language }, sub(90, 99));
      row.translations = row.translations || {};
      row.translations[translate.fileSuffix(lang)] = { lang, segments: segs, at: Date.now() };
      save();
    }
    row.status = 'done';
    save();
    return row;
  } catch (e) {
    row.status = e.code === 'cancelled' ? 'queued' : 'error';
    row.error = e.code === 'cancelled' ? '' : e.message;
    save();
    if (e.code === 'cancelled') throw e;
    return row;
  }
}

async function transcribeOne({ projectId = 'single', file, url, options = {} }, ctx) {
  const p = open({ id: projectId });
  const row = file ? Object.assign(mkRow({ type: 'file', path: file }, path.basename(file)), { file }) : mkRow({ type: 'url', url }, url);
  p.rows.unshift(row);
  write(p);
  const s = store.getSettings().transcription;
  const r = await processRow(p, row, Object.assign({ useCaptions: s.useCaptions, saveMedia: true, saveVideo: false }, options), ctx);
  if (r.status === 'error') throw new Error(r.error);
  return { projectId: p.id, row: r };
}

async function runBulk({ projectId, rowIds, options = {} }, ctx) {
  const p = open({ id: projectId });
  const targets = p.rows.filter((r) => (rowIds && rowIds.length ? rowIds.includes(r.id) : r.status !== 'done'));
  const s = store.getSettings().transcription;
  const opts = Object.assign({ useCaptions: s.useCaptions, saveMedia: false, saveVideo: false }, options);
  let ok = 0;
  let fail = 0;
  // Built-in cloud transcription runs several files at once; the offline engine uses the whole CPU/GPU for one.
  const engine = opts.engine || s.engine || 'cloud';
  const at = new Array(targets.length).fill(0);
  await cloud.pool(targets.map((_, i) => i), engine === 'cloud' ? 3 : 1, async (i) => {
    ctx.check();
    const row = p.rows.find((r) => r.id === targets[i].id);
    const sub = { progress: (x, m) => { at[i] = (x || 0) / 100; ctx.progress((at.reduce((a, b) => a + b, 0) / targets.length) * 100, `${i + 1}/${targets.length} · ${row.name.slice(0, 40)} — ${m || ''}`); }, signal: ctx.signal, check: ctx.check, emit: ctx.emit };
    const r = await processRow(p, row, opts, sub);
    at[i] = 1;
    if (r.status === 'done') ok++; else fail++;
  });
  return { done: ok, failed: fail, project: read(p.id) };
}

async function saveRecording({ buffer, ext }) {
  const dir = P.ensure(path.join(P.workspace(), 'Recordings'));
  const file = path.join(dir, `Recording ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.${ext || 'webm'}`);
  fs.writeFileSync(file, Buffer.from(buffer));
  return { file };
}

// ---------------------------------------------------------------- exports
function rowText(row, fmt, lang) {
  const segs = lang && row.translations && row.translations[lang] ? row.translations[lang].segments : ((row.transcript && row.transcript.segments) || []);
  return subs.format(segs, fmt, { title: row.name, language: lang || (row.transcript && row.transcript.language) || '', engine: row.transcript && row.transcript.engine, model: row.transcript && row.transcript.model });
}

function preview({ projectId, rowId, format, lang }) {
  const p = open({ id: projectId });
  const row = p.rows.find((r) => r.id === rowId);
  if (!row || !row.transcript) throw new Error('No transcript yet.');
  return { text: rowText(row, format, lang).slice(0, 20000) };
}

async function exportRows({ projectId, rowIds, formats = ['txt'], dir, includeTranslations = true, includeAi = true }, ctx) {
  const p = open({ id: projectId });
  const out = dir || P.ensure(path.join(P.exports(), 'Scribe', p.name.replace(/[\\/:*?"<>|]+/g, ' ').trim()));
  P.ensure(out);
  const rows = p.rows.filter((r) => r.transcript && (!rowIds || !rowIds.length || rowIds.includes(r.id)));
  const files = [];
  rows.forEach((row, i) => {
    const base = lib.safeName(row.name);
    for (const f of formats) {
      const ext = f === 'txt-ts' ? 'txt' : EXT_FORMATS[f] || 'txt';
      const file = path.join(out, `${base}${f === 'txt-ts' ? '.timestamps' : ''}.${ext}`);
      fs.writeFileSync(file, rowText(row, f));
      files.push(file);
      if (includeTranslations) for (const lang of Object.keys(row.translations || {})) {
        const tf = path.join(out, `${base}.${lang}.${ext}`);
        fs.writeFileSync(tf, rowText(row, f, lang));
        files.push(tf);
      }
    }
    if (includeAi && row.ai && row.ai.output) {
      const af = path.join(out, `${base}.ai.${row.ai.ext || 'txt'}`);
      fs.writeFileSync(af, row.ai.output);
      files.push(af);
    }
    ctx.progress(((i + 1) / rows.length) * 100, `Exported ${i + 1}/${rows.length}`);
  });
  return { dir: out, files };
}

/** Grid as one spreadsheet (CSV). */
function exportGrid({ projectId, file }) {
  const p = open({ id: projectId });
  const head = ['#', 'Name', 'Source', 'Duration', 'Language', 'Status', 'Words', 'Transcript', 'AI Output'];
  const lines = [head.join(',')];
  p.rows.forEach((r, i) => {
    const cells = [i + 1, r.name, r.source.url || r.source.path || '', subs.clock(r.duration || 0), r.language || '', r.status, r.transcript ? r.transcript.words : 0, r.transcript ? r.transcript.text : '', r.ai ? r.ai.output : ''];
    lines.push(cells.map((c) => { const s = String(c == null ? '' : c); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(','));
  });
  fs.writeFileSync(file, '﻿' + lines.join('\n'));
  return { file };
}

// ---------------------------------------------------------------- AI prompts
function prompts() {
  const custom = lib.prompts.list().map((x) => Object.assign({ builtIn: false }, x));
  return { categories: data.PROMPT_CATEGORIES.concat(['My prompts']), prompts: data.PROMPTS.concat(custom.map((c) => Object.assign({ cat: data.PROMPT_CATEGORIES.length }, c))) };
}
function savePrompt({ prompt }) {
  if (!prompt.title || !prompt.prompt) throw new Error('Give the prompt a title and text.');
  if (prompt.id && lib.prompts.get(prompt.id)) lib.prompts.update(prompt.id, { title: prompt.title, prompt: prompt.prompt });
  else lib.prompts.add({ title: prompt.title, prompt: prompt.prompt });
  return prompts();
}
function deletePrompt({ id }) { lib.prompts.remove(id); return prompts(); }
function exportPrompts({ file }) { fs.writeFileSync(file, JSON.stringify({ app: 'Vid Vision', prompts: lib.prompts.list() }, null, 2)); return { file }; }
function importPrompts({ file }) {
  const j = store.readJson(file, null);
  const arr = j && (j.prompts || (Array.isArray(j) ? j : null));
  if (!arr) throw new Error('Not a prompt file.');
  for (const x of arr) if (x.title && x.prompt) lib.prompts.add({ title: x.title, prompt: x.prompt });
  return prompts();
}

function targetText(row, target) {
  const segs = (row.transcript && row.transcript.segments) || [];
  switch (target) {
    case 'srt': return subs.toSRT(segs);
    case 'vtt': return subs.toVTT(segs);
    case 'csv': return subs.toCSV(segs);
    case 'json': return subs.toJSON(segs);
    case 'aiout': return (row.ai && row.ai.output) || '';
    default: return subs.toTXT(segs, { timestamps: true });
  }
}

async function runPromptOn(row, promptText, target, ctx) {
  const input = targetText(row, target);
  if (!input.trim()) throw new Error('Nothing to run the prompt on yet.');
  const r = await llm.chat({ purpose: 'text', system: 'You are an expert content assistant working on a transcript. Follow the instruction exactly. Use Markdown where helpful.', messages: [{ role: 'user', content: `Instruction: ${promptText}\n\nTitle: ${row.name}\n\n---\n${input.slice(0, 300000)}` }], maxTokens: 8000, signal: ctx.signal });
  return { output: r.text.trim(), prompt: promptText, target, at: Date.now(), model: `${r.provider}/${r.model}` };
}

/**
 * Run a prompt.
 * scope: each (per row → AI Output column), combined (all rows → one result), aiout-each (prompt over AI Output column per row), editor (given text).
 */
async function runPrompt({ projectId, rowIds, promptText, target = 'text', scope = 'each', editorText }, ctx) {
  if (!promptText || !String(promptText).trim()) throw new Error('Choose or write a prompt.');
  if (scope === 'editor') {
    ctx.progress(30, 'Running prompt…');
    const r = await llm.chat({ purpose: 'text', system: 'You are an expert content assistant. Follow the instruction exactly.', messages: [{ role: 'user', content: `Instruction: ${promptText}\n\n---\n${String(editorText || '').slice(0, 300000)}` }], maxTokens: 8000, signal: ctx.signal });
    return { output: r.text.trim() };
  }
  const p = open({ id: projectId });
  const rows = p.rows.filter((r) => r.transcript && (!rowIds || !rowIds.length || rowIds.includes(r.id)));
  if (!rows.length) throw new Error('No transcripts selected.');
  if (scope === 'combined') {
    const budget = 280000;
    const per = Math.floor(budget / rows.length);
    const body = rows.map((r) => `### ${r.name}\n${targetText(r, target).slice(0, per)}`).join('\n\n');
    ctx.progress(30, `Running prompt across ${rows.length} transcripts…`);
    const r = await llm.chat({ purpose: 'text', system: 'You are an expert content assistant working across several transcripts. Follow the instruction exactly; reference items by title.', messages: [{ role: 'user', content: `Instruction: ${promptText}\n\n---\n${body}` }], maxTokens: 10000, signal: ctx.signal });
    const entry = { id: crypto.randomUUID().slice(0, 8), prompt: promptText, rows: rows.map((x) => x.id), output: r.text.trim(), at: Date.now(), model: `${r.provider}/${r.model}` };
    p.combined = [entry].concat(p.combined || []);
    write(p);
    return { combined: entry };
  }
  for (let i = 0; i < rows.length; i++) {
    ctx.check();
    ctx.progress((i / rows.length) * 100, `Prompt on ${i + 1}/${rows.length}: ${rows[i].name.slice(0, 40)}`);
    const row = p.rows.find((x) => x.id === rows[i].id);
    try {
      row.ai = await runPromptOn(row, promptText, scope === 'aiout-each' ? 'aiout' : target, ctx);
    } catch (e) {
      if (e.code === 'cancelled') throw e;
      row.ai = { output: '', error: e.message, prompt: promptText, at: Date.now() };
    }
    write(p);
    ctx.emit('scribe-row', { projectId: p.id, row });
  }
  return { project: p };
}

async function combineOutputs({ projectId, instruction }, ctx) {
  const p = open({ id: projectId });
  const outs = p.rows.filter((r) => r.ai && r.ai.output);
  if (!outs.length) throw new Error('Run a prompt on some rows first.');
  ctx.progress(30, 'Merging AI outputs…');
  const r = await llm.chat({ purpose: 'text', system: 'Merge these AI outputs into one well-organised master document. Remove duplicates, keep every unique insight, group logically, keep source titles where useful.', messages: [{ role: 'user', content: `${instruction ? 'Extra instruction: ' + instruction + '\n\n' : ''}${outs.map((x) => `### ${x.name}\n${x.ai.output}`).join('\n\n').slice(0, 300000)}` }], maxTokens: 10000, signal: ctx.signal });
  const entry = { id: crypto.randomUUID().slice(0, 8), prompt: 'Combine AI outputs' + (instruction ? ': ' + instruction : ''), rows: outs.map((x) => x.id), output: r.text.trim(), at: Date.now(), model: `${r.provider}/${r.model}` };
  p.combined = [entry].concat(p.combined || []);
  write(p);
  return { combined: entry };
}

// ---------------------------------------------------------------- translation
async function translateRows({ projectId, rowIds, targets, engine, source }, ctx) {
  const p = open({ id: projectId });
  const rows = p.rows.filter((r) => r.transcript && (!rowIds || !rowIds.length || rowIds.includes(r.id)));
  const total = rows.length * targets.length;
  let n = 0;
  for (const row of rows) {
    for (const lang of targets) {
      ctx.check();
      const sub = { progress: (x, m) => ctx.progress(((n + (x || 0) / 100) / total) * 100, `${row.name.slice(0, 30)} → ${translate.name(lang)}: ${m || ''}`), signal: ctx.signal, check: ctx.check };
      const segs = await translate.segments(row.transcript.segments, lang, { engine: engine || store.getSettings().translation.engine, source: source || row.language }, sub);
      row.translations = row.translations || {};
      row.translations[translate.fileSuffix(lang)] = { lang, segments: segs, at: Date.now() };
      write(p);
      ctx.emit('scribe-row', { projectId: p.id, row });
      n++;
    }
  }
  return { project: p };
}

/** Translate files on disk (txt/srt/vtt/csv/json/md/docx/pdf) into one or more languages, one output per language. */
async function translateFiles({ files, targets, engine, source, dir }, ctx) {
  const outDir = dir || P.ensure(path.join(P.exports(), 'Translations'));
  const outFiles = [];
  const total = files.length * targets.length;
  let n = 0;
  for (const f of files) {
    const r = await importers.read(f);
    const ext = r.ext;
    let detected = source;
    if (!detected) {
      try {
        const g = await llm.chatJSON({ purpose: 'text', system: 'Identify the language of the text.', messages: [{ role: 'user', content: `${r.text.slice(0, 800)}\n\nReturn JSON {"iso":"two-letter ISO 639-1 code"}` }], maxTokens: 50, signal: ctx.signal });
        detected = (g.data && g.data.iso) || 'en';
      } catch (_) { detected = 'en'; }
    }
    for (const lang of targets) {
      ctx.check();
      const sub = { progress: (x, m) => ctx.progress(((n + (x || 0) / 100) / total) * 100, `${path.basename(f)} → ${translate.name(lang)}: ${m || ''}`), signal: ctx.signal, check: ctx.check };
      const suffix = translate.fileSuffix(lang);
      let content;
      let outExt = ext;
      if (r.segments && r.segments.length) {
        const segs = await translate.segments(r.segments, lang, { engine, source: detected }, sub);
        content = ext === 'lrc' ? subs.toLRC(segs) : ext === 'sbv' ? subs.toSRT(segs) : subs.format(segs, ext);
        if (ext === 'sbv') outExt = 'srt';
      } else {
        content = await translate.text(r.text, lang, { engine, source: detected }, sub);
        if (ext === 'docx' || ext === 'pdf') outExt = 'txt';
      }
      const out = path.join(outDir, `${r.name}.${suffix}.${outExt}`);
      fs.writeFileSync(out, content);
      outFiles.push(out);
      n++;
    }
  }
  return { dir: outDir, files: outFiles };
}

// ---------------------------------------------------------------- downloader + link extractor
async function download({ urls, mode = 'video', quality = 1080, audioFormat = 'mp3', dir }, ctx) {
  const outDir = dir || P.downloads();
  const results = [];
  const clean = urls.map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u));
  for (let i = 0; i < clean.length; i++) {
    ctx.check();
    const sub = { progress: (x, m) => ctx.progress(((i + (x || 0) / 100) / clean.length) * 100, `${i + 1}/${clean.length}: ${m || ''}`), signal: ctx.signal, check: ctx.check };
    try {
      const file = await dl.fetchMedia(clean[i], { dir: outDir, audioOnly: mode === 'audio', audioFormat, maxHeight: Number(quality) || 1080 }, sub);
      results.push({ url: clean[i], file, ok: true });
    } catch (e) {
      if (e.code === 'cancelled') throw e;
      results.push({ url: clean[i], ok: false, error: e.message });
    }
    ctx.emit('download-item', { jobId: ctx.jobId, item: results[results.length - 1] });
  }
  return { dir: outDir, results };
}

const MEDIA_RE = /https?:\/\/[^\s"'<>()\\]+?\.(?:mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|flac|ogg|aac|m3u8)(?:\?[^\s"'<>()\\]*)?/gi;
const VIDEO_PATTERNS = [
  /https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)[\w-]{6,}[^\s"'<>]*/gi,
  /https?:\/\/youtu\.be\/[\w-]{6,}/gi,
  /https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?\d{5,}[^\s"'<>]*/gi,
  /https?:\/\/(?:www\.)?(?:tiktok\.com\/@[\w.-]+\/video\/\d+|vm\.tiktok\.com\/[\w]+)/gi,
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[\w-]+/gi,
  /https?:\/\/(?:www\.)?(?:facebook\.com\/[^\s"'<>]*\/videos\/\d+|fb\.watch\/[\w]+)/gi,
  /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\w+\/status\/\d+/gi,
  /https?:\/\/(?:www\.)?dailymotion\.com\/video\/[\w]+/gi,
  /https?:\/\/(?:www\.)?loom\.com\/share\/[\w]+/gi,
  /https?:\/\/[\w-]+\.wistia\.com\/medias\/[\w]+/gi,
  /https?:\/\/(?:www\.)?rumble\.com\/v[\w-]+\.html/gi,
  /https?:\/\/(?:drive\.google\.com\/file\/d\/[\w-]+[^\s"'<>]*|www\.dropbox\.com\/s(?:cl\/fi)?\/[^\s"'<>]+)/gi,
  /https?:\/\/[^\s"'<>]*(?:podcasts\.apple\.com|open\.spotify\.com\/episode|soundcloud\.com)\/[^\s"'<>]+/gi,
];

function linksFromText(text) {
  const found = new Set();
  const decoded = String(text).replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
  for (const re of VIDEO_PATTERNS.concat([MEDIA_RE])) for (const m of decoded.match(re) || []) found.add(m.replace(/[.,;)\]]+$/, ''));
  // Normalise YouTube variants and drop tracking duplicates.
  const out = new Map();
  for (const u of found) {
    const yt = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/.exec(u);
    const key = yt ? 'yt:' + yt[1] : u.split('#')[0];
    if (!out.has(key)) out.set(key, yt ? `https://www.youtube.com/watch?v=${yt[1]}` : u);
  }
  return [...out.values()];
}

// Search engine result pages (Google, Bing, DuckDuckGo) are read in a hidden browser window, like a person would see them.
const SEARCH_RE = /^https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/search|bing\.com\/(?:videos\/)?search|duckduckgo\.com\/)/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function searchUrl(engine, query, videos) {
  const q = encodeURIComponent(String(query || '').trim());
  if (engine === 'bing') return videos ? `https://www.bing.com/videos/search?q=${q}` : `https://www.bing.com/search?q=${q}`;
  if (engine === 'duckduckgo') return `https://duckduckgo.com/?q=${q}${videos ? '&ia=videos&iax=videos' : ''}`;
  return `https://www.google.com/search?q=${q}${videos ? '&tbm=vid' : ''}&hl=en`;
}

function pageUrl(url, page) {
  if (!page) return url;
  const u = new URL(url);
  if (/google\./i.test(u.host)) u.searchParams.set('start', String(page * 10));
  else if (/bing\.com/i.test(u.host)) u.searchParams.set('first', String(1 + page * 10));
  else return '';
  return u.toString();
}

/** Google/Bing redirect links → the real destination. */
function realUrl(href) {
  try {
    const u = new URL(href);
    if (/google\./i.test(u.host) && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || '';
    if (/bing\.com$/i.test(u.host) && u.pathname.startsWith('/ck/')) { const x = u.searchParams.get('u'); if (x && x.startsWith('a1')) return Buffer.from(x.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
    return href;
  } catch (_) { return ''; }
}

const OWN_HOSTS = /(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|bing\.com|microsoft\.com|msn\.com|duckduckgo\.com|w3\.org|schema\.org)$/i;

async function searchResults(url, { pages = 3, onlyVideos = false } = {}, ctx) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, width: 1180, height: 900, title: 'Search', autoHideMenuBar: true, webPreferences: { partition: 'persist:search', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setUserAgent(UA);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const cancel = () => { if (!win.isDestroyed()) win.destroy(); };
  if (ctx.signal) ctx.signal.addEventListener('abort', cancel, { once: true });
  const found = new Map();
  try {
    for (let page = 0; page < Math.max(1, Math.min(10, pages)); page++) {
      const u = pageUrl(url, page);
      if (!u) break;
      ctx.progress(10 + (page / pages) * 80, `Reading results page ${page + 1}…`);
      await win.loadURL(u).catch(() => {});
      // Cookie notice or "are you a robot" check: show the window so the person can answer it themselves.
      const blocked = () => { try { const h = new URL(win.webContents.getURL()); return /consent\./i.test(h.host) || /\/sorry\//.test(h.pathname) || /captcha|challenge/i.test(h.pathname); } catch (_) { return false; } };
      if (blocked()) {
        ctx.progress(15, 'The search page needs you — answer it in the window that opened…');
        win.setTitle('Answer this page, then it closes by itself');
        win.show();
        const t0 = Date.now();
        while (blocked() && Date.now() - t0 < 180000) { await new Promise((r) => setTimeout(r, 700)); if (win.isDestroyed()) throw Object.assign(new Error('Cancelled'), { code: 'cancelled' }); }
        win.hide();
        if (blocked()) throw new Error('The search page is still asking for confirmation. Try again in a few minutes.');
        await new Promise((r) => setTimeout(r, 800));
      }
      await new Promise((r) => setTimeout(r, 900));
      // DuckDuckGo loads more results as you scroll.
      if (/duckduckgo\.com/i.test(u)) for (let i = 0; i < pages * 2; i++) { await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight); (document.querySelector("#more-results")||{click(){}}).click(); 1').catch(() => {}); await new Promise((r) => setTimeout(r, 700)); }
      const items = await win.webContents.executeJavaScript(`[...document.querySelectorAll('a[href]')].map((a) => { const h = a.querySelector('h3, h2') || a; return [a.href, (h.innerText || a.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 200)]; })`).catch(() => []);
      const before = found.size;
      for (const [href, title] of items) {
        const real = realUrl(href);
        let host = '';
        try { host = new URL(real).host; } catch (_) { continue; }
        if (!/^https?:/i.test(real) || OWN_HOSTS.test(host)) continue;
        if (onlyVideos) { for (const v of linksFromText(real)) if (!found.has(v)) found.set(v, { url: v, title }); } else if (!found.has(real.split('#')[0])) found.set(real.split('#')[0], { url: real.split('#')[0], title });
      }
      if (found.size === before && page > 0) break;
    }
  } finally {
    if (ctx.signal) ctx.signal.removeEventListener('abort', cancel);
    cancel();
  }
  return { links: [...found.values()].filter((l) => l.title || onlyVideos) };
}

async function extractLinks({ url, text, query, engine = 'google', pages = 3, onlyVideos = true }, ctx) {
  if (query && !url) return searchResults(searchUrl(engine, query, onlyVideos), { pages, onlyVideos }, ctx);
  if (url && SEARCH_RE.test(url)) return searchResults(url, { pages, onlyVideos }, ctx);
  if (text && !url) return { links: linksFromText(text).map((u) => ({ url: u, title: '' })) };
  if (!url) throw new Error('Paste a link or some text.');
  // YouTube playlists/channels/search: use the video downloader engine.
  if (/youtube\.com\/(playlist|@|channel\/|c\/|user\/|results)|youtube\.com\/.*[?&]list=/.test(url)) {
    ctx.progress(10, 'Scanning YouTube…');
    const entries = await dl.flat(url, 2000, ctx);
    return { links: entries.map((e) => ({ url: e.url, title: e.title, duration: e.duration })) };
  }
  if (/vimeo\.com\/(showcase|channels|album|[a-z][\w]+$)/i.test(url)) {
    try { const entries = await dl.flat(url, 1000, ctx); if (entries.length > 1) return { links: entries.map((e) => ({ url: e.url, title: e.title })) }; } catch (_) { /* fall back to page scan */ }
  }
  let target = url;
  const gdoc = /docs\.google\.com\/document\/d\/([\w-]+)/.exec(url);
  if (gdoc) target = `https://docs.google.com/document/d/${gdoc[1]}/export?format=txt`;
  ctx.progress(30, 'Reading page…');
  let res;
  try {
    res = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' }, signal: ctx.signal, redirect: 'follow' });
  } catch (e) {
    throw new Error('Could not open that page: ' + e.message);
  }
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.${gdoc ? ' Make sure the Google Doc is shared as "Anyone with the link".' : ''}`);
  const body = await res.text();
  const links = linksFromText(body);
  if (!links.length) {
    // Maybe the page itself is a single video page.
    try { const one = await dl.info(url, ctx); if (one && one.url) return { links: [{ url: one.url, title: one.title, duration: one.duration }] }; } catch (_) { /* none */ }
  }
  return { links: links.map((u) => ({ url: u, title: '' })) };
}

module.exports = {
  list, open, create, remove, rename, importProject, exportProject, addItems, updateRow, deleteRows,
  transcribeOne, runBulk, saveRecording, preview, exportRows, exportGrid,
  prompts, savePrompt, deletePrompt, exportPrompts, importPrompts, runPrompt, combineOutputs,
  translateRows, translateFiles, download, extractLinks, linksFromText,
  _search: { searchUrl, pageUrl, realUrl, SEARCH_RE },
};
