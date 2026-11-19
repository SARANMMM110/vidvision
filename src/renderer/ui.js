// Shared UI components.
import { html, useState, useEffect, useRef, useMemo, state, useStore, call, toast, mediaUrl, clock, splitTimecodes, cancelJob, openUrl, pathFor } from './lib.js';
import { marked } from 'marked';

// ---------------------------------------------------------------- icons (24px stroke)
const P = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  pen: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  film: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  chat: 'M4 5h16v11H9l-5 4z',
  image: 'M4 5h16v14H4zM8 11a2 2 0 100-4 2 2 0 000 4zM20 16l-5-5-9 8',
  scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM8.5 7.5L20 19M8.5 16.5L20 5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  export: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  flag: 'M5 21V4h11l-1 4 4 4H5',
  wave: 'M2 12h2l2-6 3 12 3-15 3 18 3-12 2 6h2',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  clone: 'M9 9h11v11H9zM5 15H4V4h11v1',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  studio: 'M3 7h18v13H3zM8 3l4 4 4-4',
  book: 'M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6M20 4v14h-6',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 14-4-1z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z',
  text: 'M4 6h16M4 12h10M4 18h14',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  download: 'M12 3v12M7 10l5 5 5-5M5 19h14',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  prompt: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h4',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-5-6',
  brush: 'M14 4l6 6-9 9H5v-6zM12 6l6 6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 01-4 0v-.1A1.7 1.7 0 006.6 19l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 13.3H3a2 2 0 010-4h.1A1.7 1.7 0 004.6 7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010.3 3V3a2 2 0 014 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5M12 17h.01',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  stop: 'M6 6h12v12H6z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  folder: 'M3 6h6l2 2h10v11H3z',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  check: 'M4 12l5 5L20 6',
  chevron: 'M9 6l6 6-6 6',
  record: 'M12 17a5 5 0 100-10 5 5 0 000 10z',
  upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  wand: 'M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z',
  key: 'M14 10a4 4 0 10-3.5 4L4 20.5V22h3v-2h2v-2h2l1.5-1.5A4 4 0 0014 10z',
  logout: 'M10 4H4v16h6M15 8l4 4-4 4M19 12H9',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7h.01',
  cpu: 'M7 7h10v10H7zM4 9h3M4 15h3M17 9h3M17 15h3M9 4v3M15 4v3M9 17v3M15 17v3',
  wp: 'M12 21a9 9 0 100-18 9 9 0 000 18zM4 9l4 10 3-8M9 9l5 12 3-12',
};

export function Icon({ name, size = 18, cls = '' }) {
  return html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[name] || P.info} /></svg>`;
}

export function Button({ kind = 'default', size = '', icon, busy, children, cls = '', ...rest }) {
  return html`<button class=${`btn btn-${kind} ${size ? 'btn-' + size : ''} ${cls}`} disabled=${busy || rest.disabled} ...${rest}>
    ${busy ? html`<span class="spin" />` : icon ? html`<${Icon} name=${icon} size=${size === 'sm' ? 15 : 17} />` : null}
    ${children ? html`<span>${children}</span>` : null}
  </button>`;
}

export function IconButton({ icon, title, cls = '', ...rest }) {
  return html`<button class=${'icon-btn ' + cls} title=${title} aria-label=${title} ...${rest}><${Icon} name=${icon} size=${17} /></button>`;
}

export function Field({ label, hint, children, cls = '' }) {
  return html`<label class=${'field ' + cls}><span class="field-label">${label}</span>${children}${hint ? html`<span class="field-hint">${hint}</span>` : null}</label>`;
}

export function Select({ value, onChange, options, cls = '', ...rest }) {
  return html`<select class=${'input ' + cls} value=${value} onChange=${(e) => onChange(e.target.value)} ...${rest}>
    ${options.map((o) => (Array.isArray(o) ? html`<option value=${o[0]}>${o[1]}</option>` : html`<option value=${o.value}>${o.label}</option>`))}
  </select>`;
}

export function Toggle({ checked, onChange, label, hint }) {
  return html`<label class="toggle"><input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} /><span class="toggle-track"><span class="toggle-dot" /></span><span class="toggle-text">${label}${hint ? html`<small>${hint}</small>` : null}</span></label>`;
}

export function Range({ value, onChange, min = 0, max = 1, step = 0.01, label, fmt }) {
  return html`<label class="range"><span class="field-label">${label}<b>${fmt ? fmt(value) : value}</b></span><input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onChange(Number(e.target.value))} /></label>`;
}

export function Segmented({ value, onChange, options }) {
  return html`<div class="seg" role="tablist">${options.map((o) => html`<button role="tab" aria-selected=${value === o[0]} class=${value === o[0] ? 'on' : ''} onClick=${() => onChange(o[0])}>${o[1]}</button>`)}</div>`;
}

export function Tabs({ value, onChange, tabs }) {
  return html`<div class="tabs">${tabs.map((t) => html`<button class=${value === t[0] ? 'on' : ''} onClick=${() => onChange(t[0])}>${t[1]}${t[2] != null ? html`<span class="tab-count">${t[2]}</span>` : null}</button>`)}</div>`;
}

export function Badge({ kind = '', children }) { return html`<span class=${'badge ' + kind}>${children}</span>`; }

export function Empty({ icon = 'info', title, children, action }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${28} /><h3>${title}</h3>${children ? html`<p>${children}</p>` : null}${action || null}</div>`;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return html`<div class="modal-back" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${'modal ' + (wide ? 'modal-wide' : '')} role="dialog" aria-label=${title}>
      <header><h2>${title}</h2><${IconButton} icon="x" title="Close" onClick=${onClose} /></header>
      <div class="modal-body">${children}</div>
      ${footer ? html`<footer>${footer}</footer>` : null}
    </div>
  </div>`;
}

export function Progress({ runner, label }) {
  if (!runner || !runner.busy) return null;
  return html`<div class="progress-line"><div class="progress-meta"><span>${runner.message || label || 'Working…'}</span><span>${Math.round(runner.progress || 0)}%</span>
    <button class="link-btn" onClick=${runner.stop}>Cancel</button></div><div class="bar"><i style=${{ width: (runner.progress || 2) + '%' }} /></div></div>`;
}

export function Spinner({ label }) { return html`<div class="loading"><span class="spin" />${label || 'Loading…'}</div>`; }

/** Timecode chip; hover shows a frame preview when frameAt is given. */
export function Timecode({ t, onSeek, frameAt }) {
  const [hover, setHover] = useState(false);
  const f = hover && frameAt ? frameAt(t) : '';
  return html`<button class="tc" onClick=${() => onSeek && onSeek(t)} onMouseEnter=${() => setHover(true)} onMouseLeave=${() => setHover(false)}>${clock(t)}${f ? html`<img class="tc-peek" src=${mediaUrl(f)} alt="" />` : null}</button>`;
}

// ---------------------------------------------------------------- markdown with timecode chips
marked.use({ renderer: { html(token) { return String(token.text || token.raw || '').replace(/</g, '&lt;'); } } });

export function Markdown({ text, onSeek, frameAt, cls = '' }) {
  const ref = useRef(null);
  const htmlStr = useMemo(() => {
    const src = String(text || '').replace(/!\[([^\]]*)\]\(frame:([\d.]+)\)/g, (m, cap, t) => `\n\n[[frame:${t}|${cap}]]\n\n`);
    let out = marked.parse(src, { gfm: true, breaks: true });
    out = out.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (m, c) => `<button class="tc" data-t="${c}">${c}</button>`);
    out = out.replace(/\[\[frame:([\d.]+)\|([^\]]*)\]\]/g, (m, t, cap) => {
      const f = frameAt ? frameAt(Number(t)) : '';
      return f ? `<figure class="md-fig"><img src="${mediaUrl(f)}" alt=""><figcaption><button class="tc" data-t="${clock(Number(t))}">${clock(Number(t))}</button> ${cap.replace(/</g, '&lt;')}</figcaption></figure>` : '';
    });
    return out;
  }, [text, frameAt]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const click = (e) => {
      const b = e.target.closest('.tc');
      if (b && onSeek) { e.preventDefault(); const p = b.dataset.t.split(':').map(Number); onSeek(p.reduce((a, x) => a * 60 + x, 0)); }
      const a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); if (/^https?:/.test(a.href)) openUrl(a.href); }
    };
    el.addEventListener('click', click);
    return () => el.removeEventListener('click', click);
  }, [onSeek]);
  return html`<div ref=${ref} class=${'md ' + cls} dangerouslySetInnerHTML=${{ __html: htmlStr }} />`;
}

/** Plain text with [mm:ss] chips (for chat). */
export function TimedText({ text, onSeek, frameAt }) {
  return html`<${Markdown} text=${text} onSeek=${onSeek} frameAt=${frameAt} />`;
}

export function Dropzone({ onFiles, label, sub, accept, icon = 'upload', onPick }) {
  const [over, setOver] = useState(false);
  return html`<div class=${'drop ' + (over ? 'over' : '')}
    onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => {
      e.preventDefault(); setOver(false);
      const files = Array.from(e.dataTransfer.files || []).map((f) => pathFor(f)).filter(Boolean).filter((p) => !accept || accept.test(p));
      if (files.length) { call('file.allow', { files }); onFiles(files); } else toast('Those files are not supported here.', 'error');
    }}
    onClick=${onPick} role="button" tabIndex="0">
    <${Icon} name=${icon} size=${26} /><b>${label || 'Drop files here'}</b><span>${sub || 'or click to browse'}</span>
  </div>`;
}

export function Audio({ file, title, compact }) {
  if (!file) return null;
  return html`<div class=${'audio ' + (compact ? 'compact' : '')}>${title ? html`<span class="audio-title">${title}</span>` : null}<audio controls preload="metadata" src=${mediaUrl(file)} /></div>`;
}

export function HelpButton({ k }) {
  const links = useStore((s) => (s.auth && s.auth.config && s.auth.config.help_links) || {});
  if (!links[k]) return null;
  return html`<${Button} kind="ghost" size="sm" icon="help" onClick=${() => openUrl(links[k])}>Help video</${Button}>`;
}

export function PageHeader({ title, sub, module, help, actions, children }) {
  return html`<header class=${'page-head ' + (module ? 'mod-' + module : '')}>
    <div class="page-head-text"><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : null}</div>
    <div class="page-head-actions">${children}${actions}<${HelpButton} k=${help} /></div>
  </header>`;
}

export function Card({ children, cls = '', ...rest }) { return html`<section class=${'card ' + cls} ...${rest}>${children}</section>`; }

export function Copyable({ text, label = 'Copy' }) {
  return html`<${Button} size="sm" kind="ghost" icon="copy" onClick=${() => call('clipboard.write', { text }).then(() => toast('Copied', 'ok', 1500))}>${label}</${Button}>`;
}

/** Job tray (bottom-right). */
export function JobTray() {
  const jobs = useStore((s) => Object.values(s.jobs));
  const [open, setOpen] = useState(true);
  if (!jobs.length) return null;
  const running = jobs.filter((j) => j.state === 'running');
  return html`<aside class=${'tray ' + (open ? 'open' : '')}>
    <button class="tray-head" onClick=${() => setOpen(!open)}>${running.length ? html`<span class="spin" />` : html`<${Icon} name="check" />`}<span>${running.length ? `${running.length} task${running.length > 1 ? 's' : ''} running` : 'Tasks finished'}</span><${Icon} name="chevron" cls=${open ? 'rot90' : 'rot-90'} /></button>
    ${open ? html`<div class="tray-list">${jobs.slice(-6).reverse().map((j) => html`<div class=${'tray-item st-' + j.state + (j.module ? ' mod-' + j.module : '')}>
      <div class="tray-row"><b>${j.label}</b>${j.state === 'running' ? html`<button class="link-btn" onClick=${() => cancelJob(j.id)}>Cancel</button>` : html`<span class="tray-state">${j.state === 'done' ? 'Done' : j.state === 'cancelled' ? 'Cancelled' : 'Failed'}</span>`}</div>
      <div class="bar"><i style=${{ width: (j.state === 'done' ? 100 : Math.max(2, j.progress || 0)) + '%' }} /></div>
      <small>${j.message}</small>${j.state === 'error' && j.buyUrl ? html` <button class="link-btn small" onClick=${() => openUrl(j.buyUrl)}>Buy credits</button>` : null}</div>`)}</div>` : null}
  </aside>`;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return html`<div class="toasts" role="status" aria-live="polite">${toasts.map((t) => html`<div class=${'toast ' + t.kind + (t.action ? ' has-action' : '')}><span>${t.message}</span>${t.action ? html`<button class="toast-action" onClick=${t.action.onClick}>${t.action.label}</button>` : null}</div>`)}</div>`;
}

/** Language select from a [code, name] list. */
export function LangSelect({ value, onChange, list, placeholder }) {
  return html`<select class="input" value=${value} onChange=${(e) => onChange(e.target.value)}>${placeholder ? html`<option value="">${placeholder}</option>` : null}${list.map((l) => html`<option value=${l[0]}>${l[1]}</option>`)}</select>`;
}

/** Multi-select languages with search. */
export function LangMulti({ value, onChange, list }) {
  const [q, setQ] = useState('');
  const shown = list.filter((l) => !q || l[1].toLowerCase().includes(q.toLowerCase()));
  const toggle = (c) => onChange(value.includes(c) ? value.filter((x) => x !== c) : value.concat([c]));
  return html`<div class="lang-multi">
    <input class="input" placeholder="Search 200+ languages" value=${q} onInput=${(e) => setQ(e.target.value)} />
    ${value.length ? html`<div class="chips">${value.map((c) => html`<button class="chip on" onClick=${() => toggle(c)}>${(list.find((l) => l[0] === c) || [c, c])[1]} ✕</button>`)}</div>` : null}
    <div class="lang-list">${shown.slice(0, 300).map((l) => html`<label><input type="checkbox" checked=${value.includes(l[0])} onChange=${() => toggle(l[0])} />${l[1]}</label>`)}</div>
  </div>`;
}

export function Locked({ module, name }) {
  const cfg = useStore((s) => (s.auth && s.auth.config) || {});
  const p = (cfg.products || {})[module] || {};
  return html`<div class="locked">
    <div class=${'locked-mark mod-' + module}><${Icon} name="lock" size=${26} /></div>
    <h2>${p.name || name} is not on your account</h2>
    <p>${p.desc || 'Unlock this module to use it in the app.'}</p>
    <div class="row gap">
      ${p.sales_url ? html`<${Button} kind="primary" onClick=${() => openUrl(p.sales_url)}>Get ${p.name || name}</${Button}>` : null}
      <${Button} icon="refresh" onClick=${async () => { await call('auth.refresh'); toast('Access refreshed', 'ok'); }}>I've purchased — refresh access</${Button}>
    </div>
    ${p.register_url ? html`<p class="muted small">Bought it already? Register your purchase at <a href="#" onClick=${(e) => { e.preventDefault(); openUrl(p.register_url); }}>${p.register_url}</a>, then refresh.</p>` : null}
  </div>`;
}

export function Confirm({ title, text, confirm = 'Delete', onYes, onClose, danger = true }) {
  return html`<${Modal} title=${title} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind=${danger ? 'danger' : 'primary'} onClick=${() => { onYes(); onClose(); }}>${confirm}</${Button}>`}><p>${text}</p></${Modal}>`;
}

export function useAsync(fn, deps) {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const reload = () => {
    setSt((s) => Object.assign({}, s, { loading: true }));
    return Promise.resolve().then(fn).then((data) => setSt({ loading: false, data, error: null })).catch((error) => setSt({ loading: false, data: null, error }));
  };
  useEffect(() => { reload(); }, deps || []);
  return Object.assign({}, st, { reload, set: (data) => setSt({ loading: false, data, error: null }) });
}

export function ErrorBox({ error, retry }) {
  if (!error) return null;
  return html`<div class="error-box"><${Icon} name="info" /><span>${error.message || String(error)}</span>${retry ? html`<${Button} size="sm" onClick=${retry}>Try again</${Button}>` : null}</div>`;
}

export function Split({ left, right, cls = '' }) {
  return html`<div class=${'split ' + cls}><div class="split-left">${left}</div><div class="split-right">${right}</div></div>`;
}

export { state };
