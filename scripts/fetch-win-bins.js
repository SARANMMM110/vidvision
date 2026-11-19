'use strict';
// Downloads the Windows ffmpeg/ffprobe binaries bundled with the installer (once).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const dir = path.join(__dirname, '..', 'resources', 'bin', 'win');
const BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['ffmpeg', 'ffprobe']) {
    const out = path.join(dir, name + '.exe');
    if (fs.existsSync(out) && fs.statSync(out).size > 1e7) { console.log(`${name}.exe present`); continue; }
    console.log(`downloading ${name}.exe…`);
    const res = await fetch(BASE + `${name}-win32-x64.gz`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), fs.createWriteStream(out));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
