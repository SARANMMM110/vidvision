import { html, useState, useStore, call, toast, setState, openUrl } from '../lib.js';
import { PageHeader, Button, Field, Select, Badge, Spinner, ErrorBox, useAsync, Confirm, Icon } from '../ui.js';

const NAMES = { vision: 'Vision Engine', voice: 'Voice Engine', scribe: 'Scribe Engine', agency: 'Agency', whitelabel: 'White Label' };

export function Account() {
  const auth = useStore((s) => s.auth);
  const p = auth.profile;
  const products = (auth.config && auth.config.products) || {};
  const dev = useAsync(() => call('account.devices'), []);
  const [pw, setPw] = useState({ current: '', password: '' });
  const [rm, setRm] = useState(null);
  const [out, setOut] = useState(false);
  return html`<div class="page">
    <${PageHeader} title="Account" sub=${`${p.user.name} — ${p.user.email}`}>
      <${Button} icon="refresh" onClick=${async () => { await call('auth.refresh'); toast('Access refreshed', 'ok'); }}>Refresh access</${Button}>
      <${Button} icon="logout" onClick=${() => setOut(true)}>Sign out</${Button}>
    </${PageHeader}>
    ${p.parent ? html`<p class="muted">Your account is managed by ${p.parent.name} (${p.parent.email}).</p>` : null}
    <div class="form-grid">
      <section class="panel">
        <h3>Your access</h3>
        <ul class="access">${Object.keys(NAMES).filter((k) => !auth.brand || ['vision', 'voice', 'scribe'].includes(k)).map((k) => html`<li>
          <span class=${'mod-dot mod-' + k} /><b>${(products[k] && products[k].name) || NAMES[k]}</b>
          ${p.modules.includes(k) ? html`<${Badge} kind="ok">Active</${Badge}>` : products[k] && products[k].sales_url ? html`<${Button} size="sm" onClick=${() => openUrl(products[k].sales_url)}>Get it</${Button}>` : html`<${Badge}>Not owned</${Badge}>`}
        </li>`)}</ul>
        ${auth.config && auth.config.dashboard_url ? html`<button class="link-btn" onClick=${() => openUrl(auth.config.dashboard_url)}>Open the member dashboard</button>` : null}
      </section>
      <section class="panel">
        <div class="row between"><h3>Installs</h3>${dev.data ? html`<span class="muted small">${dev.data.devices.length} of ${dev.data.limit} used</span>` : null}</div>
        <p class="muted small">Each computer you sign in on uses one install. Removing one signs that computer out.</p>
        ${dev.loading && !dev.data ? html`<${Spinner} />` : dev.error ? html`<${ErrorBox} error=${dev.error} retry=${dev.reload} />` : html`<div class="list">${dev.data.devices.map((d) => html`<div class="list-row">
          <${Icon} name="cpu" /><span class="list-main"><b>${d.device_name || 'Computer'}${d.current ? ' (this computer)' : ''}</b><span class="muted small">${d.os} — app ${d.app_version} — last seen ${d.last_seen} UTC</span></span>
          ${d.current ? null : html`<${Button} size="sm" onClick=${() => setRm(d)}>Remove</${Button}>`}</div>`)}</div>`}
      </section>
      <section class="panel">
        <h3>Change password</h3>
        <${Field} label="Current password"><input class="input" type="password" value=${pw.current} onInput=${(e) => setPw(Object.assign({}, pw, { current: e.target.value }))} /></${Field}>
        <${Field} label="New password" hint="At least 8 characters"><input class="input" type="password" value=${pw.password} onInput=${(e) => setPw(Object.assign({}, pw, { password: e.target.value }))} /></${Field}>
        <${Button} kind="primary" onClick=${async () => { try { await call('account.password', pw); toast('Password updated', 'ok'); setPw({ current: '', password: '' }); } catch (e) { toast(e.message, 'error'); } }}>Update password</${Button}>
      </section>
    </div>
    ${rm ? html`<${Confirm} title="Remove install?" text=${`${rm.device_name} will be signed out and the install freed.`} confirm="Remove" onClose=${() => setRm(null)} onYes=${async () => { try { dev.set(await call('account.removeDevice', { id: rm.id })); toast('Install removed', 'ok'); } catch (e) { toast(e.message, 'error'); } }} />` : null}
    ${out ? html`<${Confirm} title="Sign out?" text="This frees this computer's install. Your projects and files stay on this computer." confirm="Sign out" danger=${false} onClose=${() => setOut(false)} onYes=${async () => setState({ auth: await call('auth.logout') })} />` : null}
  </div>`;
}

export function HelpFeedback() {
  const auth = useStore((s) => s.auth);
  const info = useStore((s) => s.info);
  const cfg = auth.config || {};
  const links = cfg.help_links || {};
  const [kind, setKind] = useState('feature');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const support = (auth.brand && (auth.brand.support_url || (auth.brand.support_email && 'mailto:' + auth.brand.support_email))) || cfg.support_url || (cfg.support_email && 'mailto:' + cfg.support_email);
  const send = async () => {
    setBusy(true);
    try { await call('feedback.send', { kind, message: msg }); toast('Thanks — sent', 'ok'); setMsg(''); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const labels = { getting_started: 'Getting started', 'vision.discover': 'Discover', 'vision.analysis': 'Analyzing videos', 'vision.clips': 'Clips', 'vision.documents': 'Documents', 'vision.posts': 'Posts & WordPress', 'vision.images': 'Images', 'vision.chat': 'Chat', 'vision.export': 'Export knowledge', 'voice.tts': 'Quick TTS', 'voice.clone': 'Voice clone', 'voice.lab': 'Voice lab', 'voice.studio': 'Studio', 'voice.audiobooks': 'Audiobooks', 'scribe.single': 'Transcribe', 'scribe.bulk': 'Bulk transcribe', 'scribe.translate': 'Translate', 'scribe.prompts': 'Prompt library', 'settings.ai': 'Built-in AI and credits', 'settings.local': 'Offline engines', agency: 'Agency', whitelabel: 'White Label' };
  return html`<div class="page">
    <${PageHeader} title="Help & feedback" sub=${`Version ${info.version}`}>${support ? html`<${Button} icon="help" onClick=${() => openUrl(support)}>Contact support</${Button}>` : null}</${PageHeader}>
    <div class="form-grid">
      <section class="panel">
        <h3>Video tutorials</h3>
        ${Object.keys(links).length ? html`<div class="list">${Object.entries(links).map(([k, u]) => html`<button class="list-row link-row" onClick=${() => openUrl(u)}><${Icon} name="play" /><span class="list-main"><b>${labels[k] || k}</b></span><${Icon} name="chevron" /></button>`)}</div>` : html`<p class="muted">Tutorials will appear here.</p>`}
      </section>
      <section class="panel">
        <h3>Send feedback</h3>
        <${Field} label="Type"><${Select} value=${kind} onChange=${setKind} options=${[['feature', 'Feature suggestion'], ['bug', 'Something is broken'], ['feedback', 'General feedback'], ['testimonial', 'Testimonial']]} /></${Field}>
        <${Field} label="Message"><textarea class="input" rows="7" value=${msg} onInput=${(e) => setMsg(e.target.value)} placeholder=${kind === 'bug' ? 'What did you do, what happened, what did you expect?' : 'Tell us…'} /></${Field}>
        <${Button} kind="primary" busy=${busy} disabled=${msg.trim().length < 3} onClick=${send}>Send</${Button}>
      </section>
    </div>
  </div>`;
}
