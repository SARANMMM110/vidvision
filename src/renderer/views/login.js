import { html, useState, useStore, call, setState, toast, openUrl } from '../lib.js';
import { Button, Field, Modal, Icon } from '../ui.js';
import { Mark, brandName } from '../brand.js';

export function Login() {
  const auth = useStore((s) => s.auth);
  const info = useStore((s) => s.info);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(auth && auth.lastError ? auth.lastError : '');
  const [forgot, setForgot] = useState(false);
  const [server, setServer] = useState(false);
  const cfg = (auth && auth.config) || {};
  const products = cfg.products || {};

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!email || !password) { setErr('Enter your email and password.'); return; }
    setBusy(true);
    try {
      const st = await call('auth.login', { email, password });
      setState({ auth: st });
    } catch (ex) {
      setErr(ex.message);
    } finally { setBusy(false); }
  };

  return html`<div class="login">
    <section class="login-side">
      <div class="brand big"><${Mark} /><span class="brand-name">${brandName()}</span></div>
      <h1 class="login-title">Vision, voice and transcription in one studio.</h1>
      <ul class="login-mods">
        ${['vision', 'voice', 'scribe'].map((m) => html`<li class=${'mod-' + m}><span class="mod-dot" /><div><b>${(products[m] && products[m].name) || { vision: 'Vision Engine', voice: 'Voice Engine', scribe: 'Scribe Engine' }[m]}</b><span>${(products[m] && products[m].desc) || ''}</span></div></li>`)}
      </ul>
      <p class="login-foot muted small">Version ${info && info.version}</p>
    </section>
    <section class="login-main">
      <form class="login-card" onSubmit=${submit}>
        <h2>Sign in</h2>
        <p class="muted">Use the email and password you registered with.</p>
        <${Field} label="Email"><input class="input" type="email" autocomplete="username" value=${email} onInput=${(e) => setEmail(e.target.value)} autofocus /></${Field}>
        <${Field} label="Password"><input class="input" type="password" autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.target.value)} /></${Field}>
        ${err ? html`<div class="error-box"><${Icon} name="info" /><span>${err}</span></div>` : null}
        <${Button} kind="primary" type="submit" busy=${busy} cls="wide">Sign in</${Button}>
        <div class="row between small">
          <button type="button" class="link-btn" onClick=${() => setForgot(true)}>Forgot password?</button>
          <button type="button" class="link-btn" onClick=${() => setServer(true)}>Connection</button>
        </div>
        ${Object.keys(products).length ? html`<div class="login-register"><span class="muted small">New here? Register your purchase:</span>
          <div class="chips">${Object.entries(products).map(([k, p]) => html`<button type="button" class="chip" onClick=${() => openUrl(p.register_url)}>${p.name}</button>`)}</div></div>` : null}
      </form>
    </section>
    ${forgot ? html`<${Forgot} initial=${email} onClose=${() => setForgot(false)} />` : null}
    ${server ? html`<${Server} onClose=${() => setServer(false)} />` : null}
  </div>`;
}

function Forgot({ initial, onClose }) {
  const [email, setEmail] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { const r = await call('auth.forgot', { email }); toast(r.message || 'Check your inbox.', 'ok'); onClose(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return html`<${Modal} title="Reset your password" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${busy} onClick=${send}>Send reset link</${Button}>`}>
    <p class="muted">We'll email you a link to choose a new password.</p>
    <${Field} label="Email"><input class="input" type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} /></${Field}>
  </${Modal}>`;
}

function Server({ onClose }) {
  const auth = useStore((s) => s.auth);
  const [url, setUrl] = useState((auth && auth.serverUrl) || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const st = await call('auth.setServer', { url }); setState({ auth: st }); toast(st.config ? 'Connected to the licence server' : 'Saved, but the server did not answer', st.config ? 'ok' : 'error'); onClose(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return html`<${Modal} title="Connection" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${busy} onClick=${save}>Save</${Button}>`}>
    <p class="muted">Only change this if your provider asked you to. Leave it empty to use the built-in address.</p>
    <${Field} label="Licence server address" hint="Example: https://members.example.com"><input class="input" value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://" /></${Field}>
  </${Modal}>`;
}
