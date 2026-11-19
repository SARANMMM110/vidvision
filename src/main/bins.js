'use strict';
// External tools: ffmpeg/ffprobe (bundled), yt-dlp, whisper.cpp, piper (downloaded on demand), Ollama (detected/installed).
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const net = require('./util/net');
const proc = require('./util/proc');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const EXE = WIN ? '.exe' : '';
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const FFS = WIN ? 'win32-x64' : MAC ? `darwin-${ARCH}` : `linux-${ARCH}`;

const SOURCES = {
  ytdlp: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + (WIN ? 'yt-dlp.exe' : MAC ? 'yt-dlp_macos' : 'yt-dlp'),
  whisper: {
    cpu: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip',
    cuda: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip',
  },
  whisperVersion: 'v1.9.2',
  piper: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/' + (WIN ? 'piper_windows_amd64.zip' : MAC ? (ARCH === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz') : (ARCH === 'arm64' ? 'piper_linux_aarch64.tar.gz' : 'piper_linux_x86_64.tar.gz')),
  piperVersion: '2023.11.14-2',
  ffmpeg: `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-${FFS}.gz`,
  ffprobe: `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-${FFS}.gz`,
  ollamaSetup: 'https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe',
};

/** Unpack a .zip or .tar.gz into dir. */
async function unpack(file, dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (/\.zip$/i.test(file)) return net.unzip(file, dir);
  const r = await proc.run('tar', ['-xzf', file, '-C', dir]);
  if (r.code) throw new Error('Could not unpack ' + path.basename(file) + ': ' + (r.stderr || '').slice(0, 200));
  return dir;
}

function resourcesBin() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'bin'));
  candidates.push(path.join(__dirname, '..', '..', 'resources', 'bin', WIN ? 'win' : process.platform));
  return candidates;
}

function which(name) {
  // Apps started from the Dock/Finder don't inherit the shell PATH, so look in the Homebrew folders too.
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(MAC ? ['/opt/homebrew/bin', '/usr/local/bin'] : []);
  for (const d of dirs) {
    const f = path.join(d, name + EXE);
    try { if (fs.statSync(f).isFile()) return f; } catch (_) { /* next */ }
  }
  return '';
}

function exists(f) { try { return fs.statSync(f).isFile(); } catch (_) { return false; } }

/** Path to ffmpeg/ffprobe: env override → bundled → userData/bin → PATH. */
function ff(name) {
  const env = process.env['AME_' + name.toUpperCase()];
  if (env && exists(env)) return env;
  for (const d of resourcesBin()) { const f = path.join(d, name + EXE); if (exists(f)) return f; }
  const local = path.join(P.bin(), name + EXE);
  if (exists(local)) return local;
  return which(name);
}

async function ensureFf(name, ctx) {
  let f = ff(name);
  if (f) return f;
  if (!WIN && !MAC) throw new Error(`${name} was not found. Install ffmpeg and try again.`);
  const gz = path.join(P.bin(), name + '.gz');
  ctx && ctx.progress(0, `Downloading ${name}…`);
  await net.download(SOURCES[name], gz, { signal: ctx && ctx.signal, onProgress: (g, t) => ctx && ctx.progress(t ? (g / t) * 100 : 0, `Downloading ${name}… ${(g / 1e6).toFixed(0)} MB`) });
  const zlib = require('zlib');
  fs.writeFileSync(path.join(P.bin(), name + EXE), zlib.gunzipSync(fs.readFileSync(gz)));
  if (!WIN) fs.chmodSync(path.join(P.bin(), name + EXE), 0o755);
  fs.unlinkSync(gz);
  f = ff(name);
  return f;
}

const ffmpeg = (ctx) => ensureFf('ffmpeg', ctx);
const ffprobe = (ctx) => ensureFf('ffprobe', ctx);

// ---- yt-dlp
function ytdlpPath() {
  if (process.env.AME_YTDLP && exists(process.env.AME_YTDLP)) return process.env.AME_YTDLP;
  const local = path.join(P.bin(), 'yt-dlp' + EXE);
  if (exists(local)) return local;
  return which('yt-dlp');
}

async function ytdlp(ctx) {
  const f = ytdlpPath();
  if (f) return f;
  const dest = path.join(P.bin(), 'yt-dlp' + EXE);
  ctx && ctx.progress(0, 'Downloading the video downloader (yt-dlp)…');
  await net.download(SOURCES.ytdlp, dest, { signal: ctx && ctx.signal, onProgress: (g, t) => ctx && ctx.progress(t ? (g / t) * 100 : 0, `Downloading yt-dlp… ${(g / 1e6).toFixed(1)} MB`) });
  if (!WIN) fs.chmodSync(dest, 0o755);
  return dest;
}

async function updateYtdlp(ctx) {
  const f = await ytdlp(ctx);
  if (f !== path.join(P.bin(), 'yt-dlp' + EXE)) {
    const r = await proc.run(f, ['-U'], { signal: ctx && ctx.signal });
    return (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-2).join(' ');
  }
  const before = await currentVersion('ytdlp');
  const list = await updateTool('ytdlp', ctx);
  const now = (list.find((x) => x.id === 'ytdlp') || {}).version;
  return now && now !== before ? `Updated yt-dlp to ${now} (you can revert in Settings → Offline engines).` : `yt-dlp is up to date (${now || before}).`;
}

// ---- whisper.cpp
function whisperDir(flavor) { return path.join(P.bin(), 'whisper', flavor || 'cpu'); }

function findFile(dir, name) {
  if (!fs.existsSync(dir)) return '';
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.toLowerCase() === name.toLowerCase()) return p;
    }
  }
  return '';
}

function whisperCli(flavor) {
  if (process.env.AME_WHISPER_CLI && exists(process.env.AME_WHISPER_CLI)) return process.env.AME_WHISPER_CLI;
  return findFile(whisperDir(flavor), 'whisper-cli' + EXE) || (flavor === 'cuda' ? '' : which('whisper-cli'));
}

async function ensureWhisper(flavor, ctx) {
  flavor = flavor === 'cuda' ? 'cuda' : 'cpu';
  const f = whisperCli(flavor);
  if (f) return f;
  if (MAC && flavor === 'cpu') throw new Error('On a Mac, install the offline Whisper engine with Homebrew: open Terminal and run "brew install whisper-cpp", then try again. (The built-in AI transcription needs no install.)');
  if (!WIN) throw new Error(flavor === 'cuda' ? 'The NVIDIA engine is for Windows PCs.' : 'Set AME_WHISPER_CLI to a whisper-cli binary.');
  const zip = path.join(P.bin(), `whisper-${flavor}.zip`);
  ctx && ctx.progress(0, 'Downloading the local transcription engine…');
  await net.download(SOURCES.whisper[flavor], zip, { signal: ctx && ctx.signal, onProgress: (g, t) => ctx && ctx.progress(t ? (g / t) * 100 : 0, `Downloading Whisper engine… ${(g / 1e6).toFixed(0)} MB`) });
  ctx && ctx.progress(100, 'Unpacking…');
  await net.unzip(zip, whisperDir(flavor));
  fs.unlinkSync(zip);
  setVersion('whisper_' + flavor, SOURCES.whisperVersion);
  const out = whisperCli(flavor);
  if (!out) throw new Error('Whisper engine download did not contain whisper-cli.');
  return out;
}

// ---- piper
function piperPath() {
  if (process.env.AME_PIPER && exists(process.env.AME_PIPER)) return process.env.AME_PIPER;
  return findFile(path.join(P.bin(), 'piper'), 'piper' + EXE) || which('piper');
}

async function ensurePiper(ctx) {
  const f = piperPath();
  if (f) return f;
  const zip = path.join(P.bin(), path.basename(SOURCES.piper));
  ctx && ctx.progress(0, 'Downloading Piper voice engine…');
  await net.download(SOURCES.piper, zip, { signal: ctx && ctx.signal, onProgress: (g, t) => ctx && ctx.progress(t ? (g / t) * 100 : 0, `Downloading Piper… ${(g / 1e6).toFixed(0)} MB`) });
  await unpack(zip, path.join(P.bin(), 'piper'));
  fs.unlinkSync(zip);
  setVersion('piper', SOURCES.piperVersion);
  return piperPath();
}

// ---- Ollama
async function ollamaStatus(baseUrl) {
  try {
    const r = await fetch(baseUrl.replace(/\/+$/, '') + '/api/tags', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { running: false, models: [] };
    const j = await r.json();
    return { running: true, models: (j.models || []).map((m) => ({ name: m.name, size: m.size, family: m.details && m.details.family })) };
  } catch (_) {
    return { running: false, models: [] };
  }
}

async function installOllama(ctx) {
  if (!WIN) { await require('electron').shell.openExternal('https://ollama.com/download'); return { started: true, page: true }; }
  const dest = path.join(P.temp(), 'OllamaSetup.exe');
  await net.download(SOURCES.ollamaSetup, dest, { signal: ctx.signal, onProgress: (g, t) => ctx.progress(t ? (g / t) * 100 : 0, `Downloading Ollama… ${(g / 1e6).toFixed(0)} MB`) });
  ctx.progress(100, 'Starting the Ollama installer…');
  const { shell } = require('electron');
  await shell.openPath(dest);
  return { started: true };
}

function status() {
  return {
    ffmpeg: Boolean(ff('ffmpeg')),
    ffprobe: Boolean(ff('ffprobe')),
    ytdlp: Boolean(ytdlpPath()),
    whisperCpu: Boolean(whisperCli('cpu')),
    whisperCuda: Boolean(whisperCli('cuda')),
    piper: Boolean(piperPath()),
    platform: process.platform,
  };
}

// ---- tool versions, updates with one-step revert, and the vendor's model catalogue
const TOOLS = {
  ytdlp: { label: 'Video downloader (yt-dlp)', file: () => path.join(P.bin(), 'yt-dlp' + EXE), installed: () => exists(path.join(P.bin(), 'yt-dlp' + EXE)) },
  whisper_cpu: { label: 'Whisper engine (CPU)', dir: () => whisperDir('cpu'), installed: () => Boolean(findFile(whisperDir('cpu'), 'whisper-cli' + EXE)), win: true },
  whisper_cuda: { label: 'Whisper engine (NVIDIA)', dir: () => whisperDir('cuda'), installed: () => Boolean(findFile(whisperDir('cuda'), 'whisper-cli' + EXE)), win: true },
  piper: { label: 'Piper voice engine', dir: () => path.join(P.bin(), 'piper'), installed: () => Boolean(findFile(path.join(P.bin(), 'piper'), 'piper' + EXE)) },
};
const versionsFile = () => path.join(P.bin(), 'versions.json');
function versions() { try { return JSON.parse(fs.readFileSync(versionsFile(), 'utf8')); } catch (_) { return {}; } }
function setVersion(id, v) { const all = versions(); all[id] = v; try { fs.mkdirSync(P.bin(), { recursive: true }); fs.writeFileSync(versionsFile(), JSON.stringify(all, null, 1)); } catch (_) { /* ignore */ } }
function backupPath(id) { const t = TOOLS[id]; return path.join(P.bin(), 'backup', id, t.file ? path.basename(t.file()) : 'dir'); }
function hasBackup(id) { return fs.existsSync(backupPath(id)); }
function current(id) { const t = TOOLS[id]; return t.file ? t.file() : t.dir(); }

async function currentVersion(id) {
  const v = versions()[id];
  if (v) return v;
  if (id === 'ytdlp' && TOOLS.ytdlp.installed()) {
    try { const r = await proc.run(TOOLS.ytdlp.file(), ['--version'], { signal: AbortSignal.timeout(15000) }); const out = (r.stdout || '').trim(); if (out) { setVersion('ytdlp', out); return out; } } catch (_) { /* unknown */ }
  }
  if (id.startsWith('whisper') && TOOLS[id].installed()) return SOURCES.whisperVersion;
  if (id === 'piper' && TOOLS.piper.installed()) return SOURCES.piperVersion;
  return '';
}

/** Vendor catalogue (wp-admin → Settings → Desktop app → Model catalogue), delivered with the licence config. */
function catalog() {
  try { const c = require('./license').status().config; return (c && c.models && typeof c.models === 'object') ? c.models : {}; } catch (_) { return {}; }
}

async function gh(repo) { return net.json(`https://api.github.com/repos/${repo}/releases/latest`, { label: 'GitHub', timeout: 15000, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VidVision' } }); }

/** Newest download for a tool: the vendor catalogue wins, then the project's latest release. */
async function latest(id) {
  const tools = catalog().tools || {};
  if (tools[id]) return { url: String(tools[id]), version: String((catalog().tool_versions || {})[id] || path.basename(String(tools[id])).replace(/\.(zip|exe|tar\.gz)$/i, '')) };
  if (id === 'ytdlp') { const j = await gh('yt-dlp/yt-dlp'); return { version: j.tag_name, url: SOURCES.ytdlp.replace('/latest/download/', `/download/${j.tag_name}/`) }; }
  if (id.startsWith('whisper')) {
    const j = await gh('ggml-org/whisper.cpp');
    const want = id === 'whisper_cuda' ? /^whisper-cublas-12[\d.]*-bin-x64\.zip$/ : /^whisper-bin-x64\.zip$/;
    const a = (j.assets || []).find((x) => want.test(x.name));
    return a ? { version: j.tag_name, url: a.browser_download_url } : { version: SOURCES.whisperVersion, url: SOURCES.whisper[id === 'whisper_cuda' ? 'cuda' : 'cpu'] };
  }
  if (id === 'piper') return { version: SOURCES.piperVersion, url: SOURCES.piper };
  throw new Error('Unknown tool ' + id);
}

function newer(a, b) { return Boolean(a && b && String(a).replace(/^v/, '') !== String(b).replace(/^v/, '')); }

/** Installed tools with versions; check=true also asks for the newest versions. */
async function tools({ check } = {}) {
  const out = [];
  for (const [id, t] of Object.entries(TOOLS)) {
    if (t.win && !WIN) continue;
    const row = { id, label: t.label, installed: t.installed(), version: await currentVersion(id), canRevert: hasBackup(id), backupVersion: versions()[id + '_backup'] || '' };
    if (check && row.installed) {
      try { const l = await latest(id); row.latest = l.version; row.updateAvailable = newer(l.version, row.version); } catch (e) { row.checkError = e.message; }
    }
    out.push(row);
  }
  return out;
}

/** Update a tool, keeping the current version so it can be reverted in one click. */
async function updateTool(id, ctx, { force } = {}) {
  const t = TOOLS[id];
  if (!t) throw new Error('Unknown tool ' + id);
  if (!t.installed()) throw new Error(`${t.label} is not installed yet.`);
  const l = await latest(id);
  if (!force && !newer(l.version, await currentVersion(id))) return tools();
  const cur = current(id);
  const bak = backupPath(id);
  fs.rmSync(path.dirname(bak), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(bak), { recursive: true });
  fs.cpSync(cur, bak, { recursive: true });
  setVersion(id + '_backup', await currentVersion(id));
  const tmp = path.join(P.temp(), `${id}-${Date.now()}${/\.tar\.gz$/i.test(l.url) ? '.tar.gz' : path.extname(l.url) || ''}`);
  try {
    ctx && ctx.progress(0, `Downloading ${t.label} ${l.version}…`);
    await net.download(l.url, tmp, { signal: ctx && ctx.signal, onProgress: (g, tt) => ctx && ctx.progress(tt ? (g / tt) * 95 : 0, `Downloading ${t.label}… ${(g / 1e6).toFixed(1)} MB`) });
    if (t.file) { fs.copyFileSync(tmp, cur); if (!WIN) fs.chmodSync(cur, 0o755); } else { fs.rmSync(cur, { recursive: true, force: true }); await unpack(tmp, cur); }
    if (!t.installed()) throw new Error('The new download did not contain the expected program.');
    setVersion(id, l.version);
  } catch (e) {
    fs.rmSync(cur, { recursive: true, force: true });
    fs.cpSync(bak, cur, { recursive: true });
    throw Object.assign(new Error(`Update failed, kept ${t.label} ${versions()[id + '_backup'] || ''}: ${e.message}`), { code: e.code });
  } finally { fs.rmSync(tmp, { force: true }); }
  return tools();
}

/** Swap the current and previous version (revert, or undo a revert). */
function revertTool(id) {
  const t = TOOLS[id];
  if (!t || !hasBackup(id)) throw new Error('There is no previous version to go back to.');
  const cur = current(id);
  const bak = backupPath(id);
  const swap = bak + '.swap';
  fs.rmSync(swap, { recursive: true, force: true });
  if (fs.existsSync(cur)) fs.renameSync(cur, swap);
  fs.renameSync(bak, cur);
  if (fs.existsSync(swap)) fs.renameSync(swap, bak);
  const all = versions();
  [all[id], all[id + '_backup']] = [all[id + '_backup'] || '', all[id] || ''];
  fs.writeFileSync(versionsFile(), JSON.stringify(all, null, 1));
  return tools();
}

/**
 * Turn a Hugging Face link into an Ollama model name.
 * https://huggingface.co/user/repo · …/blob/main/model-Q4_K_M.gguf · hf.co/user/repo:Q5_K_M · user/repo
 */
function hfToOllama(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Paste a Hugging Face link.');
  if (/^(hf\.co|huggingface\.co)\/[\w.-]+\/[\w.-]+(:[\w.-]+)?$/i.test(s)) return s.replace(/^huggingface\.co/i, 'hf.co');
  let quant = '';
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\/([\w.-]+)\/([\w.-]+)(\/.*)?$/i) || s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error('That is not a Hugging Face model link. Example: https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF');
  const rest = m[3] || '';
  const q = rest.match(/[-_.]((?:I?Q\d(?:_[A-Z0-9]+)*)|F16|BF16|F32)\.gguf/i);
  if (q) quant = q[1].toUpperCase();
  const tag = rest.match(/:([\w.-]+)$/);
  if (!quant && tag) quant = tag[1];
  if (/\.(safetensors|bin|pt)$/i.test(rest)) throw new Error('Ollama needs a GGUF model. Look for a repository whose name ends in “-GGUF”.');
  return `hf.co/${m[1]}/${m[2]}${quant ? ':' + quant : ''}`;
}

/** Hugging Face file link → direct download URL (…/blob/… → …/resolve/…). */
function hfFileUrl(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\/([\w.-]+\/[\w.-]+)\/(?:blob|resolve)\/([^?#]+)/i);
  if (!m) throw new Error('Paste the link to a model file on Hugging Face (it contains /blob/ or /resolve/).');
  return { url: `https://huggingface.co/${m[1]}/resolve/${m[2]}`, name: decodeURIComponent(m[2].split('/').pop()) };
}

module.exports = { ffmpeg, ffprobe, ff, ytdlp, ytdlpPath, updateYtdlp, ensureWhisper, whisperCli, ensurePiper, piperPath, ollamaStatus, installOllama, status, SOURCES, findFile, unpack, tools, updateTool, revertTool, catalog, hfToOllama, hfFileUrl, versions };
