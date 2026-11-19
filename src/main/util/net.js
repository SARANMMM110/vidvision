'use strict';
// HTTP helpers: JSON calls with readable errors, file downloads with progress, zip extraction.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

function cancelled() { return Object.assign(new Error('Cancelled'), { code: 'cancelled' }); }

/** Pull a human-readable message out of any provider error body. */
function errorMessage(body, status) {
  if (!body) return `HTTP ${status}`;
  if (typeof body === 'string') return body.slice(0, 400);
  const e = body.error || body.detail || body;
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  if (e && e.detail && typeof e.detail.message === 'string') return e.detail.message;
  if (Array.isArray(body.detail) && body.detail[0] && body.detail[0].msg) return body.detail[0].msg;
  if (body.message) return String(body.message);
  return `HTTP ${status}`;
}

/**
 * fetch + JSON with provider-friendly errors.
 * @returns {Promise<any>}
 */
async function json(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, Object.assign({}, opts, { signal: opts.signal || AbortSignal.timeout(opts.timeout || 600000) }));
  } catch (e) {
    if (opts.signal && opts.signal.aborted) throw cancelled();
    throw Object.assign(new Error(`Network error contacting ${new URL(url).host}: ${e.message}`), { code: 'network' });
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (!res.ok) {
    const label = opts.label || new URL(url).host;
    throw Object.assign(new Error(`${label}: ${errorMessage(body, res.status)}`), { code: 'http', status: res.status, body });
  }
  return body;
}

/** fetch returning raw Buffer. */
async function buffer(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, Object.assign({}, opts, { signal: opts.signal || AbortSignal.timeout(opts.timeout || 600000) }));
  } catch (e) {
    if (opts.signal && opts.signal.aborted) throw cancelled();
    throw Object.assign(new Error(`Network error contacting ${new URL(url).host}: ${e.message}`), { code: 'network' });
  }
  if (!res.ok) {
    const t = await res.text();
    let b = t;
    try { b = JSON.parse(t); } catch (_) { /* text */ }
    throw Object.assign(new Error(`${opts.label || new URL(url).host}: ${errorMessage(b, res.status)}`), { code: 'http', status: res.status });
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Download a URL to a file with progress callback (bytes, total).
 */
async function download(url, dest, { signal, onProgress, headers } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  let res;
  try {
    res = await fetch(url, { signal, headers, redirect: 'follow' });
  } catch (e) {
    if (signal && signal.aborted) throw cancelled();
    throw Object.assign(new Error(`Download failed (${new URL(url).host}): ${e.message}`), { code: 'network' });
  }
  if (!res.ok || !res.body) throw Object.assign(new Error(`Download failed: HTTP ${res.status} for ${url}`), { code: 'http', status: res.status });
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let lastTick = 0;
  const src = Readable.fromWeb(res.body);
  src.on('data', (c) => {
    got += c.length;
    const now = Date.now();
    if (onProgress && now - lastTick > 150) { lastTick = now; onProgress(got, total); }
  });
  try {
    await pipeline(src, fs.createWriteStream(tmp), { signal });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    if (signal && signal.aborted) throw cancelled();
    throw e;
  }
  if (onProgress) onProgress(got, total || got);
  fs.renameSync(tmp, dest);
  return dest;
}

/** Extract a zip (streaming, low memory). */
function unzip(zipFile, destDir) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const root = path.resolve(destDir);
      zip.readEntry();
      zip.on('entry', (entry) => {
        const target = path.resolve(root, entry.fileName);
        if (!target.startsWith(root)) { zip.readEntry(); return; }
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(target, { recursive: true });
          zip.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (e2, rs) => {
          if (e2) return reject(e2);
          const ws = fs.createWriteStream(target);
          rs.on('end', () => zip.readEntry());
          rs.on('error', reject);
          rs.pipe(ws);
        });
      });
      zip.on('end', () => resolve(destDir));
      zip.on('error', reject);
    });
  });
}

/** Create a zip from a list of {path, name} (files) using yazl. */
function zipFiles(entries, outFile) {
  const yazl = require('yazl');
  return new Promise((resolve, reject) => {
    const z = new yazl.ZipFile();
    for (const e of entries) {
      if (e.buffer) z.addBuffer(e.buffer, e.name);
      else z.addFile(e.path, e.name);
    }
    z.end();
    const ws = fs.createWriteStream(outFile);
    z.outputStream.pipe(ws).on('close', () => resolve(outFile)).on('error', reject);
  });
}

module.exports = { json, buffer, download, unzip, zipFiles, errorMessage, cancelled };
