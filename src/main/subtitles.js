'use strict';
// Transcript formats: SRT, VTT, TXT, CSV, JSON, LRC, SBV — writers and parsers.

function pad(n, w = 2) { return String(Math.floor(n)).padStart(w, '0'); }

function stamp(sec, sep = ',') {
  const s = Math.max(0, sec || 0);
  const ms = Math.round((s - Math.floor(s)) * 1000) % 1000;
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}${sep}${pad(ms, 3)}`;
}

/** mm:ss or h:mm:ss for display. */
function clock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

function toSRT(segs) {
  return segs.map((s, i) => `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${(s.text || '').trim()}\n`).join('\n');
}

function toVTT(segs) {
  return 'WEBVTT\n\n' + segs.map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${(s.text || '').trim()}\n`).join('\n');
}

function toTXT(segs, { timestamps = false } = {}) {
  if (timestamps) return segs.map((s) => `[${clock(s.start)}] ${(s.text || '').trim()}`).join('\n');
  // Join into readable paragraphs (break on long pauses).
  const out = [];
  let para = [];
  for (let i = 0; i < segs.length; i++) {
    para.push((segs[i].text || '').trim());
    const gap = i + 1 < segs.length ? segs[i + 1].start - segs[i].end : 0;
    if (gap > 1.5 || para.join(' ').length > 700) { out.push(para.join(' ')); para = []; }
  }
  if (para.length) out.push(para.join(' '));
  return out.join('\n\n');
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(segs) {
  return 'index,start,end,start_seconds,end_seconds,text\n' + segs.map((s, i) => [i + 1, stamp(s.start), stamp(s.end), (s.start || 0).toFixed(3), (s.end || 0).toFixed(3), (s.text || '').trim()].map(csvCell).join(',')).join('\n') + '\n';
}

function toJSON(segs, meta = {}) {
  return JSON.stringify(Object.assign({}, meta, { segments: segs.map((s, i) => ({ id: i + 1, start: +(s.start || 0).toFixed(3), end: +(s.end || 0).toFixed(3), text: (s.text || '').trim() })) }), null, 2);
}

function toLRC(segs) {
  return segs.map((s) => `[${pad(s.start / 60)}:${pad(s.start % 60)}.${pad(Math.round((s.start % 1) * 100))}]${(s.text || '').trim()}`).join('\n');
}

function format(segs, fmt, meta) {
  switch (fmt) {
    case 'srt': return toSRT(segs);
    case 'vtt': return toVTT(segs);
    case 'csv': return toCSV(segs);
    case 'json': return toJSON(segs, meta);
    case 'lrc': return toLRC(segs);
    case 'txt-ts': return toTXT(segs, { timestamps: true });
    default: return toTXT(segs);
  }
}

// ---------- parsers
function parseTime(t) {
  const m = /(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?/.exec(String(t).trim());
  if (!m) return 0;
  const frac = m[4] ? Number('0.' + m[4]) : 0;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + frac;
}

function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' '); }

function parseSRTorVTT(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/);
  const segs = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->');
    const body = stripTags(lines.slice(ti + 1).join(' ')).replace(/\s+/g, ' ').trim();
    if (!body) continue;
    segs.push({ start: parseTime(a), end: parseTime(z.trim().split(/\s+/)[0]), text: body });
  }
  return segs;
}

/** YouTube auto-captions repeat rolling lines; collapse overlapping duplicates. */
function dedupeRolling(segs) {
  const out = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev) {
      if (s.text === prev.text) { prev.end = Math.max(prev.end, s.end); continue; }
      if (s.text.startsWith(prev.text)) { prev.text = s.text; prev.end = s.end; continue; }
      if (prev.text.endsWith(s.text)) { prev.end = Math.max(prev.end, s.end); continue; }
      // Strip a repeated prefix carried over from the previous cue.
      const words = prev.text.split(' ');
      for (let k = Math.min(words.length, 12); k > 2; k--) {
        const tail = words.slice(-k).join(' ');
        if (s.text.startsWith(tail + ' ')) { s.text = s.text.slice(tail.length + 1); break; }
      }
    }
    if (s.end - s.start < 0.05 && prev) { prev.end = Math.max(prev.end, s.end); continue; }
    out.push(Object.assign({}, s));
  }
  return out.filter((s) => s.text.trim());
}

function parseLRC(text) {
  const segs = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\[(\d+):(\d+)(?:\.(\d+))?\](.*)$/.exec(line.trim());
    if (m && m[4].trim()) segs.push({ start: +m[1] * 60 + +m[2] + (m[3] ? Number('0.' + m[3]) : 0), end: 0, text: m[4].trim() });
  }
  for (let i = 0; i < segs.length; i++) segs[i].end = i + 1 < segs.length ? segs[i + 1].start : segs[i].start + 4;
  return segs;
}

function parseSBV(text) {
  const segs = [];
  for (const b of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = b.split('\n');
    const m = /^([\d:.]+),([\d:.]+)$/.exec((lines[0] || '').trim());
    if (m) segs.push({ start: parseTime(m[1]), end: parseTime(m[2]), text: lines.slice(1).join(' ').trim() });
  }
  return segs;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

/** Parse any supported transcript file into segments (or null for plain text). */
function parseAny(text, ext) {
  ext = (ext || '').toLowerCase().replace('.', '');
  if (ext === 'srt' || ext === 'vtt') return parseSRTorVTT(text);
  if (ext === 'lrc') return parseLRC(text);
  if (ext === 'sbv') return parseSBV(text);
  if (ext === 'json') {
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : (j.segments || j.transcription || []);
      return arr.map((x) => ({ start: Number(x.start != null ? x.start : (x.offsets ? x.offsets.from / 1000 : 0)), end: Number(x.end != null ? x.end : (x.offsets ? x.offsets.to / 1000 : 0)), text: String(x.text || '').trim() })).filter((x) => x.text);
    } catch (_) { return null; }
  }
  if (ext === 'csv') {
    const rows = parseCSV(text);
    if (!rows.length) return null;
    const head = rows[0].map((h) => h.toLowerCase());
    const ti = head.indexOf('text');
    if (ti < 0) return null;
    const si = head.indexOf('start_seconds') >= 0 ? head.indexOf('start_seconds') : head.indexOf('start');
    const ei = head.indexOf('end_seconds') >= 0 ? head.indexOf('end_seconds') : head.indexOf('end');
    return rows.slice(1).map((r) => ({ start: si >= 0 ? (/:/.test(r[si]) ? parseTime(r[si]) : Number(r[si])) : 0, end: ei >= 0 ? (/:/.test(r[ei]) ? parseTime(r[ei]) : Number(r[ei])) : 0, text: r[ti] || '' }));
  }
  return null;
}

/** Split segments into short caption chunks with proportional word timing. */
function captionChunks(segs, { maxWords = 4, maxChars = 26 } = {}) {
  const out = [];
  for (const s of segs) {
    const words = (s.text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const dur = Math.max(0.2, s.end - s.start);
    const totalChars = words.reduce((a, w) => a + w.length + 1, 0);
    let t = s.start;
    let cur = [];
    let curChars = 0;
    const flush = () => {
      if (!cur.length) return;
      const len = cur.reduce((a, w) => a + w.length + 1, 0);
      const d = (len / totalChars) * dur;
      out.push({ start: t, end: t + d, text: cur.join(' '), words: cur.slice() });
      t += d;
      cur = [];
      curChars = 0;
    };
    for (const w of words) {
      if (cur.length >= maxWords || (curChars + w.length > maxChars && cur.length)) flush();
      cur.push(w);
      curChars += w.length + 1;
    }
    flush();
  }
  return out;
}

module.exports = { stamp, clock, toSRT, toVTT, toTXT, toCSV, toJSON, toLRC, format, parseTime, parseSRTorVTT, dedupeRolling, parseLRC, parseSBV, parseCSV, parseAny, captionChunks };
