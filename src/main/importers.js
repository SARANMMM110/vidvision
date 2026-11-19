'use strict';
// Import text from documents: .txt .md .docx .pdf .srt .vtt .lrc .sbv .csv .json
const fs = require('fs');
const path = require('path');
const subs = require('./subtitles');

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let last = null;
    let out = '';
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform ? it.transform[5] : null;
      if (last !== null && y !== null && Math.abs(y - last) > 4) out += '\n';
      else if (out && !out.endsWith(' ')) out += ' ';
      out += it.str;
      last = y;
    }
    pages.push(out.replace(/[ \t]+\n/g, '\n').trim());
  }
  return pages.join('\n\n');
}

async function docxText(file) {
  const mammoth = require('mammoth');
  const r = await mammoth.extractRawText({ path: file });
  return r.value;
}

/**
 * Read a document.
 * @returns {Promise<{text:string, segments:Array|null, ext:string, name:string}>}
 */
async function read(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const name = path.basename(file, path.extname(file));
  let text = '';
  let segments = null;
  if (ext === 'pdf') text = await pdfText(file);
  else if (ext === 'docx') text = await docxText(file);
  else {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    segments = subs.parseAny(raw, ext);
    text = segments ? segments.map((s) => s.text).join('\n') : raw;
  }
  return { text: text.replace(/\r/g, ''), segments, ext, name };
}

/** Split a manuscript into chapters by common headings. */
function chapters(text) {
  const lines = text.split('\n');
  const re = /^\s*(#{1,2}\s+.+|(chapter|chap\.|part|book|prologue|epilogue|introduction|preface)\b.{0,80}|[IVXLC]+\.\s+.{1,80})\s*$/i;
  const out = [];
  let cur = { title: 'Opening', lines: [] };
  for (const l of lines) {
    if (re.test(l) && l.trim().length < 100) {
      if (cur.lines.join('').trim()) out.push(cur);
      cur = { title: l.replace(/^#+\s*/, '').trim(), lines: [] };
    } else cur.lines.push(l);
  }
  if (cur.lines.join('').trim()) out.push(cur);
  const result = out.map((c) => ({ title: c.title, text: c.lines.join('\n').trim() })).filter((c) => c.text);
  if (result.length <= 1 && text.length > 20000) {
    // No headings: split every ~12k characters on paragraph boundaries.
    const paras = text.split(/\n{2,}/);
    const parts = [];
    let buf = '';
    for (const p of paras) { if ((buf + p).length > 12000 && buf) { parts.push(buf); buf = ''; } buf += p + '\n\n'; }
    if (buf.trim()) parts.push(buf);
    return parts.map((t, i) => ({ title: `Part ${i + 1}`, text: t.trim() }));
  }
  return result.length ? result : [{ title: 'Full text', text: text.trim() }];
}

module.exports = { read, chapters, pdfText, docxText };
