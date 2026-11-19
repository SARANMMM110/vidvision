'use strict';
// Downloads the macOS ffmpeg/ffprobe binaries bundled with the Mac app (Apple silicon and Intel), once.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';

(async () => {
  for (const arch of ['arm64', 'x64']) {
    const dir = path.join(__dirname, '..', 'resources', 'bin', 'mac-' + arch);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['ffmpeg', 'ffprobe']) {
      const out = path.join(dir, name);
      if (fs.existsSync(out) && fs.statSync(out).size > 1e7) { console.log(`${arch}/${name} present`); continue; }
      console.log(`downloading ${arch}/${name}…`);
      const res = await fetch(BASE + `${name}-darwin-${arch}.gz`);
      if (!res.ok) throw new Error(`${name} ${arch}: HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), fs.createWriteStream(out));
      fs.chmodSync(out, 0o755);
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
