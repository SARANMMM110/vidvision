// Vid Vision — renderer entry.
import { html, render, useEffect, useState, useStore, setState, state, call, go, toast, refreshAuth, refreshAi, openUrl } from './lib.js';
import { Icon, Button, JobTray, Toasts, Locked, Spinner } from './ui.js';
import { Login } from './views/login.js';
import { Home } from './views/home.js';
import { Settings } from './views/settings.js';
import { Account, HelpFeedback } from './views/account.js';
import { Agency, WhiteLabel } from './views/business.js';
import * as V from './views/vision.js';
import * as VO from './views/voice.js';
import * as S from './views/scribe.js';
import { Mark, brandName } from './brand.js';

const NAV = [
  { key: 'home', label: 'Home', icon: 'home' },
  { module: 'vision', label: 'Vision Engine', items: [
    ['vision.discover', 'Discover', 'search', V.Discover],
    ['vision.projects', 'Analysis', 'eye', V.Projects],
    ['vision.findings', 'Findings', 'flag', V.Findings],
    ['vision.assets', 'Assets', 'grid', V.Assets],
    ['vision.clips', 'Clips', 'scissors', V.Clips],
    ['vision.docs', 'Documents', 'doc', V.Documents],
    ['vision.posts', 'Posts', 'share', V.Posts],
    ['vision.images', 'Images', 'image', V.Images],
    ['vision.chat', 'Chat', 'chat', V.Chat],
    ['vision.export', 'Export knowledge', 'export', V.ExportKnowledge],
  ] },
  { module: 'voice', label: 'Voice Engine', items: [
    ['voice.tts', 'Quick TTS', 'wave', VO.QuickTTS],
    ['voice.clone', 'Voice clone', 'clone', VO.VoiceClone],
    ['voice.lab', 'Voice lab', 'sparkle', VO.VoiceLab],
    ['voice.studio', 'Studio', 'studio', VO.Studio],
    ['voice.books', 'Audiobooks', 'book', VO.Audiobooks],
    ['voice.voices', 'Voice library', 'users', VO.VoiceLibrary],
    ['voice.audio', 'Audio library', 'music', VO.AudioLibrary],
  ] },
  { module: 'scribe', label: 'Scribe Engine', items: [
    ['scribe.single', 'Transcribe', 'pen', S.Single],
    ['scribe.bulk', 'Bulk transcribe', 'layers', S.Bulk],
    ['scribe.translate', 'Translate', 'globe', S.Translate],
    ['scribe.prompts', 'Prompt library', 'prompt', S.Prompts],
    ['scribe.downloader', 'Downloader', 'download', S.Downloader],
    ['scribe.extractor', 'Link extractor', 'link', S.Extractor],
  ] },
];

const EXTRA = {
  'vision.video': V.VideoWorkspace,
  'voice.studioEdit': VO.StudioEditor,
  'voice.bookEdit': VO.BookEditor,
  'scribe.editor': S.Editor,
};

function findRoute(path) {
  for (const g of NAV) for (const it of g.items || []) if (it[0] === path) return { module: g.module, Comp: it[3], label: it[1] };
  if (EXTRA[path]) return { module: path.split('.')[0], Comp: EXTRA[path] };
  return null;
}

function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return 1; if ((pa[i] || 0) < (pb[i] || 0)) return -1; }
  return 0;
}

function applyBrand(auth, info) {
  const b = auth && auth.brand;
  const cfg = (info && info.config) || {};
  const primary = (b && b.primary_color) || cfg.primaryColor || '#6d5efc';
  const accent = (b && b.accent_color) || cfg.accentColor || '#22d3ee';
  document.documentElement.style.setProperty('--brand', primary);
  document.documentElement.style.setProperty('--brand-2', accent);
  document.title = (b && b.app_name) || cfg.appName || 'Vid Vision';
}

function Sidebar() {
  const route = useStore((s) => s.route.path);
  const auth = useStore((s) => s.auth);
  const mods = (auth && auth.modules) || [];
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem('ame.nav') || '{}'); } catch (_) { return {}; } });
  const toggle = (m) => { const n = Object.assign({}, collapsed, { [m]: !collapsed[m] }); setCollapsed(n); localStorage.setItem('ame.nav', JSON.stringify(n)); };
  const item = (key, label, icon, mod) => html`<button class=${'nav-item ' + (route === key || route.startsWith(key + '.') || (key === 'vision.projects' && route === 'vision.video') || (key === 'voice.studio' && route === 'voice.studioEdit') || (key === 'voice.books' && route === 'voice.bookEdit') || (key === 'scribe.bulk' && route === 'scribe.editor') ? 'on' : '')} onClick=${() => go(key)}><${Icon} name=${icon} size=${17} /><span>${label}</span></button>`;
  return html`<nav class="sidebar" aria-label="Main">
    <div class="brand"><${Mark} /><span class="brand-name">${brandName()}</span></div>
    <div class="nav-scroll">
      ${item('home', 'Home', 'home')}
      ${NAV.filter((g) => g.module).map((g) => {
        const owned = mods.includes(g.module);
        return html`<div class=${'nav-group mod-' + g.module + (owned ? '' : ' locked')}>
          <button class="nav-group-head" onClick=${() => toggle(g.module)} aria-expanded=${!collapsed[g.module]}>
            <span class="mod-dot" /><span>${g.label}</span>${owned ? null : html`<${Icon} name="lock" size=${13} />`}<${Icon} name="chevron" size=${14} cls=${collapsed[g.module] ? '' : 'rot90'} />
          </button>
          ${collapsed[g.module] ? null : g.items.map((it) => item(it[0], it[1], it[2]))}
        </div>`;
      })}
      ${mods.includes('agency') || mods.includes('whitelabel') ? html`<div class="nav-group nav-business">
        <div class="nav-group-head static"><span>Business</span></div>
        ${mods.includes('agency') ? item('agency', 'Agency', 'users') : null}
        ${mods.includes('whitelabel') ? item('whitelabel', 'White Label', 'brush') : null}
      </div>` : null}
    </div>
    <div class="nav-foot">
      <${AiMeter} />
      ${item('settings', 'Settings', 'gear')}
      ${item('account', 'Account', 'user')}
      ${item('help', 'Help & feedback', 'help')}
    </div>
  </nav>`;
}

/** Built-in AI credits left this month (sidebar). Click opens Settings → Built-in AI. */
export function AiMeter() {
  const ai = useStore((s) => s.ai);
  const route = useStore((s) => s.route.path);
  const priv = useStore((s) => s.info && s.info.privateMode);
  if (priv) {
    return html`<button class=${'ai-meter private' + (route === 'settings' ? ' on' : '')} onClick=${() => go('settings', { tab: 'builtin' })} title="Private mode: AI runs only on this computer">
      <span class="ai-meter-row"><${Icon} name="lock" size=${15} /><span class="ai-meter-label">Private mode</span></span>
      <span class="ai-meter-sub">AI runs on this computer</span>
    </button>`;
  }
  if (!ai || !ai.enabled || !ai.usage || ai.usage.monthly === undefined) return null;
  const u = ai.usage;
  if (u.unlimited && !(u.user_cap > 0)) {
    const nearFair = u.fair > 0 && u.monthly_used >= u.fair * 0.9;
    return html`<button class=${'ai-meter' + (nearFair ? ' low' : '') + (route === 'settings' ? ' on' : '')} onClick=${() => go('settings', { tab: 'builtin' })} title="Unlimited AI (fair use)">
      <span class="ai-meter-row"><${Icon} name="sparkle" size=${15} /><span class="ai-meter-label">AI</span><b>Unlimited</b></span>
      <span class="ai-meter-sub">${nearFair ? 'Near this month’s fair-use limit' : 'Fair use'}</span>
    </button>`;
  }
  const total = Math.max(1, (u.user_cap > 0 ? u.user_cap : (u.monthly || 0) + (u.extra || 0)));
  const left = Math.max(0, u.remaining || 0);
  const pct = Math.min(100, Math.round((left / total) * 100));
  const low = pct <= 10;
  const resets = u.resets_at ? new Date(u.resets_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return html`<button class=${'ai-meter' + (low ? ' low' : '') + (route === 'settings' ? ' on' : '')} onClick=${() => go('settings', { tab: 'builtin' })} title="AI credits for this month">
    <span class="ai-meter-row"><${Icon} name="sparkle" size=${15} /><span class="ai-meter-label">AI credits</span><b>${left.toLocaleString()}</b></span>
    <span class="ai-meter-bar" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><i style=${{ width: pct + '%' }} /></span>
    <span class="ai-meter-sub">${left === 0 ? 'None left' : low ? 'Running low' : 'left'}${resets ? ` · resets ${resets}` : ''}</span>
  </button>`;
}

function UpdateBanner() {
  const auth = useStore((s) => s.auth);
  const info = useStore((s) => s.info);
  const [hide, setHide] = useState(false);
  const latest = auth && auth.config && auth.config.latest;
  if (!latest || !info || hide) return null;
  if (cmpVer(latest.version, info.version) <= 0) return null;
  return html`<div class="update-banner"><${Icon} name="download" /><span>Version ${latest.version} is available (you have ${info.version}).</span>
    ${latest.download_url ? html`<${Button} size="sm" kind="primary" onClick=${() => openUrl(latest.download_url)}>Download update</${Button}>` : null}
    <button class="link-btn" onClick=${() => setHide(true)}>Later</button></div>`;
}

function OfflineBanner() {
  const auth = useStore((s) => s.auth);
  if (!auth || !auth.offline) return null;
  return html`<div class="update-banner warn"><${Icon} name="info" /><span>Working offline — could not reach the licence server. Your access stays active for a few days.</span><button class="link-btn" onClick=${() => call('auth.refresh')}>Retry</button></div>`;
}

function Shell() {
  const route = useStore((s) => s.route);
  const auth = useStore((s) => s.auth);
  const info = useStore((s) => s.info);
  const latest = auth && auth.config && auth.config.latest;
  if (latest && latest.min_version && info && cmpVer(info.version, latest.min_version) < 0) {
    return html`<div class="center-screen"><div class="login-card"><h1>Update required</h1><p class="muted">This version (${info.version}) is no longer supported. Please install version ${latest.version}.</p>${latest.download_url ? html`<${Button} kind="primary" onClick=${() => openUrl(latest.download_url)}>Download update</${Button}>` : null}</div></div>`;
  }
  let body;
  const p = route.path;
  if (p === 'home') body = html`<${Home} />`;
  else if (p === 'settings') body = html`<${Settings} tab=${route.params.tab} />`;
  else if (p === 'account') body = html`<${Account} />`;
  else if (p === 'help') body = html`<${HelpFeedback} />`;
  else if (p === 'agency') body = auth.modules.includes('agency') ? html`<${Agency} />` : html`<${Locked} module="agency" name="Agency" />`;
  else if (p === 'whitelabel') body = auth.modules.includes('whitelabel') ? html`<${WhiteLabel} />` : html`<${Locked} module="whitelabel" name="White Label" />`;
  else {
    const r = findRoute(p);
    if (!r) body = html`<${Home} />`;
    else if (!auth.modules.includes(r.module)) body = html`<${Locked} module=${r.module} name=${r.module} />`;
    else body = html`<${r.Comp} ...${route.params} key=${p + JSON.stringify(route.params)} />`;
  }
  return html`<div class="app">
    <${Sidebar} />
    <main class=${'main ' + (/^(vision|voice|scribe)\./.test(p) ? 'mod-' + p.split('.')[0] : '')}><${OfflineBanner} /><${UpdateBanner} /><div class="main-scroll">${body}</div></main>
    <${JobTray} /><${Toasts} />
  </div>`;
}

function Root() {
  const auth = useStore((s) => s.auth);
  const info = useStore((s) => s.info);
  useEffect(() => { applyBrand(auth, info); }, [auth, info]);
  const signedIn = Boolean(auth && auth.signedIn);
  useEffect(() => {
    if (!signedIn) { setState({ ai: null }); return undefined; }
    refreshAi();
    const t = setInterval(() => refreshAi(), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [signedIn]);
  if (!auth || !info) return html`<div class="center-screen"><${Spinner} label="Starting…" /></div>`;
  if (!auth.signedIn) return html`<${Login} /><${Toasts} />`;
  return html`<${Shell} />`;
}

async function boot() {
  try {
    const [info, auth] = await Promise.all([call('app.info'), call('auth.status')]);
    setState({ info, auth });
    if (!auth.config) call('auth.config').then(() => refreshAuth()).catch(() => {});
  } catch (e) {
    toast('Could not start: ' + e.message, 'error');
  }
}

window.addEventListener('error', (e) => { if (e && e.message && !/ResizeObserver/.test(e.message)) console.error(e.error || e.message); });
render(html`<${Root} />`, document.getElementById('root'));
boot();
