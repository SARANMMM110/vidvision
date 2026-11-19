'use strict';
// Vid Vision — Electron main process.
const { app, BrowserWindow, ipcMain, protocol, dialog, shell, clipboard, Menu, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const P = require('./paths');
const store = require('./store');
const license = require('./license');
const ipc = require('./ipc');
const bins = require('./bins');
const engines = require('./engines');
const llm = require('./llm');
const tts = require('./tts');
const tr = require('./transcribe');
const wp = require('./wordpress');
const lib = require('./library');
const sounds = require('./sounds');
const vision = require('./modules/vision');
const voice = require('./modules/voice');
const scribe = require('./modules/scribe');
const appCfg = require('./appconfig');
const cloud = require('./cloud');

const RENDERER_DIR = path.join(__dirname, '..', '..', 'dist', 'renderer');
const handle = ipc.handle;
let mainWin = null;

app.setName(appCfg.appName);
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'basic');
if (process.env.AME_HOME) app.setPath('userData', process.env.AME_HOME);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } },
]);

// ------------------------------------------------------------ local media allowlist
const allowed = new Set();
const MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpg|mpeg|3gp|ts|mp3|m4a|m4b|wav|flac|ogg|oga|opus|aac|wma|aiff?|jpe?g|png|webp|gif|svg|pdf|html?)$/i;
function rootsOk(f) {
  const roots = [P.userData(), P.workspace(), P.exports(), P.models(), P.temp()];
  const r = path.resolve(f);
  return roots.some((root) => r.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep) || r.toLowerCase() === path.resolve(root).toLowerCase());
}
function allow(f) { if (typeof f === 'string' && f.length < 1024 && path.isAbsolute(f)) allowed.add(path.resolve(f)); }
function scanAllow(obj, depth = 0) {
  if (depth > 7 || obj == null) return;
  if (typeof obj === 'string') { if (MEDIA_EXT.test(obj) && path.isAbsolute(obj)) allow(obj); return; }
  if (Array.isArray(obj)) { for (const x of obj.slice(0, 5000)) scanAllow(x, depth + 1); return; }
  if (typeof obj === 'object') for (const k of Object.keys(obj)) scanAllow(obj[k], depth + 1);
}

function mimeFor(f) {
  const e = path.extname(f).slice(1).toLowerCase();
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm', woff2: 'font/woff2', ttf: 'font/ttf', ico: 'image/x-icon' })[e] || 'application/octet-stream';
}

function fileResponse(file, request, extraHeaders = {}) {
  let st;
  try { st = fs.statSync(file); } catch (_) { return new Response('Not found', { status: 404 }); }
  if (!st.isFile()) return new Response('Not found', { status: 404 });
  const type = mimeFor(file);
  const range = request.headers.get('range');
  const base = Object.assign({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }, extraHeaders);
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : st.size - 1;
    if (m && !m[1] && m[2]) { start = Math.max(0, st.size - Number(m[2])); end = st.size - 1; }
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(stream, { status: 206, headers: Object.assign(base, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) }) });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: Object.assign(base, { 'Content-Length': String(st.size) }) });
}

function appHandler(request) {
  {
    const u = new URL(request.url);
    if (u.host !== 'renderer') return new Response('Not found', { status: 404 });
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(RENDERER_DIR, rel);
    if (!file.startsWith(path.resolve(RENDERER_DIR))) return new Response('Forbidden', { status: 403 });
    const iso = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };
    return fileResponse(file, request, rel === 'engine.html' || rel.startsWith('vendor/') || rel.startsWith('engine') ? iso : {});
  }
}

function registerProtocols() {
  protocol.handle('app', appHandler);
  // The local-AI engine window runs in its own persistent session; give it the app:// scheme too.
  require('electron').session.fromPartition('persist:engine').protocol.handle('app', appHandler);
  protocol.handle('media', (request) => {
    const u = new URL(request.url);
    const f = path.resolve(decodeURIComponent(u.pathname.replace(/^\/+/, '')));
    if (!(allowed.has(f) || rootsOk(f)) || !MEDIA_EXT.test(f)) return new Response('Forbidden', { status: 403 });
    return fileResponse(f, request, { 'Cross-Origin-Resource-Policy': 'cross-origin' });
  });
}

// ------------------------------------------------------------ window
function createWindow() {
  const brand = license.status().brand;
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0d18',
    title: (brand && brand.app_name) || appCfg.appName,
    icon: path.join(__dirname, '..', '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  mainWin.loadURL('app://renderer/index.html');
  ipc.setSender(mainWin.webContents);
}

// ------------------------------------------------------------ IPC: core
function core() {
  handle('app.info', () => ({
    version: license.APP_VERSION,
    platform: process.platform,
    config: appCfg,
    paths: { workspace: P.workspace(), exports: P.exports(), userData: P.userData(), models: P.models() },
    bins: bins.status(),
    advanced: cloud.advanced(),
    privateMode: Boolean(store.getSettings().privateMode),
    ai: { enabled: cloud.enabled() },
  }), { public: true });

  handle('auth.status', () => license.status(), { public: true });
  handle('auth.login', ({ email, password }) => license.login(String(email || '').trim(), String(password || '')), { public: true });
  handle('auth.logout', () => license.logout(), { public: true });
  handle('auth.refresh', () => license.refresh(), { public: true });
  handle('auth.forgot', ({ email }) => license.forgot(email), { public: true });
  handle('auth.setServer', ({ url }) => { store.setSettings({ serverUrl: String(url || '').trim() }); return license.fetchConfig().then(() => license.status()); }, { public: true });
  handle('auth.config', () => license.fetchConfig(), { public: true });

  handle('account.devices', () => license.api('devices'), { module: 'any' });
  handle('account.removeDevice', ({ id }) => license.api('devices/' + Number(id), { method: 'DELETE' }), { module: 'any' });
  handle('account.password', ({ current, password }) => license.api('account/password', { body: { current, password } }), { module: 'any' });
  handle('feedback.send', ({ kind, message }) => license.api('feedback', { body: { kind, message, app_version: license.APP_VERSION, os: `${process.platform} ${require('os').release()}` } }), { module: 'any' });

  // Agency + White Label (server-side dashboards, mirrored in-app)
  handle('agency.list', () => license.api('agency/clients'), { module: 'agency' });
  handle('agency.create', (b) => license.api('agency/clients', { body: b }), { module: 'agency' });
  handle('agency.update', (b) => license.api('agency/clients/' + Number(b.id), { body: b }), { module: 'agency' });
  handle('agency.delete', ({ id }) => license.api('agency/clients/' + Number(id), { method: 'DELETE' }), { module: 'agency' });
  handle('wl.brand', () => license.api('wl/brand'), { module: 'whitelabel' });
  handle('wl.saveBrand', (b) => license.api('wl/brand', { body: b }), { module: 'whitelabel' });
  handle('wl.customers', () => license.api('wl/customers'), { module: 'whitelabel' });
  handle('wl.createCustomer', (b) => license.api('wl/customers', { body: b }), { module: 'whitelabel' });
  handle('wl.updateCustomer', (b) => license.api('wl/customers/' + Number(b.id), { body: b }), { module: 'whitelabel' });
  handle('wl.deleteCustomer', ({ id }) => license.api('wl/customers/' + Number(id), { method: 'DELETE' }), { module: 'whitelabel' });

  // Settings + keys
  handle('settings.get', () => ({ settings: store.getSettings(), keys: store.keyStatus(), masked: Object.fromEntries(store.SECRET_KEYS.map((k) => [k, store.maskedKey(k)])) }), { module: 'any' });
  handle('settings.set', ({ patch }) => { const s = store.setSettings(patch || {}); return { settings: s }; }, { module: 'any' });
  handle('keys.set', ({ key, value }) => { if (!store.SECRET_KEYS.includes(key)) throw new Error('Unknown key'); store.setSecret(key, String(value || '').trim()); return { keys: store.keyStatus(), masked: store.maskedKey(key) }; }, { module: 'any' });
  handle('keys.test', async ({ provider }) => {
    if (['openai', 'anthropic', 'gemini', 'openrouter', 'xai', 'mistral', 'deepseek', 'groq', 'custom', 'perplexity'].includes(provider)) {
      if (provider === 'perplexity') { const r = await llm.chat({ provider, model: store.getSettings().ai.models.perplexity || 'sonar', messages: [{ role: 'user', content: 'Say OK' }], maxTokens: 5 }); return { ok: true, detail: r.text.slice(0, 40) }; }
      const m = await llm.listModels(provider); return { ok: true, detail: `${m.length} models available` };
    }
    if (provider === 'elevenlabs') { const v = await tts.voices('elevenlabs'); return { ok: true, detail: `${v.length} voices` }; }
    if (provider === 'jamendo') { const r = await sounds.searchMusic('ambient', { limit: 1 }); return { ok: true, detail: r.length ? 'Connected' : 'No results' }; }
    if (provider === 'freesound') { const r = await sounds.searchSfx('whoosh', { limit: 1 }); return { ok: true, detail: r.length ? 'Connected' : 'No results' }; }
    return { ok: true, detail: 'Saved' };
  }, { module: 'any' });
  handle('ai.providers', () => {
    const adv = cloud.advanced();
    return Object.fromEntries(Object.entries(llm.PROVIDERS).filter(([k, v]) => adv || v.cloud || v.local).map(([k, v]) => [k, { label: v.label, vision: v.vision, local: Boolean(v.local), cloud: Boolean(v.cloud), ready: llm.ready(k) }]));
  }, { module: 'any' });
  // Built-in AI: status, credits, capabilities
  handle('ai.status', async ({ force } = {}) => {
    // "Refresh" re-reads the plan from the licence site too (e.g. right after buying a credit pack)
    if (force && cloud.enabled()) { try { await cloud.session(true); } catch (_) { /* reported via usage */ } }
    const enabled = cloud.enabled();
    const usage = enabled ? await cloud.usage(Boolean(force)) : { enabled: false };
    return { enabled: enabled && usage.enabled !== false, advanced: cloud.advanced(), usage, caps: usage.caps || (enabled ? await cloud.caps() : null), buyUrl: usage.buy_url || cloud.state.buyUrl || '' };
  }, { module: 'any' });
  handle('settings.advanced', ({ on }) => { store.setSettings({ advanced: Boolean(on) }); return { advanced: cloud.advanced() }; }, { module: 'any' });
  handle('ai.models', ({ provider }) => llm.listModels(provider), { module: 'any' });
  handle('discover.signIn', ({ site }) => require('./social').signIn(site, mainWin), { module: 'vision' });
  handle('discover.signOut', ({ site }) => require('./social').signOut(site), { module: 'vision' });
  handle('discover.signInStatus', () => require('./social').status(), { module: 'vision' });
  handle('ollama.status', () => bins.ollamaStatus(store.getSettings().ai.ollamaUrl), { module: 'any' });
  handle('ollama.catalog', () => {
    const extra = (bins.catalog().ollama || []).filter((m) => m && m.name && !llm.OLLAMA_CATALOG.some((x) => x.name === m.name)).map((m) => ({ name: String(m.name), label: String(m.label || m.name), kind: m.kind === 'vision' ? 'vision' : 'text', gb: Number(m.gb) || 0, note: String(m.note || ''), isNew: true }));
    return llm.OLLAMA_CATALOG.concat(extra);
  }, { module: 'any' });
  handle('ollama.hf', ({ url }, ctx) => { const name = bins.hfToOllama(url); return llm.ollamaPull(name, ctx).then(() => ({ name })); }, { module: 'any' });
  handle('whisper.addHf', ({ url }, ctx) => tr.addFromHf(url, ctx), { module: 'any' });
  handle('tools.list', () => bins.tools(), { module: 'any' });
  handle('tools.update', ({ id }, ctx) => bins.updateTool(id, ctx), { module: 'any' });
  handle('tools.revert', ({ id }) => bins.revertTool(id), { module: 'any' });
  handle('models.check', async () => {
    await license.fetchConfig();
    const c = bins.catalog();
    return { tools: await bins.tools({ check: true }), ollama: (c.ollama || []).length, whisper: (c.whisper || []).length, checked: Date.now() };
  }, { module: 'any' });
  handle('ollama.pull', ({ name }, ctx) => llm.ollamaPull(name, ctx), { module: 'any' });
  handle('ollama.delete', ({ name }) => llm.ollamaDelete(name), { module: 'any' });
  handle('ollama.install', (_p, ctx) => bins.installOllama(ctx), { module: 'any' });
  handle('whisper.models', () => tr.listModels(), { module: 'any' });
  handle('whisper.download', ({ id }, ctx) => tr.downloadModel(id, ctx).then(() => tr.listModels()), { module: 'any' });
  handle('whisper.delete', ({ id }) => tr.deleteModel(id), { module: 'any' });
  handle('whisper.import', ({ file }) => tr.importModel(file), { module: 'any' });
  handle('whisper.engine', ({ flavor }, ctx) => bins.ensureWhisper(flavor, ctx).then(() => bins.status()), { module: 'any' });
  handle('bins.status', () => bins.status(), { module: 'any' });
  handle('bins.updateYtdlp', (_p, ctx) => bins.updateYtdlp(ctx), { module: 'any' });
  handle('bins.ensure', async (_p, ctx) => { await bins.ffmpeg(ctx); await bins.ffprobe(ctx); await bins.ytdlp(ctx); return bins.status(); }, { module: 'any' });
  handle('engines.status', (_p, ctx) => engines.run('status', {}, ctx), { module: 'any' });
  handle('engines.clear', (_p, ctx) => engines.run('clear', {}, ctx), { module: 'any' });

  handle('wp.sites', () => wp.sites(), { module: 'any' });
  handle('wp.save', (b) => wp.saveSite(b), { module: 'any' });
  handle('wp.remove', ({ id }) => wp.removeSite(id), { module: 'any' });
  handle('wp.test', ({ id }) => wp.test(id), { module: 'any' });
  handle('wp.categories', ({ id }) => wp.categories(id), { module: 'any' });

  handle('library.backup', async ({ file }, ctx) => { ctx.progress(20, 'Creating backup…'); return lib.backup(file); }, { module: 'any' });
  handle('library.restore', async ({ file }, ctx) => { ctx.progress(20, 'Restoring…'); return lib.restore(file); }, { module: 'any' });

  // OS helpers
  handle('dialog.open', async ({ title, filters, multi, directory, defaultPath }) => {
    const r = await dialog.showOpenDialog(mainWin, { title, defaultPath, filters, properties: [directory ? 'openDirectory' : 'openFile'].concat(multi ? ['multiSelections'] : []) });
    if (r.canceled) return [];
    r.filePaths.forEach(allow);
    return r.filePaths;
  }, { public: true });
  handle('dialog.save', async ({ title, defaultPath, filters }) => {
    const r = await dialog.showSaveDialog(mainWin, { title, defaultPath, filters });
    if (r.canceled || !r.filePath) return '';
    allow(r.filePath);
    return r.filePath;
  }, { public: true });
  handle('shell.open', ({ url, file }) => { if (url && /^https?:\/\//.test(url)) return shell.openExternal(url); if (file) return shell.openPath(file); return null; }, { public: true });
  handle('shell.show', ({ file }) => { shell.showItemInFolder(file); return true; }, { public: true });
  handle('clipboard.write', ({ text }) => { clipboard.writeText(String(text || '')); return true; }, { public: true });
  handle('file.allow', ({ files }) => { (files || []).forEach(allow); return true; }, { public: true });
  handle('file.readText', ({ file }) => {
    const f = path.resolve(file);
    if (!(allowed.has(f) || rootsOk(f))) throw new Error('Not allowed');
    return fs.readFileSync(f, 'utf8').slice(0, 2000000);
  }, { module: 'any' });
  handle('recording.save', ({ buffer, ext }) => {
    const dir = P.ensure(path.join(P.workspace(), 'Recordings'));
    const file = path.join(dir, `Recording ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.${String(ext || 'webm').replace(/[^a-z0-9]/gi, '')}`);
    fs.writeFileSync(file, Buffer.from(buffer));
    allow(file);
    return { file };
  }, { module: 'any' });
  handle('file.writeText', ({ file, text }) => {
    const f = path.resolve(file);
    if (!(allowed.has(f) || rootsOk(f))) throw new Error('Choose where to save first.');
    fs.writeFileSync(f, String(text || ''));
    return f;
  }, { module: 'any' });
  handle('file.copy', ({ from, to }) => { fs.copyFileSync(from, to); allow(to); return to; }, { module: 'any' });
}

// ------------------------------------------------------------ IPC: modules
function modules() {
  const V = { module: 'vision' };
  const map = {
    'vision.projects': () => vision.listProjects(),
    'vision.createProject': vision.createProject,
    'vision.deleteProject': vision.deleteProject,
    'vision.renameProject': vision.renameProject,
    'vision.project': vision.getProject,
    'vision.video': vision.getVideo,
    'vision.addVideos': vision.addVideos,
    'vision.removeVideo': vision.removeVideo,
    'vision.process': vision.processVideo,
    'vision.report': vision.report,
    'vision.projectReport': vision.projectReport,
    'vision.translateReport': vision.translateReport,
    'vision.deleteReport': vision.deleteReport,
    'vision.geminiEstimate': vision.geminiEstimate,
    'vision.watchGemini': vision.watchGemini,
    'vision.findings': vision.findings,
    'vision.deleteFindings': vision.deleteFindings,
    'vision.assets': vision.assets,
    'vision.saveFullFrame': vision.saveFullFrame,
    'vision.findClips': vision.findClips,
    'vision.updateClip': vision.updateClip,
    'vision.renderClip': vision.renderClip,
    'vision.generateDoc': vision.generateDoc,
    'vision.updateDoc': vision.updateDoc,
    'vision.deleteDoc': vision.deleteDoc,
    'vision.exportDoc': vision.exportDoc,
    'vision.previewDoc': vision.previewDoc,
    'vision.translateDoc': vision.translateDoc,
    'vision.docOutline': vision.docOutline,
    'vision.docWrite': vision.docWrite,
    'vision.docSections': vision.docSections,
    'vision.docSection': vision.docSection,
    'vision.docSectionEdit': vision.docSectionEdit,
    'vision.docDiagram': vision.docDiagram,
    'vision.docInfographic': vision.docInfographic,
    'vision.docDesigns': () => ({ designs: require('./docs').DESIGNS, diagrams: Object.keys(vision.DIAGRAM_KINDS) }),
    'vision.generatePosts': vision.generatePosts,
    'vision.updatePosts': vision.updatePosts,
    'vision.publishWordPress': vision.publishWordPress,
    'vision.imagePrompt': vision.imagePrompt,
    'vision.generateImage': vision.generateImage,
    'vision.deleteImage': vision.deleteImage,
    'vision.chat': vision.chat,
    'vision.deleteChat': vision.deleteChat,
    'vision.exportKnowledge': vision.exportKnowledge,
    'vision.discover': vision.discover,
    'vision.discoverExport': vision.discoverExport,
    'vision.exportReport': vision.exportReport,
    'vision.clipCaption': vision.clipCaption,
    'vision.knowledgeNew': vision.knowledgeNew,
  };
  for (const [k, fn] of Object.entries(map)) handle(k, fn, V);

  const O = { module: 'voice' };
  const vm = {
    'voice.engines': () => voice.engineInfo(),
    'voice.voices': voice.voicesFor,
    'voice.preview': voice.preview,
    'voice.tts': voice.quickTTS,
    'voice.trim': voice.trimAudio,
    'voice.write': voice.writeScript,
    'voice.translate': voice.translateScript,
    'voice.sourceFromUrl': voice.sourceFromUrl,
    'voice.clone': voice.clone,
    'voice.design': voice.design,
    'voice.saveDesigned': voice.saveDesigned,
    'voice.designLocal': voice.designLocal,
    'voice.styleEnhance': voice.styleEnhance,
    'voice.styleAuto': voice.styleAuto,
    'voice.styleWrite': voice.styleWrite,
    'voice.styles': () => voice.styleList(),
    'voice.styleSave': voice.styleSave,
    'voice.styleDelete': voice.styleDelete,
    'voice.describeWrite': voice.describeWrite,
    'voice.descriptions': () => voice.descriptionList(),
    'voice.descriptionSave': voice.descriptionSave,
    'voice.descriptionDelete': voice.descriptionDelete,
    'voice.cutAudio': voice.cutAudio,
    'voice.audioTranscribe': voice.audioTranscribe,
    'voice.studioRestyle': voice.studioRestyle,
    'voice.saveLocalDesign': voice.saveLocalDesign,
    'voice.localPacks': () => require('./localvoice').status(),
    'voice.localPackInstall': ({ name }, ctx) => require('./localvoice').ensure(name, ctx).then(() => require('./localvoice').status()),
    'voice.localPackRemove': ({ name }) => require('./localvoice').remove(name),
    'voice.prompted': voice.promptedVoice,
    'voice.analyze': voice.analyzeAudio,
    'voice.piperVoices': () => tts.piperCatalog(),
    'voice.piperDownload': ({ id }, ctx) => tts.ensurePiperVoice(id, ctx).then(() => tts.piperCatalog()),
    'voice.library': () => lib.voices.list(),
    'voice.libraryAdd': ({ voice: v }) => lib.voices.add(v),
    'voice.libraryUpdate': ({ id, patch }) => lib.voices.update(id, patch),
    'voice.libraryRemove': async ({ id }) => {
      const v = lib.voices.get(id);
      // free the account's cloned-voice slot too (ignore if it is already gone on the server)
      if (v && v.engine === 'myvoices' && v.voice && !lib.voices.list().some((x) => x.id !== id && x.voice === v.voice)) {
        try { await tts.cloudDeleteVoice(v.voice); } catch (e) { if (e.status !== 404) console.warn('voice delete', e.message); }
      }
      return lib.removeVoice(id);
    },
    'voice.audio': () => lib.audio.list(),
    'voice.audioUpdate': ({ id, patch }) => lib.audio.update(id, patch),
    'voice.audioRemove': ({ id }) => lib.removeAudio(id),
    'voice.audioExport': async ({ id, format, file }, ctx) => { const it = lib.audio.get(id); if (!it) throw new Error('Not found'); await require('./media').convertAudio(it.file, file, format, ctx); return { file }; },
    'voice.audioImport': async ({ files }) => { for (const f of files) await lib.addAudio(f, { title: path.basename(f, path.extname(f)), source: 'import' }); return lib.audio.list(); },
    'voice.music': ({ q, tags }) => sounds.searchMusic(q, { tags }),
    'voice.sfx': ({ q }) => sounds.searchSfx(q),
    'voice.fetchAsset': ({ item }, ctx) => sounds.fetchAsset(item, ctx),
    'voice.sfxGenerate': async ({ prompt, seconds }, ctx) => { const f = path.join(P.ensure(path.join(P.cache(), 'sfx')), `ai_${Date.now()}.mp3`); await (tts.useOwnEleven() ? tts.elevenSfx({ prompt, seconds }, f, ctx) : tts.cloudSfx({ prompt, seconds }, f, ctx)); return { file: f }; },
    'voice.studioList': () => voice.studioList(),
    'voice.studioGet': voice.studioGet,
    'voice.studioSave': voice.studioSave,
    'voice.studioDelete': voice.studioDelete,
    'voice.studioWrite': voice.studioWrite,
    'voice.studioCast': voice.studioCast,
    'voice.studioStyleAll': voice.studioStyleAll,
    'voice.studioTranslate': voice.studioTranslate,
    'voice.studioImport': voice.studioImport,
    'voice.studioRenderLine': voice.studioRenderLine,
    'voice.studioRender': voice.studioRender,
    'voice.bookList': () => voice.bookList(),
    'voice.bookGet': voice.bookGet,
    'voice.bookSave': voice.bookSave,
    'voice.bookDelete': voice.bookDelete,
    'voice.bookImport': voice.bookImport,
    'voice.bookAnalyze': voice.bookAnalyze,
    'voice.bookRender': voice.bookRender,
    'voice.bookRenderSegment': voice.bookRenderSegment,
  };
  for (const [k, fn] of Object.entries(vm)) handle(k, fn, O);

  const S = { module: 'scribe' };
  const sm = {
    'scribe.projects': () => scribe.list(),
    'scribe.open': scribe.open,
    'scribe.create': scribe.create,
    'scribe.remove': scribe.remove,
    'scribe.rename': scribe.rename,
    'scribe.importProject': scribe.importProject,
    'scribe.exportProject': scribe.exportProject,
    'scribe.addItems': scribe.addItems,
    'scribe.updateRow': scribe.updateRow,
    'scribe.deleteRows': scribe.deleteRows,
    'scribe.transcribe': scribe.transcribeOne,
    'scribe.runBulk': scribe.runBulk,
    'scribe.saveRecording': scribe.saveRecording,
    'scribe.preview': scribe.preview,
    'scribe.export': scribe.exportRows,
    'scribe.exportGrid': scribe.exportGrid,
    'scribe.prompts': () => scribe.prompts(),
    'scribe.savePrompt': scribe.savePrompt,
    'scribe.deletePrompt': scribe.deletePrompt,
    'scribe.exportPrompts': scribe.exportPrompts,
    'scribe.importPrompts': scribe.importPrompts,
    'scribe.runPrompt': scribe.runPrompt,
    'scribe.combine': scribe.combineOutputs,
    'scribe.translateRows': scribe.translateRows,
    'scribe.translateFiles': scribe.translateFiles,
    'scribe.download': scribe.download,
    'scribe.extract': scribe.extractLinks,
  };
  for (const [k, fn] of Object.entries(sm)) handle(k, fn, S);
}

// Register any media paths returned to the renderer so media:// can serve them.
const origDispatch = ipc.dispatch;

function wireIpc() {
  ipcMain.handle('ame:invoke', async (event, channel, payload, jobId, label) => {
    ipc.setSender(event.sender);
    try {
      scanAllow(payload);
      const data = await origDispatch(channel, payload, jobId, label);
      scanAllow(data);
      return { ok: true, data };
    } catch (e) {
      if (process.env.AME_DEBUG) console.error('[ipc]', channel, e);
      return { ok: false, error: { message: (e && e.message) || String(e), code: (e && e.code) || 'error', module: e && e.module } };
    }
  });
  ipcMain.handle('ame:cancel', (_e, jobId) => ipc.cancel(jobId));
}

// ------------------------------------------------------------ lifecycle
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    // Windows: no menu bar. macOS needs the standard app + Edit menus for Cmd+C/V/Z/Q to work.
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    P.setOverrides(store.getSettings().folders);
    registerProtocols();
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(permission === 'media' || permission === 'clipboard-sanitized-write'));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' || permission === 'clipboard-sanitized-write');
    core();
    modules();
    wireIpc();
    engines.wire();
    license.onChange((st) => ipc.emit('auth', st));
    cloud.setEmitter((ev, d) => ipc.emit(ev, d));
    // warm up the built-in AI (token + capabilities) so the first request starts instantly
    license.onChange((st) => { if (st.signedIn && cloud.enabled()) cloud.session().then(() => cloud.caps()).catch(() => {}); });
    license.startTimer();
    createWindow();
    license.refresh().catch(() => {});
    // Clean stale temp files (older than 2 days).
    try {
      const t = P.temp();
      for (const f of fs.readdirSync(t)) {
        const p = path.join(t, f);
        if (Date.now() - fs.statSync(p).mtimeMs > 2 * 86400000) fs.rmSync(p, { recursive: true, force: true });
      }
    } catch (_) { /* ignore */ }
  });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length && app.isReady()) createWindow(); });
  app.on('window-all-closed', () => { engines.shutdown(); try { require('./localvoice').shutdown(); } catch (_) { /* ignore */ } app.quit(); });
}
