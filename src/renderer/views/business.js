import { html, useState, useStore, call, toast, copy, openUrl } from '../lib.js';
import { PageHeader, Button, Field, Select, Badge, Spinner, ErrorBox, useAsync, Modal, Toggle, Confirm, Empty, Tabs } from '../ui.js';

const NAMES = { vision: 'Vision Engine', voice: 'Voice Engine', scribe: 'Scribe Engine' };

function SubModal({ kind, available, existing, onClose, onDone }) {
  const isNew = !existing;
  const [f, setF] = useState({ name: existing ? existing.name : '', email: '', password: '', modules: existing ? existing.modules : available.slice(), send_email: true, status: existing ? existing.status : 'active' });
  const [busy, setBusy] = useState(false);
  const up = (p) => setF(Object.assign({}, f, p));
  const save = async () => {
    setBusy(true);
    try {
      const ch = kind === 'agency' ? (isNew ? 'agency.create' : 'agency.update') : (isNew ? 'wl.createCustomer' : 'wl.updateCustomer');
      const r = await call(ch, Object.assign({}, f, existing ? { id: existing.id } : {}));
      if (isNew && r.password) { copy(`Email: ${f.email}\nPassword: ${r.password}`, 'Login details copied'); }
      toast(isNew ? 'Account created' : 'Saved', 'ok');
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${(isNew ? 'Add ' : 'Edit ') + (kind === 'agency' ? 'client' : 'customer')} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${busy} onClick=${save}>${isNew ? 'Create account' : 'Save'}</${Button}>`}>
    <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => up({ name: e.target.value })} /></${Field}>
    ${isNew ? html`<${Field} label="Email"><input class="input" type="email" value=${f.email} onInput=${(e) => up({ email: e.target.value })} /></${Field}>` : html`<${Field} label="Email"><input class="input" value=${existing.email} disabled /></${Field}>`}
    <${Field} label=${isNew ? 'Password' : 'New password'} hint=${isNew ? 'Leave empty to generate one. It is copied for you after saving.' : 'Leave empty to keep the current password.'}><input class="input" value=${f.password} onInput=${(e) => up({ password: e.target.value })} autocomplete="off" /></${Field}>
    <div class="field"><span class="field-label">Modules</span><div class="chips">${available.length ? available.map((m) => html`<label class=${'chip ' + (f.modules.includes(m) ? 'on' : '')}><input type="checkbox" hidden checked=${f.modules.includes(m)} onChange=${() => up({ modules: f.modules.includes(m) ? f.modules.filter((x) => x !== m) : f.modules.concat([m]) })} />${NAMES[m]}</label>`) : html`<span class="muted">You don't own any modules to share yet.</span>`}</div></div>
    ${isNew ? html`<${Toggle} checked=${f.send_email} onChange=${(v) => up({ send_email: v })} label="Email the login details" />` : html`<${Field} label="Status"><${Select} value=${f.status} onChange=${(v) => up({ status: v })} options=${[['active', 'Active'], ['suspended', 'Suspended']]} /></${Field}>`}
  </${Modal}>`;
}

function SubTable({ kind, list, available, reload }) {
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [q, setQ] = useState('');
  const shown = list.filter((c) => !q || (c.name + c.email).toLowerCase().includes(q.toLowerCase()));
  return html`<div>
    <div class="row between gap"><input class="input search" placeholder="Search by name or email" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <${Button} kind="primary" icon="plus" onClick=${() => setEdit('new')}>${kind === 'agency' ? 'Add client' : 'Add customer'}</${Button}></div>
    ${shown.length ? html`<table class="table"><thead><tr><th>Name</th><th>Modules</th><th>Status</th><th>Installs</th><th>Joined</th><th></th></tr></thead><tbody>
      ${shown.map((c) => html`<tr><td><b>${c.name}</b><div class="muted small">${c.email}</div></td>
        <td>${c.modules.map((m) => html`<${Badge}>${NAMES[m] || m}</${Badge}> `)}</td>
        <td><${Badge} kind=${c.status === 'active' ? 'ok' : 'warn'}>${c.status}</${Badge}></td><td>${c.devices_used}</td><td class="muted small">${String(c.created_at).slice(0, 10)}</td>
        <td><div class="row gap"><${Button} size="sm" onClick=${() => setEdit(c)}>Edit</${Button}><${Button} size="sm" kind="danger" onClick=${() => setDel(c)}>Delete</${Button}></div></td></tr>`)}
    </tbody></table>` : html`<${Empty} icon="users" title=${kind === 'agency' ? 'No clients yet' : 'No customers yet'}>${kind === 'agency' ? 'Create an account for each client. They sign in to this same app and see only the modules you give them.' : 'Customers appear here when they register through your links or when you add them.'}</${Empty}>`}
    ${edit ? html`<${SubModal} kind=${kind} available=${available} existing=${edit === 'new' ? null : edit} onClose=${() => setEdit(null)} onDone=${() => { setEdit(null); reload(); }} />` : null}
    ${del ? html`<${Confirm} title="Delete account?" text=${`${del.name} (${del.email}) loses access immediately. This cannot be undone.`} onClose=${() => setDel(null)} onYes=${async () => { try { await call(kind === 'agency' ? 'agency.delete' : 'wl.deleteCustomer', { id: del.id }); toast('Deleted', 'ok'); reload(); } catch (e) { toast(e.message, 'error'); } }} />` : null}
  </div>`;
}

export function Agency() {
  const d = useAsync(() => call('agency.list'), []);
  return html`<div class="page">
    <${PageHeader} title="Agency" sub="Create client accounts and choose which modules each client can use." help="agency" />
    ${d.loading && !d.data ? html`<${Spinner} />` : d.error ? html`<${ErrorBox} error=${d.error} retry=${d.reload} />` : html`
      <div class="stat-row"><div><b>${d.data.clients.length}</b><span>clients${d.data.limit ? ` of ${d.data.limit}` : ''}</span></div><div><b>${d.data.clients.filter((c) => c.status === 'active').length}</b><span>active</span></div><div><b>${d.data.available.length}</b><span>modules you can share</span></div></div>
      <${SubTable} kind="agency" list=${d.data.clients} available=${d.data.available} reload=${d.reload} />`}
  </div>`;
}

export function WhiteLabel() {
  const [tab, setTab] = useState('brand');
  const d = useAsync(() => Promise.all([call('wl.brand'), call('wl.customers')]).then(([w, c]) => ({ w, c })), []);
  return html`<div class="page">
    <${PageHeader} title="White Label" sub="Sell this app under your own brand. Customers who sign up through your links see your name, logo and colours." help="whitelabel" />
    ${d.loading && !d.data ? html`<${Spinner} />` : d.error ? html`<${ErrorBox} error=${d.error} retry=${d.reload} />` : html`
      <${Tabs} value=${tab} onChange=${setTab} tabs=${[['brand', 'Brand'], ['links', 'Registration links'], ['payments', 'Payments (JVZoo / WarriorPlus)'], ['customers', 'Customers', d.data.c.customers.length]]} />
      ${tab === 'brand' ? html`<${BrandForm} w=${d.data.w} onSaved=${d.reload} />` : null}
      ${tab === 'links' ? html`<${Links} w=${d.data.w} />` : null}
      ${tab === 'payments' ? html`<${Payments} w=${d.data.w} onSaved=${d.reload} />` : null}
      ${tab === 'customers' ? html`<${SubTable} kind="whitelabel" list=${d.data.c.customers} available=${d.data.c.available} reload=${d.reload} />` : null}`}
  </div>`;
}

function BrandForm({ w, onSaved }) {
  const b = w.brand;
  const [f, setF] = useState({ app_name: b.app_name, tagline: b.tagline, logo_url: b.logo_url, primary_color: b.primary_color || '#6d5efc', accent_color: b.accent_color || '#22d3ee', slug: b.slug, support_url: b.support_url, support_email: b.support_email, website_url: b.website_url, download_url: b.download_url, reg_mode: b.reg_mode, hide_powered_by: Boolean(b.hide_powered_by) });
  const [busy, setBusy] = useState(false);
  const up = (p) => setF(Object.assign({}, f, p));
  const save = async () => { setBusy(true); try { await call('wl.saveBrand', f); toast('Brand saved', 'ok'); onSaved(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  return html`<div class="form-grid">
    <section class="panel">
      <${Field} label="App name"><input class="input" value=${f.app_name} onInput=${(e) => up({ app_name: e.target.value })} /></${Field}>
      <${Field} label="Tagline"><input class="input" value=${f.tagline} onInput=${(e) => up({ tagline: e.target.value })} /></${Field}>
      <${Field} label="Logo URL" hint="Transparent PNG or SVG, about 300×80."><input class="input" value=${f.logo_url} onInput=${(e) => up({ logo_url: e.target.value })} /></${Field}>
      <div class="grid2"><${Field} label="Primary colour"><input class="input color" type="color" value=${f.primary_color} onInput=${(e) => up({ primary_color: e.target.value })} /></${Field}>
      <${Field} label="Accent colour"><input class="input color" type="color" value=${f.accent_color} onInput=${(e) => up({ accent_color: e.target.value })} /></${Field}></div>
      <${Field} label="Brand slug" hint="Used in your registration links."><input class="input" value=${f.slug} onInput=${(e) => up({ slug: e.target.value })} /></${Field}>
      <div class="grid2"><${Field} label="Support URL"><input class="input" value=${f.support_url} onInput=${(e) => up({ support_url: e.target.value })} /></${Field}>
      <${Field} label="Support email"><input class="input" value=${f.support_email} onInput=${(e) => up({ support_email: e.target.value })} /></${Field}></div>
      <${Field} label="Website / sales page" hint="Locked modules point here."><input class="input" value=${f.website_url} onInput=${(e) => up({ website_url: e.target.value })} /></${Field}>
      <${Field} label="Download link for your customers" hint="Optional — defaults to the standard installer."><input class="input" value=${f.download_url} onInput=${(e) => up({ download_url: e.target.value })} /></${Field}>
      <${Field} label="Who can register"><${Select} value=${f.reg_mode} onChange=${(v) => up({ reg_mode: v })} options=${[['verified', 'Only buyers of my JVZoo / WarriorPlus products'], ['open', 'Anyone with my link'], ['closed', 'Closed']]} /></${Field}>
      <${Toggle} checked=${f.hide_powered_by} onChange=${(v) => up({ hide_powered_by: v })} label='Hide "Powered by" on member pages' />
      <${Button} kind="primary" busy=${busy} onClick=${save}>Save brand</${Button}>
    </section>
    <section class="panel">
      <h3>Preview</h3>
      <div class="wl-preview" style=${{ '--p': f.primary_color, '--a': f.accent_color }}>
        <div class="wl-side">${f.logo_url ? html`<img src=${f.logo_url} alt="" />` : html`<span class="wl-glyph" />`}<b>${f.app_name || 'Your app'}</b>
          ${['Vision Engine', 'Voice Engine', 'Scribe Engine'].map((n) => html`<span class="wl-nav">${n}</span>`)}</div>
        <div class="wl-main"><span class="wl-h" /><span class="wl-l" /><span class="wl-l short" /><span class="wl-btn">Primary button</span></div>
      </div>
      <p class="muted small">Customers see this after they sign in. The installer is the same for everyone — the app switches to your brand automatically.</p>
    </section>
  </div>`;
}

function Links({ w }) {
  const row = (label, url) => html`<div class="list-row"><span class="list-main"><b>${label}</b><span class="muted small mono-break">${url}</span></span><${Button} size="sm" icon="copy" onClick=${() => copy(url)}>Copy</${Button}><${Button} size="sm" onClick=${() => openUrl(url)}>Open</${Button}></div>`;
  return html`<div>
    <p class="muted">Put each link on the matching product's thank-you page. Buyers register with their purchase email, then sign in to the app.</p>
    <div class="list">${Object.entries(w.links.register).map(([k, u]) => row(NAMES[k] || k, u))}${row('Member login', w.links.login)}${row('Member dashboard', w.links.dashboard)}</div>
  </div>`;
}

function Payments({ w, onSaved }) {
  const b = w.brand;
  const init = [];
  for (const pl of ['jvzoo', 'warriorplus']) for (const [ref, mod] of Object.entries((b.product_map && b.product_map[pl]) || {})) init.push({ p: pl, ref, mod });
  const [rows, setRows] = useState(init);
  const [keys, setKeys] = useState({ jvzoo_secret: b.jvzoo_secret || '', wplus_key: b.wplus_key || '' });
  const save = async () => {
    const pm = { jvzoo: {}, warriorplus: {} };
    for (const r of rows) if (r.ref.trim()) pm[r.p][r.ref.trim()] = r.mod;
    try { await call('wl.saveBrand', Object.assign({}, keys, { product_map: pm })); toast('Payment settings saved', 'ok'); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  const set = (i, p) => setRows(rows.map((r, k) => (k === i ? Object.assign({}, r, p) : r)));
  return html`<div class="form-grid">
    <section class="panel span2">
      <h3>IPN URLs</h3>
      <p class="muted small">Paste these in your JVZoo / WarriorPlus product settings so sales and refunds update access automatically.</p>
      <div class="list"><div class="list-row"><span class="list-main"><b>JVZoo</b><span class="muted small mono-break">${w.links.ipn.jvzoo}</span></span><${Button} size="sm" icon="copy" onClick=${() => copy(w.links.ipn.jvzoo)}>Copy</${Button}></div>
      <div class="list-row"><span class="list-main"><b>WarriorPlus</b><span class="muted small mono-break">${w.links.ipn.warriorplus}</span></span><${Button} size="sm" icon="copy" onClick=${() => copy(w.links.ipn.warriorplus)}>Copy</${Button}></div></div>
    </section>
    <section class="panel span2">
      <div class="grid2"><${Field} label="JVZoo secret key"><input class="input" value=${keys.jvzoo_secret} onInput=${(e) => setKeys(Object.assign({}, keys, { jvzoo_secret: e.target.value }))} /></${Field}>
      <${Field} label="WarriorPlus security key"><input class="input" value=${keys.wplus_key} onInput=${(e) => setKeys(Object.assign({}, keys, { wplus_key: e.target.value }))} /></${Field}></div>
      <h3>Product mapping</h3>
      ${rows.map((r, i) => html`<div class="map-row"><${Select} value=${r.p} onChange=${(v) => set(i, { p: v })} options=${[['jvzoo', 'JVZoo'], ['warriorplus', 'WarriorPlus']]} />
        <input class="input" placeholder="Product ID / code" value=${r.ref} onInput=${(e) => set(i, { ref: e.target.value })} />
        <${Select} value=${r.mod} onChange=${(v) => set(i, { mod: v })} options=${w.available.map((m) => [m, NAMES[m]])} />
        <${Button} size="sm" kind="danger" icon="x" onClick=${() => setRows(rows.filter((_, k) => k !== i))} /></div>`)}
      <div class="row gap"><${Button} icon="plus" disabled=${!w.available.length} onClick=${() => setRows(rows.concat([{ p: 'jvzoo', ref: '', mod: w.available[0] }]))}>Add product</${Button}><${Button} kind="primary" onClick=${save}>Save payment settings</${Button}></div>
      ${!w.available.length ? html`<p class="muted small">You can only sell modules you own.</p>` : null}
    </section>
  </div>`;
}
