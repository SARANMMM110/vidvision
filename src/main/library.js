'use strict';
// JSON-indexed libraries: Audio Library, Voice Library, custom prompts; backup/restore.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');
const store = require('./store');
const media = require('./media');
const net = require('./util/net');

function collection(dirFn, fileName) {
  const file = () => path.join(dirFn(), fileName);
  const read = () => store.readJson(file(), []);
  const write = (list) => store.writeJsonAtomic(file(), list);
  return {
    file,
    list: () => read(),
    get: (id) => read().find((x) => x.id === id) || null,
    add(item) {
      const list = read();
      const it = Object.assign({ id: crypto.randomUUID(), created: Date.now() }, item);
      list.unshift(it);
      write(list);
      return it;
    },
    update(id, patch) {
      const list = read();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) throw new Error('Item not found');
      list[i] = Object.assign({}, list[i], patch, { id });
      write(list);
      return list[i];
    },
    remove(id) {
      const list = read();
      const it = list.find((x) => x.id === id);
      write(list.filter((x) => x.id !== id));
      return it;
    },
    replaceAll: write,
  };
}

const audio = collection(P.audioLibrary, 'library.json');
const voices = collection(P.voiceLibrary, 'voices.json');
const styles = collection(P.voiceLibrary, 'styles.json');
const descriptions = collection(P.voiceLibrary, 'descriptions.json');
const prompts = collection(P.userData, 'prompts.json');

function safeName(s) { return String(s || 'audio').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'audio'; }

/** Copy a rendered file into the Audio Library and index it. */
async function addAudio(src, meta = {}) {
  const ext = path.extname(src) || '.mp3';
  const name = `${safeName(meta.title)}_${Date.now().toString(36)}${ext}`;
  const dest = path.join(P.audioLibrary(), name);
  fs.copyFileSync(src, dest);
  const duration = await media.duration(dest);
  return audio.add(Object.assign({ title: meta.title || 'Untitled', tags: [] }, meta, { file: dest, format: ext.slice(1), duration, size: fs.statSync(dest).size }));
}

function removeAudio(id) {
  const it = audio.remove(id);
  if (it && it.file && it.file.startsWith(P.audioLibrary())) { try { fs.unlinkSync(it.file); } catch (_) { /* ignore */ } }
  return audio.list();
}

function removeVoice(id) {
  const it = voices.remove(id);
  if (it && it.sample && it.sample.startsWith(P.voiceLibrary())) { try { fs.unlinkSync(it.sample); } catch (_) { /* ignore */ } }
  return voices.list();
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/** Backup libraries, studio projects, prompts and settings (not API keys) to one zip. */
async function backup(outFile) {
  const ws = P.workspace();
  const entries = [];
  for (const dir of [P.audioLibrary(), P.voiceLibrary(), P.studioProjects()]) {
    for (const f of walk(dir)) entries.push({ path: f, name: path.relative(ws, f).split(path.sep).join('/') });
  }
  const settings = Object.assign({}, store.getSettings());
  delete settings.serverUrl;
  entries.push({ buffer: Buffer.from(JSON.stringify(settings, null, 2)), name: '_meta/settings.json' });
  entries.push({ buffer: Buffer.from(JSON.stringify(prompts.list(), null, 2)), name: '_meta/prompts.json' });
  entries.push({ buffer: Buffer.from(JSON.stringify({ app: 'Vid Vision', created: new Date().toISOString(), workspace: ws }, null, 2)), name: '_meta/backup.json' });
  await net.zipFiles(entries, outFile);
  return { file: outFile, files: entries.length };
}

/** Restore a backup zip (merges libraries; rewrites stored file paths to this computer). */
async function restore(zipFile) {
  const tmp = P.tempDir('restore');
  await net.unzip(zipFile, tmp);
  const metaFile = path.join(tmp, '_meta', 'backup.json');
  if (!fs.existsSync(metaFile)) throw new Error('This is not an Vid Vision backup.');
  const oldWs = store.readJson(metaFile, {}).workspace || '';
  const ws = P.workspace();
  for (const f of walk(tmp)) {
    const rel = path.relative(tmp, f);
    if (rel.startsWith('_meta')) continue;
    const dest = path.join(ws, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (/\.json$/.test(f) && fs.existsSync(dest) && /(library|voices)\.json$/.test(f)) continue; // merged below
    fs.copyFileSync(f, dest);
  }
  const fix = (p) => (p && oldWs && p.startsWith(oldWs) ? path.join(ws, path.relative(oldWs, p)) : p);
  const merge = (coll, rel, fields) => {
    const incoming = store.readJson(path.join(tmp, rel), []);
    const current = coll.list();
    const ids = new Set(current.map((x) => x.id));
    for (const it of incoming) {
      if (ids.has(it.id)) continue;
      for (const k of fields) if (it[k]) it[k] = fix(it[k]);
      current.push(it);
    }
    coll.replaceAll(current);
    return incoming.length;
  };
  const a = merge(audio, path.join(path.relative(ws, P.audioLibrary()), 'library.json'), ['file']);
  const v = merge(voices, path.join(path.relative(ws, P.voiceLibrary()), 'voices.json'), ['sample']);
  const pr = store.readJson(path.join(tmp, '_meta', 'prompts.json'), []);
  const cur = prompts.list();
  const have = new Set(cur.map((x) => x.id));
  prompts.replaceAll(cur.concat(pr.filter((x) => !have.has(x.id))));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { audio: a, voices: v, prompts: pr.length };
}

module.exports = { collection, audio, voices, styles, descriptions, prompts, addAudio, removeAudio, removeVoice, backup, restore, safeName };
