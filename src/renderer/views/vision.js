import { html, useState, useEffect, useRef, useMemo, useStore, setState, state, call, job, go, toast, useRunner, mediaUrl, clock, parseClock, ago, count, copy, pickFiles, saveFile, openPath, showInFolder, on, MEDIA_FILTERS, openUrl } from '../lib.js';
import { PageHeader, Button, IconButton, Icon, Field, Select, Toggle, Range, Segmented, Tabs, Badge, Empty, Modal, Progress, Spinner, ErrorBox, Markdown, Timecode, Dropzone, useAsync, Confirm, LangSelect, Copyable } from '../ui.js';
import data from '../../shared/data.js';
import NLLB from '../../shared/nllb-languages.js';

const M = 'vision';
const run = (ch, payload, label) => job(ch, payload, label, { module: M });

// ------------------------------------------------------------------ project context
function useProjects() {
  return useAsync(() => call('vision.projects'), []);
}

function setProject(id) { localStorage.setItem('ame.visionProject', id || ''); setState({ visionProject: id || '' }); }

function ProjectBar({ projects, onCreated }) {
  const cur = useStore((s) => s.visionProject);
  const [creating, setCreating] = useState(false);
  const list = projects.data || [];
  useEffect(() => { if (list.length && !list.find((p) => p.id === cur)) setProject(list[0].id); }, [list.length]);
  return html`<div class="project-bar">
    ${list.length ? html`<${Select} value=${cur} onChange=${setProject} options=${list.map((p) => [p.id, `${p.name} (${p.videos})`])} />` : html`<span class="muted small">No projects yet</span>`}
    <${Button} size="sm" icon="plus" onClick=${() => setCreating(true)}>New project</${Button}>
    ${creating ? html`<${NewProject} onClose=${() => setCreating(false)} onDone=${(p) => { setCreating(false); setProject(p.id); projects.reload(); onCreated && onCreated(p); }} />` : null}
  </div>`;
}

function NewProject({ onClose, onDone }) {
  const [name, setName] = useState('');
  const save = async () => { try { onDone(await call('vision.createProject', { name: name || 'Untitled project' })); } catch (e) { toast(e.message, 'error'); } };
  return html`<${Modal} title="New project" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" onClick=${save}>Create project</${Button}>`}>
    <${Field} label="Project name" hint="A project groups videos you want to analyze together."><input class="input" autofocus value=${name} onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /></${Field}>
  </${Modal}>`;
}

/** Tool page wrapper: header + project bar + needs a project with ready videos. */
function ToolPage({ title, sub, help, children, needVideos = true }) {
  const projects = useProjects();
  const pid = useStore((s) => s.visionProject);
  const project = useAsync(() => (pid ? call('vision.project', { id: pid }) : Promise.resolve(null)), [pid]);
  let body;
  if (projects.loading && !projects.data) body = html`<${Spinner} />`;
  else if (!(projects.data || []).length) body = html`<${Empty} icon="eye" title="Create a project first" action=${html`<${Button} kind="primary" onClick=${() => go('vision.projects')}>Go to Analysis</${Button}>`}>Projects hold the videos you analyze. Everything in Vision Engine works on a project.</${Empty}>`;
  else if (!project.data) body = html`<${Spinner} />`;
  else if (needVideos && !project.data.videos.some((v) => v.status === 'ready' || v.hasTranscript)) body = html`<${Empty} icon="film" title="No analyzed videos in this project" action=${html`<${Button} kind="primary" onClick=${() => go('vision.projects')}>Add and analyze videos</${Button}>`}>Add videos in Analysis and process them; then come back here.</${Empty}>`;
  else body = children(project.data, project.reload);
  return html`<div class="page"><${PageHeader} title=${title} sub=${sub} module=${M} help=${help}><${ProjectBar} projects=${projects} /></${PageHeader}>${body}</div>`;
}

function VideoPicker({ project, value, onChange, multi }) {
  const vids = project.videos.filter((v) => v.status === 'ready' || v.hasTranscript);
  if (multi) {
    const all = !value.length;
    return html`<div class="chips">
      <button class=${'chip ' + (all ? 'on' : '')} onClick=${() => onChange([])}>All videos (${vids.length})</button>
      ${vids.map((v) => html`<button class=${'chip ' + (value.includes(v.id) ? 'on' : '')} onClick=${() => onChange(value.includes(v.id) ? value.filter((x) => x !== v.id) : value.concat([v.id]))}>${v.title.slice(0, 40)}</button>`)}
    </div>`;
  }
  return html`<${Select} value=${value} onChange=${onChange} options=${vids.map((v) => [v.id, v.title])} />`;
}

function frameFinder(frames) {
  return (t) => {
    let best = null;
    for (const f of frames || []) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    return best ? best.path : '';
  };
}

// ------------------------------------------------------------------ Discover
function rankList(list, mode) {
  const now = Date.now();
  const age = (e) => { if (!e.uploadDate || e.uploadDate.length !== 8) return 365; const d = Date.UTC(+e.uploadDate.slice(0, 4), +e.uploadDate.slice(4, 6) - 1, +e.uploadDate.slice(6, 8)); return Math.max(0.5, (now - d) / 86400000); };
  const f = { standout: (e) => (e.followers ? e.views / e.followers : e.views / 10000), fastest: (e) => e.views / age(e), views: (e) => e.views, likes: (e) => e.likes, discussed: (e) => e.comments, engagement: (e) => (e.views ? (e.likes + e.comments * 2) / e.views : 0), newest: (e) => -age(e), gems: (e) => (e.followers && e.followers < 50000 ? e.views / Math.max(1, e.followers) : 0), rising: (e) => (age(e) <= 30 ? e.views / age(e) : 0), shared: (e) => e.reposts || (e.views ? e.comments / e.views : 0), following: (e) => e.followers || 0, longest: (e) => e.duration || 0 }[mode];
  if (mode === 'channel') return list.slice().sort((a, b) => String(a.channel || '').localeCompare(String(b.channel || '')) || (b.views - a.views));
  if (!f) return list.slice().sort((a, b) => a._i - b._i);
  return list.map((e) => Object.assign({}, e, { score: f(e) })).sort((a, b) => b.score - a.score);
}
const num = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n || 0));
const fmtDate = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '');

export function Discover() {
  const [f, setF] = useState({ query: '', market: 'US', filter: 'any', mode: 'standout', limit: 30, url: '', platform: 'youtube' });
  const signed = useAsync(() => call('discover.signInStatus'), []);
  const [src, setSrc] = useState('search');
  const [results, setResults] = useState(null);
  const [sel, setSel] = useState([]);
  const [send, setSend] = useState(false);
  const r = useRunner(M);
  useEffect(() => { call('settings.get').then((s) => setF((x) => Object.assign({}, x, { market: s.settings.network.market || 'US' }))).catch(() => {}); }, []);
  const search = async () => {
    const out = await r.run('vision.discover', src === 'search' ? { query: f.query, market: f.market, filter: f.filter, mode: 'relevance', limit: f.limit, platform: f.platform } : { url: f.url, mode: 'relevance', limit: f.limit }, src === 'search' ? `Discover: ${f.query}` : 'Discover: scanning link');
    if (out) { setResults(out.map((e, i) => Object.assign({}, e, { _i: i }))); setSel([]); }
  };
  const ranked = useMemo(() => (results ? rankList(results, f.mode) : []), [results, f.mode]);
  const mode = data.RANKING.find((m) => m[0] === f.mode);
  return html`<div class="page">
    <${PageHeader} title="Discover" sub="Find the videos worth studying — ranked by what's actually working." module=${M} help="vision.discover" />
    <div class="discover-form panel">
      <div class="row gap wrap"><${Segmented} value=${src} onChange=${setSrc} options=${[['search', 'Search'], ['link', 'Channel, playlist or any link']]} />
        ${src === 'search' ? html`<${Segmented} value=${f.platform} onChange=${(v) => setF(Object.assign({}, f, { platform: v }))} options=${[['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['instagram', 'Instagram']]} />` : null}
        ${f.platform !== 'youtube' || src === 'link' ? html`<span class="row gap small">${['instagram', 'tiktok'].map((site) => (signed.data && signed.data[site]) ? html`<span class="badge ok">${site === 'tiktok' ? 'TikTok' : 'Instagram'} signed in</span><button class="link-btn small" onClick=${async () => signed.set(await call('discover.signOut', { site }))}>Sign out</button>` : html`<button class="link-btn small" onClick=${async () => { signed.set(await call('discover.signIn', { site })); }}>Sign in to ${site === 'tiktok' ? 'TikTok' : 'Instagram'} (optional)</button>`)}</span>` : null}</div>
      ${src === 'search' ? html`<div class="discover-row">
        <input class="input grow" placeholder=${f.platform === 'youtube' ? 'What are you researching? e.g. faceless youtube automation' : f.platform === 'tiktok' ? 'Hashtag, topic or @creator — e.g. #booktok or @creator' : 'Hashtag or @account — e.g. #fitnessmotivation'} value=${f.query} onInput=${(e) => setF(Object.assign({}, f, { query: e.target.value }))} onKeyDown=${(e) => e.key === 'Enter' && f.query && search()} />
        ${f.platform === 'youtube' ? html`<${Select} value=${f.market} onChange=${(v) => setF(Object.assign({}, f, { market: v }))} options=${data.MARKETS} />
        <${Select} value=${f.filter} onChange=${(v) => setF(Object.assign({}, f, { filter: v }))} options=${data.SEARCH_FILTERS} />` : html`<${Select} value=${f.filter} onChange=${(v) => setF(Object.assign({}, f, { filter: v }))} options=${[['any', 'Any time'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['short', 'Under 1 minute'], ['long', 'Over 3 minutes']]} />`}
        <${Select} value=${String(f.limit)} onChange=${(v) => setF(Object.assign({}, f, { limit: Number(v) }))} options=${[['20', '20 results'], ['30', '30 results'], ['50', '50 results']]} />
        <${Button} kind="primary" icon="search" busy=${r.busy} disabled=${!f.query} onClick=${search}>Search</${Button}>
      </div>` : html`<div class="discover-row">
        <input class="input grow" placeholder="Paste a YouTube channel, playlist, TikTok profile or any video page" value=${f.url} onInput=${(e) => setF(Object.assign({}, f, { url: e.target.value }))} />
        <${Button} kind="primary" icon="search" busy=${r.busy} disabled=${!f.url} onClick=${search}>Scan</${Button}>
      </div>`}
      <div class="rank-modes">${data.RANKING.map((m) => html`<button class=${'chip ' + (f.mode === m[0] ? 'on' : '')} title=${m[2]} onClick=${() => setF(Object.assign({}, f, { mode: m[0] }))}>${m[1]}</button>`)}</div>
      ${mode ? html`<p class="muted small">${mode[1]}: ${mode[2]}.</p>` : null}
    </div>
    <${Progress} runner=${r} />
    ${results ? html`<div class="row between results-bar"><span class="muted">${count(ranked.length, 'video')} — ${sel.length} selected</span>
      <div class="row gap"><${Button} size="sm" onClick=${() => setSel(sel.length ? [] : ranked.slice(0, 10).map((x) => x.url))}>${sel.length ? 'Clear' : 'Select top 10'}</${Button}>
      <${Button} size="sm" icon="copy" disabled=${!sel.length} onClick=${() => copy(sel.join('\n'), 'Links copied')}>Copy links</${Button}>
      <${Select} value="" onChange=${async (fmt) => { if (!fmt) return; const ext = { csv: 'csv', html: 'html', md: 'md', txt: 'txt' }[fmt]; const file = await saveFile({ defaultPath: `Discover - ${(f.query || 'results').slice(0, 40)}.${ext}`, filters: [{ name: fmt.toUpperCase(), extensions: [ext] }] }); if (file) { await call('vision.discoverExport', { results: ranked.map((x, i) => Object.assign({ rank: i + 1 }, x)), format: fmt, file, title: f.query || f.url, mode: mode ? mode[1] : '' }); showInFolder(file); } }} options=${[['', 'Export…'], ['csv', 'Spreadsheet (.csv)'], ['html', 'Web page (.html)'], ['md', 'Markdown (.md)'], ['txt', 'Text (.txt)']]} />
      <${Button} size="sm" kind="primary" icon="eye" disabled=${!sel.length} onClick=${() => setSend(true)}>Analyze selected</${Button}></div></div>
      <div class="vid-grid">${ranked.map((e, i) => html`<article class=${'vid-card ' + (sel.includes(e.url) ? 'sel' : '')} onClick=${() => setSel(sel.includes(e.url) ? sel.filter((x) => x !== e.url) : sel.concat([e.url]))}>
        <div class="vid-thumb">${e.thumbnail ? html`<img loading="lazy" src=${e.thumbnail} alt="" />` : null}<span class="vid-dur">${clock(e.duration)}</span><span class="vid-rank">${i + 1}</span>${e.license && /creative/i.test(e.license) ? html`<span class="vid-cc">CC</span>` : null}</div>
        <h4>${e.title}</h4>
        <div class="vid-meta"><span>${e.channel}${e.followers ? ` (${num(e.followers)})` : ''}</span></div>
        <div class="vid-stats"><span title="Views">${num(e.views)} views</span><span title="Likes">${num(e.likes)} likes</span><span title="Comments">${num(e.comments)} comments</span>${e.uploadDate ? html`<span>${fmtDate(e.uploadDate)}</span>` : null}</div>
        <button class="link-btn small" onClick=${(ev) => { ev.stopPropagation(); openUrl(e.url); }}>Open</button>
      </article>`)}</div>` : html`<${Empty} icon="search" title="Search for a topic or paste a channel">Results are ranked by the mode you pick — Standout finds videos that beat their channel's size. No API key needed.</${Empty}>`}
    ${send ? html`<${SendToProject} items=${ranked.filter((x) => sel.includes(x.url))} onClose=${() => setSend(false)} />` : null}
  </div>`;
}

function SendToProject({ items, onClose }) {
  const projects = useProjects();
  const [pid, setPid] = useState(state.visionProject);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const go2 = async () => {
    setBusy(true);
    try {
      let id = pid;
      if (!id || id === '__new') id = (await call('vision.createProject', { name: name || 'Discover research' })).id;
      const added = await call('vision.addVideos', { projectId: id, items });
      setProject(id);
      for (const v of added) run('vision.process', { projectId: id, videoId: v.id }, `Analyze: ${v.title.slice(0, 40)}`).catch(() => {});
      toast(`${added.length} video(s) are being analyzed`, 'ok');
      go('vision.projects', { open: id });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const opts = (projects.data || []).map((p) => [p.id, p.name]).concat([['__new', '+ New project']]);
  return html`<${Modal} title=${`Analyze ${count(items.length, 'video')}`} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${busy} onClick=${go2}>Add and analyze</${Button}>`}>
    <${Field} label="Project"><${Select} value=${pid || '__new'} onChange=${setPid} options=${opts} /></${Field}>
    ${!pid || pid === '__new' ? html`<${Field} label="New project name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Discover research" /></${Field}>` : null}
    <p class="muted small">Each video is downloaded, transcribed (or its captions used), split into key frames and described by your vision model.</p>
  </${Modal}>`;
}

// ------------------------------------------------------------------ Analysis: projects + videos
export function Projects({ open }) {
  const projects = useProjects();
  const pid = useStore((s) => s.visionProject);
  useEffect(() => { if (open) setProject(open); }, [open]);
  const project = useAsync(() => (pid ? call('vision.project', { id: pid }) : Promise.resolve(null)), [pid]);
  const jobs = useStore((s) => s.jobs);
  const running = Object.values(jobs).filter((j) => j.state === 'running' && j.module === M).length;
  useEffect(() => { const t = setInterval(() => { if (pid && running) project.reload(); }, 4000); return () => clearInterval(t); }, [pid, running]);
  const [urls, setUrls] = useState('');
  const [del, setDel] = useState(null);
  const [rename, setRename] = useState(null);
  const p = project.data;
  const processAll = (ids) => {
    for (const id of ids) {
      const v = p.videos.find((x) => x.id === id);
      run('vision.process', { projectId: p.id, videoId: id }, `Analyze: ${(v ? v.title : id).slice(0, 40)}`).then(() => project.reload()).catch((e) => { if (e.code !== 'cancelled') toast(e.message, 'error'); project.reload(); });
    }
    setTimeout(project.reload, 600);
  };
  const add = async (files, links) => {
    try {
      const added = await call('vision.addVideos', { projectId: p.id, files: files || [], urls: links || [] });
      setUrls('');
      await project.reload();
      projects.reload();
      processAll(added.map((v) => v.id));
    } catch (e) { toast(e.message, 'error'); }
  };
  const proj = useRunner(M);
  return html`<div class="page">
    <${PageHeader} title="Analysis" sub="Add videos, and the engine watches and listens: key frames + transcript, combined into one report." module=${M} help="vision.analysis"><${ProjectBar} projects=${projects} /></${PageHeader}>
    ${!(projects.data || []).length && !projects.loading ? html`<${Empty} icon="eye" title="Start your first project" action=${html`<${Button} kind="primary" onClick=${async () => { const n = await call('vision.createProject', { name: 'My first project' }); setProject(n.id); projects.reload(); }}>Create a project</${Button}>`}>A project can hold one video or a whole series you want to compare.</${Empty}>` : null}
    ${p ? html`<div class="analysis">
      <div class="analysis-add panel">
        <${Dropzone} label="Drop video or audio files" sub="MP4, MOV, MKV, WEBM, MP3, WAV… — or click to browse" icon="film" accept=${/\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpg|mpeg|3gp|ts|mts|mp3|m4a|wav|flac|ogg|opus|aac)$/i} onFiles=${(f) => add(f, [])} onPick=${async () => { const f = await pickFiles({ multi: true, filters: MEDIA_FILTERS }); if (f.length) add(f, []); }} />
        <div class="add-links"><textarea class="input" rows="4" placeholder="Or paste video links, one per line (YouTube, TikTok, Instagram, Vimeo and 1,800+ sites)" value=${urls} onInput=${(e) => setUrls(e.target.value)} />
          <${Button} kind="primary" disabled=${!urls.trim()} onClick=${() => add([], urls.split(/\s+/).filter(Boolean))}>Add links</${Button}></div>
      </div>
      <div class="row between"><h3>${p.name} — ${count(p.videos.length, 'video')}</h3><div class="row gap">
        <${Button} size="sm" onClick=${() => setRename(p)}>Rename</${Button}>
        ${p.videos.some((v) => v.status !== 'ready') ? html`<${Button} size="sm" icon="play" onClick=${() => processAll(p.videos.filter((v) => v.status !== 'ready' && v.status !== 'processing').map((v) => v.id))}>Process all waiting</${Button}>` : null}
        ${p.videos.filter((v) => v.status === 'ready').length > 1 ? html`<${Button} size="sm" icon="layers" busy=${proj.busy} onClick=${async () => { const r = await proj.run('vision.projectReport', { projectId: p.id }, 'Cross-video report'); if (r) project.reload(); }}>Compare videos</${Button}>` : null}
        <${Button} size="sm" kind="danger" onClick=${() => setDel(p)}>Delete project</${Button}>
      </div></div>
      <${Progress} runner=${proj} />
      ${p.videos.length ? html`<div class="video-list">${p.videos.map((v) => html`<div class=${'video-row st-' + v.status}>
        <button class="video-thumb" onClick=${() => v.status === 'ready' || v.hasTranscript ? go('vision.video', { projectId: p.id, videoId: v.id }) : null}>${v.thumb ? html`<img src=${/^https?:/.test(v.thumb) ? v.thumb : mediaUrl(v.thumb)} alt="" />` : html`<${Icon} name="film" />`}${v.duration ? html`<span class="vid-dur">${clock(v.duration)}</span>` : null}</button>
        <div class="video-info"><b>${v.title}</b>
          <span class="muted small">${v.status === 'ready' ? `${v.frames} frames — ${v.described} described — ${count(v.reports.length, 'report')}` : v.status === 'processing' ? 'Analyzing…' : v.status === 'error' ? v.error : 'Waiting to be analyzed'}</span>
          ${v.status === 'processing' ? html`<${VideoJob} videoTitle=${v.title} />` : null}</div>
        <div class="row gap">
          ${v.status === 'ready' || v.hasTranscript ? html`<${Button} size="sm" kind="primary" onClick=${() => go('vision.video', { projectId: p.id, videoId: v.id })}>Open</${Button}>` : null}
          ${v.status !== 'processing' && v.status !== 'ready' ? html`<${Button} size="sm" icon=${v.status === 'error' ? 'refresh' : 'play'} onClick=${() => processAll([v.id])}>${v.status === 'error' ? 'Retry' : 'Analyze'}</${Button}>` : null}
          <${IconButton} icon="trash" title="Remove video" onClick=${async () => { await call('vision.removeVideo', { projectId: p.id, videoId: v.id }); project.reload(); }} />
        </div></div>`)}</div>` : html`<p class="muted">Add your first video above.</p>`}
      ${Object.keys(p.reports || {}).length ? html`<section class="panel"><h3>Cross-video report</h3><${Markdown} text=${Object.values(p.reports).sort((a, b) => b.created - a.created)[0].markdown} /></section>` : null}
    </div>` : null}
    ${del ? html`<${Confirm} title="Delete project?" text=${`"${del.name}" and its analysis will be deleted. Your original video files are not touched.`} onClose=${() => setDel(null)} onYes=${async () => { await call('vision.deleteProject', { id: del.id }); setProject(''); projects.reload(); }} />` : null}
    ${rename ? html`<${RenameModal} p=${rename} onClose=${() => setRename(null)} onDone=${() => { setRename(null); projects.reload(); project.reload(); }} />` : null}
  </div>`;
}

function RenameModal({ p, onClose, onDone }) {
  const [name, setName] = useState(p.name);
  return html`<${Modal} title="Rename project" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" onClick=${async () => { await call('vision.renameProject', { id: p.id, name }); onDone(); }}>Save</${Button}>`}><${Field} label="Name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /></${Field}></${Modal}>`;
}

function VideoJob({ videoTitle }) {
  const j = useStore((s) => Object.values(s.jobs).find((x) => x.state === 'running' && x.label && x.label.includes(videoTitle.slice(0, 40))));
  if (!j) return null;
  return html`<div class="mini-progress"><div class="bar"><i style=${{ width: Math.max(2, j.progress) + '%' }} /></div><small>${j.message}</small></div>`;
}

// ------------------------------------------------------------------ Video workspace
export function VideoWorkspace({ projectId, videoId, t: startAt }) {
  const v = useAsync(() => call('vision.video', { projectId, videoId }), [videoId]);
  const [tab, setTab] = useState('report');
  const vref = useRef(null);
  const [now, setNow] = useState(0);
  const seek = (t) => { const el = vref.current; if (el) { el.currentTime = t; el.play().catch(() => {}); } };
  useEffect(() => { if (startAt && vref.current) vref.current.currentTime = Number(startAt); }, [v.data]);
  if (v.loading && !v.data) return html`<div class="page"><${Spinner} /></div>`;
  if (v.error) return html`<div class="page"><${ErrorBox} error=${v.error} retry=${v.reload} /></div>`;
  const d = v.data;
  const frameAt = frameFinder(d.frames);
  return html`<div class="page workspace">
    <div class="ws-head"><button class="link-btn" onClick=${() => go('vision.projects', { open: projectId })}>← Analysis</button><h1>${d.title}</h1>
      <span class="muted small">${clock(d.duration)} — ${d.frames.length} key frames — ${(d.transcript && d.transcript.segments.length) || 0} transcript lines${d.transcript && d.transcript.engine ? ` (${d.transcript.engine === 'captions' ? 'platform captions' : d.transcript.engine + ' ' + (d.transcript.model || '')})` : ''}</span></div>
    <div class="ws-grid">
      <div class="ws-left">
        <div class="player">${d.file ? html`<video ref=${vref} src=${mediaUrl(d.file)} controls preload="metadata" onTimeUpdate=${(e) => setNow(e.target.currentTime)} />` : html`<div class="player-missing">Video file not on this computer.</div>`}</div>
        <${Filmstrip} frames=${d.frames} duration=${d.duration} now=${now} onSeek=${seek} />
        <div class="row gap wrap ws-tools">
          <${Button} size="sm" icon="scissors" onClick=${() => go('vision.clips', { videoId })}>Make clips</${Button}>
          <${Button} size="sm" icon="chat" onClick=${() => go('vision.chat', { videoId })}>Chat with this video</${Button}>
          <${Button} size="sm" icon="doc" onClick=${() => go('vision.docs', { videoIds: [videoId] })}>Create a document</${Button}>
        </div>
      </div>
      <div class="ws-right">
        <${Tabs} value=${tab} onChange=${setTab} tabs=${[['report', 'Report', Object.keys(d.reports || {}).length], ['transcript', 'Transcript'], ['frames', 'Frames', d.frames.length]]} />
        ${tab === 'report' ? html`<${Reports} d=${d} projectId=${projectId} frameAt=${frameAt} seek=${seek} reload=${v.reload} />` : null}
        ${tab === 'transcript' ? html`<${TranscriptPane} d=${d} now=${now} seek=${seek} />` : null}
        ${tab === 'frames' ? html`<div class="frame-grid small">${d.frames.map((f) => html`<button class="frame" onClick=${() => seek(f.t)} title=${f.desc}><img loading="lazy" src=${mediaUrl(f.path)} alt="" /><span class="tc">${clock(f.t)}</span></button>`)}</div>` : null}
      </div>
    </div>
  </div>`;
}

function Filmstrip({ frames, duration, now, onSeek }) {
  const ref = useRef(null);
  if (!duration) return null;
  const click = (e) => { const r = ref.current.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * duration); };
  return html`<div class="filmstrip" ref=${ref} onClick=${click} title="Click to jump">
    <div class="filmstrip-track">${frames.map((f) => html`<img src=${mediaUrl(f.path)} style=${{ left: (f.t / duration) * 100 + '%' }} alt="" loading="lazy" />`)}</div>
    <div class="filmstrip-ruler">${[0, 0.25, 0.5, 0.75, 1].map((x) => html`<span style=${{ left: x * 100 + '%' }}>${clock(x * duration)}</span>`)}</div>
    <i class="filmstrip-head" style=${{ left: (now / duration) * 100 + '%' }} />
  </div>`;
}

function TranscriptPane({ d, now, seek }) {
  const [q, setQ] = useState('');
  const segs = (d.transcript && d.transcript.segments) || [];
  const shown = q ? segs.filter((s) => s.text.toLowerCase().includes(q.toLowerCase())) : segs;
  const activeRef = useRef(null);
  const active = segs.findIndex((s) => now >= s.start && now < s.end);
  return html`<div class="transcript">
    <div class="row gap"><input class="input grow" placeholder="Search transcript" value=${q} onInput=${(e) => setQ(e.target.value)} /><${Copyable} text=${(d.transcript && d.transcript.text) || ''} label="Copy text" /></div>
    <div class="transcript-lines">${shown.map((s) => html`<div class=${'tline ' + (segs[active] === s ? 'on' : '')}><${Timecode} t=${s.start} onSeek=${seek} /><p>${s.text}</p></div>`)}
    ${!segs.length ? html`<p class="muted">No speech found in this video.</p>` : null}</div>
  </div>`;
}

/** Readable name for a report key such as "builtin/vision" or "gemini-watch/…". */
function repLabel(k) {
  if (/^builtin\//.test(k)) return 'Built-in AI';
  if (/^gemini-watch\//.test(k)) return k.replace('gemini-watch/', 'Watched by ');
  return k;
}

function Reports({ d, projectId, frameAt, seek, reload }) {
  const adv = useStore((s) => Boolean(s.info && s.info.advanced));
  const keys = Object.keys(d.reports || {}).sort((a, b) => d.reports[b].created - d.reports[a].created);
  const [key, setKey] = useState(keys[0] || '');
  const [newRep, setNewRep] = useState(false);
  const [gem, setGem] = useState(null);
  const [lang, setLang] = useState('');
  const r = useRunner(M);
  const rep = d.reports[key];
  const translateIt = async () => { const out = await r.run('vision.translateReport', { projectId, videoId: d.id, key, lang }, 'Translate report'); if (out) { await reload(); setKey(out.key); } };
  return html`<div class="reports">
    <div class="row gap wrap">
      ${keys.length ? html`<${Select} value=${key} onChange=${setKey} options=${keys.map((k) => [k, repLabel(k)])} />` : null}
      <${Button} size="sm" icon="sparkle" onClick=${() => setNewRep(true)}>${keys.length ? 'Another model' : 'Write report'}</${Button}>
      ${adv ? html`<${Button} size="sm" icon="eye" onClick=${async () => { try { setGem(await call('vision.geminiEstimate', { projectId, videoId: d.id })); } catch (e) { toast(e.message, 'error'); } }}>Watch with Gemini</${Button}>` : null}
      ${rep ? html`<${Copyable} text=${rep.markdown} />` : null}
      ${rep ? html`<${Select} value="" onChange=${async (fmt) => { if (!fmt) return; const ext = fmt === 'video' ? 'mp4' : fmt; const base = (d.title || 'Report').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80); const file = await saveFile({ defaultPath: `${base}${fmt === 'video' ? ' - summary' : ''}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }); if (!file) return; const o = await r.run('vision.exportReport', { projectId, videoId: d.id, key, format: fmt, file }, fmt === 'video' ? 'Make summary video' : 'Save report', 'Saved'); if (o) showInFolder(o.file); }} options=${[['', 'Save as…'], ['txt', 'Text (.txt)'], ['md', 'Markdown (.md)'], ['docx', 'Word (.docx)'], ['pdf', 'PDF'], ['html', 'Web page (.html)'], ['video', 'Narrated summary video (.mp4)']]} />` : null}
    </div>
    <${Progress} runner=${r} />
    ${rep ? html`<div class="report-body"><${Markdown} text=${rep.markdown} onSeek=${seek} frameAt=${frameAt} /></div>
      <div class="row gap translate-row"><${LangSelect} value=${lang} onChange=${setLang} list=${NLLB} placeholder="Translate this report to…" /><${Button} size="sm" disabled=${!lang} busy=${r.busy} onClick=${translateIt}>Translate</${Button}>
      <${Button} size="sm" kind="ghost" onClick=${async () => { await call('vision.deleteReport', { projectId, videoId: d.id, key }); await reload(); setKey(''); }}>Delete report</${Button}></div>`
      : html`<${Empty} icon="doc" title="No report yet">Reports combine what was said and what was shown, with clickable timestamps. Write one with any model — results from different models are kept side by side.</${Empty}>`}
    ${newRep ? html`<${ModelReport} onClose=${() => setNewRep(false)} onRun=${async (prov, model) => { setNewRep(false); const out = await r.run('vision.report', { projectId, videoId: d.id, provider: prov, model }, 'Write report'); if (out) { await reload(); setKey(out.key); } }} />` : null}
    ${gem ? html`<${Modal} title="Watch the full video with Gemini" onClose=${() => setGem(null)} footer=${html`<${Button} onClick=${() => setGem(null)}>Cancel</${Button}><${Button} kind="primary" onClick=${async () => { setGem(null); const out = await r.run('vision.watchGemini', { projectId, videoId: d.id, model: gem.model }, 'Watch with Gemini'); if (out) { await reload(); setKey(out.key); } }}>Upload and analyze</${Button}>`}>
      <p>The whole video is uploaded to Google and Gemini watches every second of it, including motion and sound.</p>
      <div class="stat-row"><div><b>~${(gem.tokens / 1000).toFixed(0)}K</b><span>input tokens</span></div><div><b>~$${gem.usd}</b><span>estimated cost (${gem.model})</span></div></div>
      <p class="muted small">${gem.note} Billed by Google to your Gemini key.</p>
    </${Modal}>` : null}
  </div>`;
}

function ModelReport({ onClose, onRun }) {
  const prov = useAsync(() => call('ai.providers'), []);
  const s = useAsync(() => call('settings.get'), []);
  const [p, setP] = useState('');
  const [m, setM] = useState('');
  useEffect(() => { if (s.data && !p) { const tp = s.data.settings.ai.textProvider; setP(tp); setM(tp === 'builtin' ? 'standard' : s.data.settings.ai.models[tp]); } }, [s.data]);
  return html`<${Modal} title="Write a report with…" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" disabled=${!p || !m} onClick=${() => onRun(p, m)}>Write report</${Button}>`}>
    ${prov.data && s.data ? html`<${Field} label="Provider"><${Select} value=${p} onChange=${(v) => { setP(v); setM(v === 'builtin' ? 'standard' : (s.data.settings.ai.models[v] || '')); }} options=${Object.entries(prov.data).map(([k, x]) => [k, x.label + (x.local ? ' (offline)' : '')])} /></${Field}>
    ${p === 'builtin' ? html`<p class="muted small">Written by the built-in AI. Uses AI credits.</p>` : html`<${Field} label="Model"><input class="input" value=${m} onInput=${(e) => setM(e.target.value)} /></${Field}>`}` : html`<${Spinner} />`}
  </${Modal}>`;
}

// ------------------------------------------------------------------ Findings
export function Findings() {
  return html`<${ToolPage} title="Findings" sub="Pull structured findings out of your videos through a lens — every finding cites its frame." help="vision.findings">${(p, reload) => html`<${FindingsBody} p=${p} reload=${reload} />`}</${ToolPage}>`;
}

function FindingsBody({ p, reload }) {
  const [lens, setLens] = useState('claims');
  const [q, setQ] = useState('');
  const [vids, setVids] = useState([]);
  const [open, setOpen] = useState((p.findings || [])[0] ? p.findings[0].id : '');
  const r = useRunner(M);
  const runIt = async () => { const out = await r.run('vision.findings', { projectId: p.id, videoIds: vids, lens: lens === 'custom' ? '' : lens, question: lens === 'custom' ? q : '' }, 'Findings'); if (out) { await reload(); setOpen(out.id); } };
  const cur = (p.findings || []).find((f) => f.id === open);
  return html`<div class="tool-grid">
    <aside class="panel tool-form">
      <h3>Lens</h3>
      <div class="lens-list">${data.LENSES.map((l) => html`<button class=${'lens ' + (lens === l[0] ? 'on' : '')} onClick=${() => setLens(l[0])}><b>${l[1]}</b><span>${l[2]}</span></button>`)}
        <button class=${'lens ' + (lens === 'custom' ? 'on' : '')} onClick=${() => setLens('custom')}><b>Your own question</b><span>Ask anything about the videos.</span></button></div>
      ${lens === 'custom' ? html`<${Field} label="Question"><textarea class="input" rows="3" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="e.g. Which objections does the presenter handle, and how?" /></${Field}>` : null}
      <${Field} label="Videos"><${VideoPicker} project=${p} value=${vids} onChange=${setVids} multi /></${Field}>
      <${Button} kind="primary" icon="flag" busy=${r.busy} disabled=${lens === 'custom' && !q.trim()} onClick=${runIt}>Extract findings</${Button}>
      <${Progress} runner=${r} />
      ${(p.findings || []).length ? html`<h3>History</h3><div class="history">${p.findings.map((f) => html`<button class=${'hist ' + (f.id === open ? 'on' : '')} onClick=${() => setOpen(f.id)}><b>${f.lens}${f.question ? ': ' + f.question.slice(0, 40) : ''}</b><span>${count(f.items.length, 'finding')} — ${ago(f.created)}</span></button>`)}</div>` : null}
    </aside>
    <section class="tool-out">
      ${cur ? html`<div class="row between"><h2>${cur.lens}${cur.question ? ': ' + cur.question : ''}</h2><div class="row gap">
        <${Copyable} text=${cur.items.map((i) => `[${clock(i.t)}] ${i.title} — ${i.detail}${i.quote ? ` ("${i.quote}")` : ''}`).join('\n')} />
        <${IconButton} icon="trash" title="Delete" onClick=${async () => { await call('vision.deleteFindings', { projectId: p.id, id: cur.id }); reload(); }} /></div></div>
        <div class="findings">${cur.items.map((i) => html`<article class="finding">
          ${i.frame ? html`<button class="finding-frame" onClick=${() => go('vision.video', { projectId: p.id, videoId: i.video, t: i.t })}><img src=${mediaUrl(i.frame)} alt="" /></button>` : null}
          <div><div class="row gap"><${Timecode} t=${i.t} onSeek=${(t) => go('vision.video', { projectId: p.id, videoId: i.video, t })} /><b>${i.title}</b></div>
          <p>${i.detail}</p>${i.quote ? html`<blockquote>${i.quote}</blockquote>` : null}${p.videos.length > 1 ? html`<span class="muted small">${i.videoTitle}</span>` : null}</div></article>`)}</div>`
        : html`<${Empty} icon="flag" title="Pick a lens and extract">Findings are saved here so you can come back to them.</${Empty}>`}
    </section>
  </div>`;
}

// ------------------------------------------------------------------ Assets
export function Assets() {
  return html`<${ToolPage} title="Assets" sub="Every key frame from every video in the project, searchable by what's on screen." help="vision.assets">${(p) => html`<${AssetsBody} p=${p} />`}</${ToolPage}>`;
}

function AssetsBody({ p }) {
  const [q, setQ] = useState('');
  const [qq, setQQ] = useState('');
  const a = useAsync(() => call('vision.assets', { projectId: p.id, query: qq }), [qq, p.id]);
  const [view, setView] = useState(null);
  const r = useRunner(M);
  useEffect(() => { const t = setTimeout(() => setQQ(q), 300); return () => clearTimeout(t); }, [q]);
  return html`<div>
    <div class="row gap"><input class="input grow" placeholder="Search frames: 'pricing slide', 'whiteboard', any on-screen text…" value=${q} onInput=${(e) => setQ(e.target.value)} /><span class="muted small">${a.data ? count(a.data.length, 'frame') : ''}</span></div>
    ${a.data ? html`<div class="frame-grid">${a.data.map((f) => html`<button class="frame" onClick=${() => setView(f)}><img loading="lazy" src=${mediaUrl(f.path)} alt="" /><span class="tc">${clock(f.t)}</span>${f.desc ? html`<span class="frame-desc">${f.desc}</span>` : null}</button>`)}</div>` : html`<${Spinner} />`}
    ${view ? html`<${Modal} wide title=${`${view.videoTitle} @ ${clock(view.t)}`} onClose=${() => setView(null)} footer=${html`
      <${Button} icon="copy" onClick=${() => copy(view.desc + (view.text ? `\nOn-screen text: ${view.text}` : ''))}>Copy description</${Button}>
      <${Button} icon="eye" onClick=${() => go('vision.video', { projectId: p.id, videoId: view.video, t: view.t })}>Open video here</${Button}>
      <${Button} kind="primary" icon="download" busy=${r.busy} onClick=${async () => { const f = await r.run('vision.saveFullFrame', { projectId: p.id, videoId: view.video, t: view.t }, 'Save full-resolution frame'); if (f) { toast('Saved at source resolution', 'ok'); showInFolder(f); } }}>Save full resolution</${Button}>`}>
      <img class="asset-big" src=${mediaUrl(view.path)} alt="" />
      ${view.desc ? html`<p>${view.desc}</p>` : null}${view.text ? html`<p class="muted">On-screen text: “${view.text}”</p>` : null}
    </${Modal}>` : null}
  </div>`;
}

// ------------------------------------------------------------------ Clips
export function Clips({ videoId: initialVid }) {
  return html`<${ToolPage} title="Clips" sub="Find the highlight moments and render captioned vertical, square or wide clips — locally, no watermark." help="vision.clips">${(p) => html`<${ClipsBody} p=${p} initialVid=${initialVid} />`}</${ToolPage}>`;
}

function ClipsBody({ p, initialVid }) {
  const ready = p.videos.filter((v) => v.status === 'ready' || v.hasTranscript);
  const [vid, setVid] = useState(initialVid && ready.find((v) => v.id === initialVid) ? initialVid : (ready[0] || {}).id);
  const v = useAsync(() => (vid ? call('vision.video', { projectId: p.id, videoId: vid }) : Promise.resolve(null)), [vid]);
  const [opts, setOpts] = useState({ count: 6, minLen: 20, maxLen: 60, focus: '' });
  const [render, setRender] = useState({ aspect: '9:16', framing: 'crop', offsetX: 0.5, captions: { on: true, preset: 'karaoke', color: '#ffffff', highlight: '#ffd400', position: 'bottom', uppercase: false } });
  const [cur, setCur] = useState(null);
  const finder = useRunner(M);
  const renderer = useRunner(M);
  const vref = useRef(null);
  const clips = (v.data && v.data.clips) || [];
  useEffect(() => { if (clips.length && !cur) setCur(clips[0].id); }, [v.data]);
  const clip = clips.find((c) => c.id === cur);
  const [edit, setEdit] = useState(null);
  useEffect(() => { setEdit(clip ? { start: clip.start, end: clip.end, title: clip.title } : null); }, [cur, v.data]);
  const play = () => {
    const el = vref.current;
    if (!el || !edit) return;
    el.currentTime = edit.start;
    el.play();
    const stop = () => { if (el.currentTime >= edit.end) { el.pause(); el.removeEventListener('timeupdate', stop); } };
    el.addEventListener('timeupdate', stop);
  };
  const find = async () => { const out = await finder.run('vision.findClips', Object.assign({ projectId: p.id, videoId: vid }, opts), 'Find highlights'); if (out) { await v.reload(); setCur(out[0] && out[0].id); } };
  const doRender = async () => {
    if (!edit) return;
    await call('vision.updateClip', { projectId: p.id, videoId: vid, clip: Object.assign({}, clip, edit) });
    const out = await renderer.run('vision.renderClip', Object.assign({ projectId: p.id, videoId: vid, clipId: clip.id, start: edit.start, end: edit.end }, render), `Render clip: ${edit.title.slice(0, 30)}`, 'Clip rendered');
    if (out) v.reload();
  };
  const nudge = (k, d) => setEdit(Object.assign({}, edit, { [k]: Math.max(0, +(edit[k] + d).toFixed(2)) }));
  const cap = render.captions;
  const setCap = (x) => setRender(Object.assign({}, render, { captions: Object.assign({}, cap, x) }));
  return html`<div class="clips">
    <div class="panel clips-top">
      <${Field} label="Video"><${VideoPicker} project=${p} value=${vid} onChange=${(x) => { setVid(x); setCur(null); }} /></${Field}>
      <${Field} label="How many"><${Select} value=${String(opts.count)} onChange=${(x) => setOpts(Object.assign({}, opts, { count: Number(x) }))} options=${[['3', '3'], ['6', '6'], ['10', '10'], ['15', '15']]} /></${Field}>
      <${Field} label="Length"><${Select} value=${`${opts.minLen}-${opts.maxLen}`} onChange=${(x) => { const [a, b] = x.split('-').map(Number); setOpts(Object.assign({}, opts, { minLen: a, maxLen: b })); }} options=${[['10-30', '10–30 s'], ['20-60', '20–60 s'], ['30-90', '30–90 s'], ['60-180', '1–3 min']]} /></${Field}>
      <${Field} label="Focus (optional)"><input class="input" value=${opts.focus} onInput=${(e) => setOpts(Object.assign({}, opts, { focus: e.target.value }))} placeholder="e.g. funny moments, tips, the offer" /></${Field}>
      <${Button} kind="primary" icon="sparkle" busy=${finder.busy} onClick=${find}>Find highlights</${Button}>
    </div>
    <${Progress} runner=${finder} />
    ${v.data ? html`<div class="clips-grid">
      <div class="clip-list">${clips.length ? clips.map((c) => html`<button class=${'clip-item ' + (c.id === cur ? 'on' : '')} onClick=${() => setCur(c.id)}><b>${c.title}</b><span>${clock(c.start)}–${clock(c.end)} (${Math.round(c.end - c.start)} s)${c.score ? ` — score ${c.score}/10` : ''}</span>${c.hook ? html`<small>“${c.hook}”</small>` : null}${c.renders && c.renders.length ? html`<${Badge} kind="ok">${c.renders.length} rendered</${Badge}>` : null}</button>`) : html`<p class="muted">Click “Find highlights”, or add a clip manually.</p>`}
        <${Button} size="sm" icon="plus" onClick=${async () => { const list = await call('vision.updateClip', { projectId: p.id, videoId: vid, clip: { title: 'My clip', start: 0, end: 30 } }); await v.reload(); setCur(list[list.length - 1].id); }}>Add clip manually</${Button}></div>
      <div class="clip-editor">
        <div class="player">${v.data.file ? html`<video ref=${vref} src=${mediaUrl(v.data.file)} controls preload="metadata" />` : null}</div>
        ${edit ? html`<div class="panel">
          <div class="clip-times">
            <${Field} label="Title"><input class="input" value=${edit.title} onInput=${(e) => setEdit(Object.assign({}, edit, { title: e.target.value }))} /></${Field}>
            <${Field} label="Start"><div class="row gap"><${IconButton} icon="chevron" title="−0.5 s" cls="flip" onClick=${() => nudge('start', -0.5)} /><input class="input tnum" value=${clock(edit.start)} onChange=${(e) => setEdit(Object.assign({}, edit, { start: parseClock(e.target.value) }))} /><${IconButton} icon="chevron" title="+0.5 s" onClick=${() => nudge('start', 0.5)} /><${Button} size="sm" onClick=${() => vref.current && setEdit(Object.assign({}, edit, { start: +vref.current.currentTime.toFixed(2) }))}>Set to playhead</${Button}></div></${Field}>
            <${Field} label="End"><div class="row gap"><${IconButton} icon="chevron" title="−0.5 s" cls="flip" onClick=${() => nudge('end', -0.5)} /><input class="input tnum" value=${clock(edit.end)} onChange=${(e) => setEdit(Object.assign({}, edit, { end: parseClock(e.target.value) }))} /><${IconButton} icon="chevron" title="+0.5 s" onClick=${() => nudge('end', 0.5)} /><${Button} size="sm" onClick=${() => vref.current && setEdit(Object.assign({}, edit, { end: +vref.current.currentTime.toFixed(2) }))}>Set to playhead</${Button}></div></${Field}>
            <${Button} icon="play" onClick=${play}>Preview ${Math.round(edit.end - edit.start)} s</${Button}>
          </div>
          <div class="grid2">
            <${Field} label="Format"><${Segmented} value=${render.aspect} onChange=${(x) => setRender(Object.assign({}, render, { aspect: x }))} options=${[['9:16', '9:16 vertical'], ['1:1', '1:1 square'], ['16:9', '16:9 wide']]} /></${Field}>
            <${Field} label="Framing"><${Segmented} value=${render.framing} onChange=${(x) => setRender(Object.assign({}, render, { framing: x }))} options=${[['crop', 'Crop'], ['fit', 'Fit + blur'], ['split', 'Split']]} /></${Field}>
          </div>
          ${render.framing === 'crop' ? html`<${Range} label="Crop position" value=${render.offsetX} min=${0} max=${1} step=${0.01} onChange=${(x) => setRender(Object.assign({}, render, { offsetX: x }))} fmt=${(x) => (x < 0.4 ? 'left' : x > 0.6 ? 'right' : 'centre')} />` : null}
          ${render.framing === 'split' ? html`<p class="muted small">Split stacks the left half (top) over the right half (bottom) — great for two-person interviews.</p>` : null}
          <${Toggle} checked=${cap.on} onChange=${(x) => setCap({ on: x })} label="Burn in captions from the transcript" />
          ${cap.on ? html`<div class="grid2">
            <${Field} label="Caption style"><${Select} value=${cap.preset} onChange=${(x) => setCap({ preset: x })} options=${[['karaoke', 'Word highlight'], ['bold', 'Bold outline'], ['box', 'Boxed'], ['pop', 'Pop-in']]} /></${Field}>
            <${Field} label="Position"><${Select} value=${cap.position} onChange=${(x) => setCap({ position: x })} options=${[['bottom', 'Lower third'], ['middle', 'Middle'], ['top', 'Top']]} /></${Field}>
            <${Field} label="Text colour"><input class="input color" type="color" value=${cap.color} onInput=${(e) => setCap({ color: e.target.value })} /></${Field}>
            ${cap.preset === 'karaoke' ? html`<${Field} label="Highlight colour"><input class="input color" type="color" value=${cap.highlight} onInput=${(e) => setCap({ highlight: e.target.value })} /></${Field}>` : null}
            <${Toggle} checked=${cap.uppercase} onChange=${(x) => setCap({ uppercase: x })} label="UPPERCASE captions" />
          </div>` : null}
          <${Button} kind="primary" icon="film" busy=${renderer.busy} onClick=${doRender}>Render clip</${Button}>
          <${Button} icon="pen" busy=${renderer.busy} onClick=${async () => { await call('vision.updateClip', { projectId: p.id, videoId: vid, clip: Object.assign({}, clip, edit) }); const o = await renderer.run('vision.clipCaption', { projectId: p.id, videoId: vid, clipId: clip.id }, 'Write a caption'); if (o) v.reload(); }}>Write a caption</${Button}>
          <${Progress} runner=${renderer} />
          ${clip && clip.captions && Object.keys(clip.captions).length ? html`<div class="clip-captions">${Object.entries(clip.captions).map(([k, c]) => html`<div class="panel caption-card"><div class="row between"><b>${k[0].toUpperCase() + k.slice(1)}</b><${Copyable} text=${`${c.text || ''}${c.hashtags && c.hashtags.length ? '\n\n' + c.hashtags.map((h) => (h.startsWith('#') ? h : '#' + h)).join(' ') : ''}`} /></div><p class="pre-wrap small">${c.text}</p>${c.hashtags && c.hashtags.length ? html`<p class="muted small">${c.hashtags.map((h) => (h.startsWith('#') ? h : '#' + h)).join(' ')}</p>` : null}</div>`)}</div>` : null}
          ${clip && clip.renders && clip.renders.length ? html`<div class="renders">${clip.renders.slice().reverse().map((rr) => html`<div class="render"><video src=${mediaUrl(rr.file)} controls preload="metadata" /><div class="row gap"><span class="muted small">${rr.aspect} — ${rr.framing}</span><${Button} size="sm" onClick=${() => showInFolder(rr.file)}>Show file</${Button}></div></div>`)}</div>` : null}
        </div>` : null}
      </div>
    </div>` : html`<${Spinner} />`}
  </div>`;
}

// ------------------------------------------------------------------ Documents
export function Documents({ videoIds: initial }) {
  return html`<${ToolPage} title="Documents" sub="Turn videos into designed guides, workbooks, notes and teardowns — illustrated with real screen captures." help="vision.documents">${(p, reload) => html`<${DocsBody} p=${p} reload=${reload} initial=${initial} />`}</${ToolPage}>`;
}

const DOC_DESIGNS = [['modern', 'Modern', 'Gradient cover, clean sans-serif'], ['classic', 'Classic', 'Editorial serif, white cover'], ['bold', 'Bold', 'Solid colour blocks, heavy headings']];
const DIAGRAMS = [['auto', 'Best fit'], ['flowchart', 'Flowchart'], ['mindmap', 'Mind map'], ['sequence', 'Sequence'], ['timeline', 'Timeline'], ['pie', 'Pie chart'], ['quadrant', 'Quadrant']];

function DesignPicker({ value, onChange }) {
  return html`<div class="design-picker" role="radiogroup" aria-label="Design">${DOC_DESIGNS.map(([k, n, sub]) => html`<button type="button" role="radio" aria-checked=${value === k} class=${'design-tile d-' + k + (value === k ? ' on' : '')} onClick=${() => onChange(k)}><span class="design-swatch"><i /><b /><b /></span><span><b>${n}</b><small>${sub}</small></span></button>`)}</div>`;
}

function DocsBody({ p, reload, initial }) {
  const [type, setType] = useState('guide');
  const [vids, setVids] = useState(initial || []);
  const [instr, setInstr] = useState('');
  const [imgs, setImgs] = useState(8);
  const [how, setHow] = useState(localStorage.getItem('ame.doc.how') || 'plan');
  const [design, setDesign] = useState(localStorage.getItem('ame.doc.design') || 'modern');
  const [nsec, setNsec] = useState(6);
  const [outline, setOutline] = useState(null);
  const [open, setOpen] = useState((p.docs || [])[0] ? p.docs[0].id : '');
  const r = useRunner(M);
  const gen = async () => {
    if (how === 'plan') { const o = await r.run('vision.docOutline', { projectId: p.id, videoIds: vids, type, instructions: instr, sections: nsec }, 'Plan outline'); if (o) setOutline(o); return; }
    const d = await r.run('vision.generateDoc', { projectId: p.id, videoIds: vids, type, instructions: instr, images: imgs }, 'Write document');
    if (d) { if (design !== 'modern') await call('vision.updateDoc', { projectId: p.id, doc: { id: d.id, design } }); await reload(); setOpen(d.id); }
  };
  const write = async () => { const d = await r.run('vision.docWrite', { projectId: p.id, outline, instructions: instr, images: imgs, design }, 'Write document', 'Document written'); if (d) { setOutline(null); await reload(); setOpen(d.id); } };
  const cur = (p.docs || []).find((d) => d.id === open);
  return html`<div class="tool-grid">
    <aside class="panel tool-form">
      <h3>New document</h3>
      <${Field} label="Type"><${Select} value=${type} onChange=${setType} options=${data.DOC_TYPES.map((d) => [d[0], d[1]])} /></${Field}>
      <p class="muted small">${(data.DOC_TYPES.find((d) => d[0] === type) || [])[2]}</p>
      <${Field} label="From"><${VideoPicker} project=${p} value=${vids} onChange=${setVids} multi /></${Field}>
      <${Field} label="Instructions (optional)"><textarea class="input" rows="3" value=${instr} onInput=${(e) => setInstr(e.target.value)} placeholder="Audience, tone, length, what to emphasise…" /></${Field}>
      <${Range} label="Screenshots" value=${imgs} min=${0} max=${20} step=${1} onChange=${setImgs} fmt=${(x) => (x ? `up to ${x}` : 'none')} />
      <${Field} label="Design"><${DesignPicker} value=${design} onChange=${(k) => { setDesign(k); localStorage.setItem('ame.doc.design', k); }} /></${Field}>
      <${Field} label="How"><${Segmented} value=${how} onChange=${(k) => { setHow(k); localStorage.setItem('ame.doc.how', k); }} options=${[['plan', 'Plan the outline first'], ['quick', 'Write in one go']]} /></${Field}>
      ${how === 'plan' ? html`<${Range} label="Sections" value=${nsec} min=${3} max=${14} step=${1} onChange=${setNsec} fmt=${(x) => `about ${x}`} />` : null}
      <${Button} kind="primary" icon="doc" busy=${r.busy} onClick=${gen}>${how === 'plan' ? 'Plan outline' : 'Create document'}</${Button}>
      <${Progress} runner=${r} />
      ${(p.docs || []).length ? html`<h3>Your documents</h3><div class="history">${p.docs.map((d) => html`<button class=${'hist ' + (d.id === open && !outline ? 'on' : '')} onClick=${() => { setOutline(null); setOpen(d.id); }}><b>${d.title}</b><span>${d.typeName} — ${ago(d.created)}</span></button>`)}</div>` : null}
    </aside>
    <section class="tool-out">${outline ? html`<${OutlineEditor} outline=${outline} onChange=${setOutline} onWrite=${write} onCancel=${() => setOutline(null)} busy=${r.busy} />` : cur ? html`<${DocEditor} key=${cur.id} p=${p} doc=${cur} reload=${reload} onDeleted=${() => setOpen('')} onNew=${(id) => setOpen(id)} />` : html`<${Empty} icon="doc" title="Create your first document">Pick a type, choose the videos and click Create. You can edit the text, then export to PDF, Word, web page, Markdown or plain text.</${Empty}>`}</section>
  </div>`;
}

function OutlineEditor({ outline, onChange, onWrite, onCancel, busy }) {
  const o = outline;
  const set = (k, v) => onChange(Object.assign({}, o, { [k]: v }));
  const setSec = (i, k, v) => set('sections', o.sections.map((s, j) => (j === i ? Object.assign({}, s, { [k]: v }) : s)));
  const move = (i, d) => { const a = o.sections.slice(); const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set('sections', a); };
  return html`<div class="outline-editor">
    <div class="row between wrap gap"><div class="grow"><input class="input title-input" aria-label="Title" value=${o.title} onInput=${(e) => set('title', e.target.value)} /><input class="input sub-input" aria-label="Subtitle" value=${o.subtitle} onInput=${(e) => set('subtitle', e.target.value)} /></div>
      <div class="row gap"><${Button} onClick=${onCancel}>Discard</${Button}><${Button} kind="primary" icon="sparkle" busy=${busy} disabled=${!o.sections.some((s) => s.heading.trim())} onClick=${onWrite}>Write document</${Button}></div></div>
    <p class="muted small">Edit, reorder, add or remove sections. Each section is then written on its own, so long documents stay detailed.</p>
    <${Field} label="Introduction"><textarea class="input" rows="2" value=${o.intro} onInput=${(e) => set('intro', e.target.value)} /></${Field}>
    <ol class="outline-list">${o.sections.map((s, i) => html`<li class="panel outline-item">
      <div class="row gap"><span class="outline-num">${i + 1}</span><input class="input grow" aria-label=${'Section ' + (i + 1) + ' heading'} value=${s.heading} onInput=${(e) => setSec(i, 'heading', e.target.value)} />
        <${IconButton} icon="chevron" cls="rot-90" title="Move up" disabled=${i === 0} onClick=${() => move(i, -1)} />
        <${IconButton} icon="chevron" cls="rot90" title="Move down" disabled=${i === o.sections.length - 1} onClick=${() => move(i, 1)} />
        <${IconButton} icon="trash" title="Remove section" onClick=${() => set('sections', o.sections.filter((_, j) => j !== i))} /></div>
      <textarea class="input small" rows=${Math.max(2, Math.min(6, s.points.length))} aria-label=${'What section ' + (i + 1) + ' covers'} placeholder="What this section covers — one point per line" value=${s.points.join('\n')} onInput=${(e) => setSec(i, 'points', e.target.value.split('\n'))} />
    </li>`)}</ol>
    <${Button} icon="plus" onClick=${() => set('sections', o.sections.concat([{ heading: 'New section', points: [] }]))}>Add section</${Button}>
  </div>`;
}

function SectionTools({ p, d, onDoc, r }) {
  const [secs, setSecs] = useState(null);
  const [instr, setInstr] = useState({});
  const [kind, setKind] = useState('auto');
  const [newHead, setNewHead] = useState('');
  const load = async () => { try { setSecs(await call('vision.docSections', { projectId: p.id, id: d.id })); } catch (e) { toast(e.message, 'error'); } };
  useEffect(() => { load(); }, [d.id, d.markdown]);
  const done = (res) => { if (res) onDoc(res.doc || res); };
  const rewrite = async (i, mode) => done(await r.run('vision.docSection', { projectId: p.id, id: d.id, index: i, mode, instructions: instr[i] || '' }, { rewrite: 'Rewrite section', expand: 'Expand section', shorten: 'Shorten section', simplify: 'Simplify section' }[mode], 'Section updated'));
  const brand = useStore((s) => s.auth && s.auth.brand);
  const diagram = async (i) => done(await r.run('vision.docDiagram', { projectId: p.id, id: d.id, index: i, kind, prompt: instr[i] || '', brand }, 'Draw diagram', 'Diagram added'));
  const info = async (i) => done(await r.run('vision.docInfographic', { projectId: p.id, id: d.id, index: i, prompt: instr[i] || '' }, 'Make infographic', 'Infographic added'));
  const edit = async (i, action, to) => { try { onDoc(await call('vision.docSectionEdit', { projectId: p.id, id: d.id, index: i, action, to })); } catch (e) { toast(e.message, 'error'); } };
  const add = async () => { if (!newHead.trim()) return; done(await r.run('vision.docSection', { projectId: p.id, id: d.id, index: -1, heading: newHead.trim() }, 'Write new section', 'Section added')); setNewHead(''); };
  if (!secs) return html`<${Spinner} />`;
  return html`<div class="section-tools">
    <div class="row gap wrap"><span class="muted small">Diagram type</span><${Select} value=${kind} onChange=${setKind} options=${DIAGRAMS} /><${Button} size="sm" icon="image" busy=${r.busy} onClick=${() => info(-1)}>Infographic for the whole document</${Button}></div>
    ${secs.map((s, i) => html`<div class="panel section-card">
      <div class="row between gap"><b class="grow">${s.heading || 'Introduction'}</b>
        ${s.heading ? html`<${IconButton} icon="chevron" cls="rot-90" title="Move up" disabled=${i <= 1} onClick=${() => edit(i, 'move', i - 1)} /><${IconButton} icon="chevron" cls="rot90" title="Move down" disabled=${i === secs.length - 1} onClick=${() => edit(i, 'move', i + 1)} /><${IconButton} icon="trash" title="Delete section" onClick=${() => edit(i, 'delete')} />` : null}</div>
      <p class="muted small section-excerpt">${s.markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]').replace(/[#>*_`]/g, '').slice(0, 260)}${s.markdown.length > 260 ? '…' : ''}</p>
      <input class="input small" placeholder="Optional instructions for this section (e.g. add a checklist, focus on pricing)" value=${instr[i] || ''} onInput=${(e) => setInstr(Object.assign({}, instr, { [i]: e.target.value }))} />
      <div class="row gap wrap">
        <${Button} size="sm" icon="refresh" busy=${r.busy} onClick=${() => rewrite(i, 'rewrite')}>Rewrite</${Button}>
        <${Button} size="sm" busy=${r.busy} onClick=${() => rewrite(i, 'expand')}>Expand</${Button}>
        <${Button} size="sm" busy=${r.busy} onClick=${() => rewrite(i, 'shorten')}>Shorten</${Button}>
        <${Button} size="sm" busy=${r.busy} onClick=${() => rewrite(i, 'simplify')}>Simplify</${Button}>
        ${s.heading ? html`<${Button} size="sm" icon="layers" busy=${r.busy} onClick=${() => diagram(i)}>Add diagram</${Button}><${Button} size="sm" icon="image" busy=${r.busy} onClick=${() => info(i)}>Add infographic</${Button}>` : null}
      </div>
    </div>`)}
    <div class="row gap"><input class="input grow" placeholder="New section heading" value=${newHead} onInput=${(e) => setNewHead(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); }} /><${Button} icon="plus" busy=${r.busy} disabled=${!newHead.trim()} onClick=${add}>Write new section</${Button}></div>
  </div>`;
}

function DocEditor({ p, doc, reload, onDeleted, onNew }) {
  const auth = useStore((s) => s.auth);
  const [d, setD] = useState(doc);
  const [mode, setMode] = useState('preview');
  const [htmlStr, setHtml] = useState('');
  const [lang, setLang] = useState('');
  const r = useRunner(M);
  const brand = auth.brand;
  const refresh = async () => { try { setHtml(await call('vision.previewDoc', { projectId: p.id, id: d.id, brand })); } catch (e) { toast(e.message, 'error'); } };
  useEffect(() => { refresh(); }, [d.id]);
  const saveDoc = async () => { await call('vision.updateDoc', { projectId: p.id, doc: { id: d.id, title: d.title, subtitle: d.subtitle, markdown: d.markdown } }); toast('Saved', 'ok', 1200); refresh(); reload(); };
  const exp = async (format) => { const out = await r.run('vision.exportDoc', { projectId: p.id, id: d.id, format, brand }, `Export ${format.toUpperCase()}`, `${format.toUpperCase()} exported`); if (out) showInFolder(out.file); };
  const onDoc = (nd) => { setD(nd); reload(); };
  const setDesign = async (k) => { const nd = await call('vision.updateDoc', { projectId: p.id, doc: { id: d.id, design: k } }); setD(Object.assign({}, d, { design: k, updated: nd && nd.updated })); reload(); };
  useEffect(() => { if (d.updated) refresh(); }, [d.design, d.updated]);
  return html`<div class="doc-editor">
    <div class="row between wrap gap"><div class="grow"><input class="input title-input" value=${d.title} onInput=${(e) => setD(Object.assign({}, d, { title: e.target.value }))} /><input class="input sub-input" value=${d.subtitle} onInput=${(e) => setD(Object.assign({}, d, { subtitle: e.target.value }))} /></div>
      <${Segmented} value=${mode} onChange=${(m) => { if (mode === 'edit') saveDoc(); setMode(m); }} options=${[['preview', 'Preview'], ['sections', 'Sections & visuals'], ['edit', 'Edit text']]} /></div>
    <div class="row gap wrap"><span class="muted small">Design</span><${Segmented} value=${d.design || 'modern'} onChange=${setDesign} options=${DOC_DESIGNS.map((x) => [x[0], x[1]])} /></div>
    <div class="row gap wrap export-row">
      ${['pdf', 'docx', 'html', 'md', 'txt'].map((f) => html`<${Button} size="sm" icon="export" busy=${r.busy} onClick=${() => exp(f)}>${{ pdf: 'PDF', docx: 'Word', html: 'Web page', md: 'Markdown', txt: 'Text' }[f]}</${Button}>`)}
      <${LangSelect} value=${lang} onChange=${setLang} list=${NLLB} placeholder="Translate to…" />
      <${Button} size="sm" disabled=${!lang} busy=${r.busy} onClick=${async () => { const nd = await r.run('vision.translateDoc', { projectId: p.id, id: d.id, lang }, 'Translate document'); if (nd) { await reload(); onNew(nd.id); } }}>Translate</${Button}>
      <${IconButton} icon="trash" title="Delete document" onClick=${async () => { await call('vision.deleteDoc', { projectId: p.id, id: d.id }); await reload(); onDeleted(); }} />
    </div>
    <${Progress} runner=${r} />
    ${mode === 'sections' ? html`<${SectionTools} p=${p} d=${d} r=${r} onDoc=${onDoc} />`
      : mode === 'edit' ? html`<div><textarea class="input md-edit" value=${d.markdown} onInput=${(e) => setD(Object.assign({}, d, { markdown: e.target.value }))} /><div class="row gap"><${Button} kind="primary" onClick=${saveDoc}>Save changes</${Button}><span class="muted small">Images: ![caption](frame:SECONDS). Diagrams appear as ![caption](asset:file). Use ## for sections, lists and > notes.</span></div></div>`
      : html`<iframe class="doc-preview" sandbox="allow-same-origin" srcdoc=${htmlStr} title="Document preview" />`}
  </div>`;
}

// ------------------------------------------------------------------ Posts
export function Posts() {
  return html`<${ToolPage} title="Posts" sub="Blog posts and social posts for six platforms, with each platform's limits built in. Publish to WordPress in one click." help="vision.posts">${(p, reload) => html`<${PostsBody} p=${p} reload=${reload} />`}</${ToolPage}>`;
}

function PostsBody({ p, reload }) {
  const [plats, setPlats] = useState(data.SOCIAL.map((s) => s[0]));
  const [vids, setVids] = useState([]);
  const [tone, setTone] = useState('');
  const [instr, setInstr] = useState('');
  const [words, setWords] = useState(1200);
  const [open, setOpen] = useState((p.posts || [])[0] ? p.posts[0].id : '');
  const r = useRunner(M);
  const gen = async () => { const e = await r.run('vision.generatePosts', { projectId: p.id, videoIds: vids, platforms: plats, tone, instructions: instr, wordCount: words }, 'Write posts'); if (e) { await reload(); setOpen(e.id); } };
  const cur = (p.posts || []).find((x) => x.id === open);
  return html`<div class="tool-grid">
    <aside class="panel tool-form">
      <h3>Write posts</h3>
      <div class="field"><span class="field-label">Platforms</span><div class="chips">${data.SOCIAL.map((s) => html`<button class=${'chip ' + (plats.includes(s[0]) ? 'on' : '')} onClick=${() => setPlats(plats.includes(s[0]) ? plats.filter((x) => x !== s[0]) : plats.concat([s[0]]))}>${s[1]}</button>`)}</div></div>
      <${Field} label="From"><${VideoPicker} project=${p} value=${vids} onChange=${setVids} multi /></${Field}>
      <${Field} label="Tone"><input class="input" value=${tone} onInput=${(e) => setTone(e.target.value)} placeholder="e.g. friendly expert, bold, playful" /></${Field}>
      ${plats.includes('wordpress') ? html`<${Range} label="Blog length" value=${words} min=${500} max=${3000} step=${100} onChange=${setWords} fmt=${(x) => x + ' words'} />` : null}
      <${Field} label="Instructions (optional)"><textarea class="input" rows="3" value=${instr} onInput=${(e) => setInstr(e.target.value)} placeholder="Call to action, keywords, link to include…" /></${Field}>
      <${Button} kind="primary" icon="share" busy=${r.busy} disabled=${!plats.length} onClick=${gen}>Write posts</${Button}>
      <${Progress} runner=${r} />
      ${(p.posts || []).length ? html`<h3>History</h3><div class="history">${p.posts.map((x) => html`<button class=${'hist ' + (x.id === open ? 'on' : '')} onClick=${() => setOpen(x.id)}><b>${x.platforms.length} platforms</b><span>${ago(x.created)}</span></button>`)}</div>` : null}
    </aside>
    <section class="tool-out">${cur ? html`<${PostsView} key=${cur.id} p=${p} entry=${cur} />` : html`<${Empty} icon="share" title="Write your first set of posts" />`}</section>
  </div>`;
}

function PostsView({ p, entry }) {
  const [posts, setPosts] = useState(entry.posts || {});
  const [pub, setPub] = useState(false);
  const save = (next) => { setPosts(next); call('vision.updatePosts', { projectId: p.id, entry: { id: entry.id, posts: next } }); };
  const upd = (k, patch) => save(Object.assign({}, posts, { [k]: Object.assign({}, posts[k], patch) }));
  return html`<div class="posts">
    ${entry.platforms.map((k) => {
      const s = data.SOCIAL.find((x) => x[0] === k);
      const post = posts[k] || {};
      if (k === 'wordpress') return html`<article class="post-card wp"><header><b>${s[1]}</b><div class="row gap"><${Copyable} text=${`# ${post.title || ''}\n\n${post.markdown || ''}`} /><${Button} size="sm" kind="primary" icon="wp" onClick=${() => setPub(true)}>Publish to WordPress</${Button}></div></header>
        <input class="input title-input" value=${post.title || ''} onInput=${(e) => upd(k, { title: e.target.value })} />
        <div class="grid2"><${Field} label="Slug"><input class="input" value=${post.slug || ''} onInput=${(e) => upd(k, { slug: e.target.value })} /></${Field}><${Field} label=${`Meta description (${(post.excerpt || '').length}/155)`}><input class="input" value=${post.excerpt || ''} onInput=${(e) => upd(k, { excerpt: e.target.value })} /></${Field}></div>
        <${Field} label="Tags"><input class="input" value=${(post.tags || []).join(', ')} onInput=${(e) => upd(k, { tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></${Field}>
        <textarea class="input md-edit short" value=${post.markdown || ''} onInput=${(e) => upd(k, { markdown: e.target.value })} />
        ${pub ? html`<${Publish} p=${p} post=${post} onClose=${() => setPub(false)} />` : null}</article>`;
      const text = post.text || '';
      const over = s[2] && text.length > s[2];
      return html`<article class="post-card"><header><b>${s[1]}</b><span class=${'count ' + (over ? 'over' : '')}>${text.length}${s[2] ? ' / ' + s[2] : ''}</span><${Copyable} text=${k === 'pinterest' ? `${post.title || ''}\n\n${text}` : text} /></header>
        ${k === 'pinterest' ? html`<input class="input" value=${post.title || ''} onInput=${(e) => upd(k, { title: e.target.value })} placeholder="Pin title" />` : null}
        <textarea class="input" rows=${k === 'x' ? 3 : 7} value=${text} onInput=${(e) => upd(k, { text: e.target.value })} />
        ${k === 'x' && post.thread && post.thread.length ? html`<details><summary>Thread (${post.thread.length} posts)</summary>${post.thread.map((t, i) => html`<div class="thread-item"><span class=${'count ' + (t.length > 280 ? 'over' : '')}>${i + 1}. ${t.length}/280</span><p>${t}</p></div>`)}<${Copyable} text=${post.thread.join('\n\n')} label="Copy thread" /></details>` : null}
      </article>`;
    })}
  </div>`;
}

function Publish({ p, post, onClose }) {
  const sites = useAsync(() => call('wp.sites'), []);
  const [site, setSite] = useState('');
  const [status, setStatus] = useState('draft');
  const [date, setDate] = useState('');
  const [cats, setCats] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [feat, setFeat] = useState('');
  const frames = useAsync(() => call('vision.assets', { projectId: p.id }), []);
  const r = useRunner(M);
  useEffect(() => { if (sites.data && sites.data[0] && !site) setSite(sites.data[0].id); }, [sites.data]);
  useEffect(() => { if (site) call('wp.categories', { id: site }).then(setCats).catch(() => setCats([])); }, [site]);
  const go2 = async () => {
    const out = await r.run('vision.publishWordPress', { projectId: p.id, siteId: site, title: post.title, markdown: post.markdown, status, date: status === 'future' ? new Date(date).toISOString().slice(0, 19) : '', categories: chosen, tags: post.tags || [], excerpt: post.excerpt, slug: post.slug, featuredT: feat === '' ? null : Number(feat) }, 'Publish to WordPress');
    if (out) { toast(status === 'publish' ? 'Published' : status === 'future' ? 'Scheduled' : 'Saved as draft', 'ok'); if (out.link) openUrl(out.link); onClose(); }
  };
  return html`<${Modal} title="Publish to WordPress" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${r.busy} disabled=${!site || (status === 'future' && !date)} onClick=${go2}>${status === 'publish' ? 'Publish now' : status === 'future' ? 'Schedule' : 'Save draft'}</${Button}>`}>
    ${sites.data && !sites.data.length ? html`<p>No sites yet. <button class="link-btn" onClick=${() => go('settings', { tab: 'wordpress' })}>Add a WordPress site</button></p>` : html`
      <${Field} label="Site"><${Select} value=${site} onChange=${setSite} options=${(sites.data || []).map((s) => [s.id, s.name])} /></${Field}>
      <${Field} label="When"><${Segmented} value=${status} onChange=${setStatus} options=${[['draft', 'Draft'], ['publish', 'Now'], ['future', 'Schedule']]} /></${Field}>
      ${status === 'future' ? html`<${Field} label="Date and time"><input class="input" type="datetime-local" value=${date} onInput=${(e) => setDate(e.target.value)} /></${Field}>` : null}
      ${cats.length ? html`<${Field} label="Categories"><div class="chips">${cats.map((c) => html`<button class=${'chip ' + (chosen.includes(c.id) ? 'on' : '')} onClick=${() => setChosen(chosen.includes(c.id) ? chosen.filter((x) => x !== c.id) : chosen.concat([c.id]))}>${c.name}</button>`)}</div></${Field}>` : null}
      <${Field} label="Featured image"><div class="frame-pick">${(frames.data || []).slice(0, 40).map((f) => html`<button class=${'frame ' + (String(f.t) === feat ? 'on' : '')} onClick=${() => setFeat(String(f.t) === feat ? '' : String(f.t))}><img src=${mediaUrl(f.path)} alt="" /></button>`)}</div></${Field}>
      <${Progress} runner=${r} />`}
  </${Modal}>`;
}

// ------------------------------------------------------------------ Images
export function Images() {
  return html`<${ToolPage} title="Images" sub="Infographics and social images from your videos — 30 layouts, 11 post and ad formats." help="vision.images">${(p, reload) => html`<${ImagesBody} p=${p} reload=${reload} />`}</${ToolPage}>`;
}

function ImagesBody({ p, reload }) {
  const adv = useStore((s) => Boolean(s.info && s.info.advanced));
  const [layout, setLayout] = useState(data.IMAGE_LAYOUTS[0]);
  const [type, setType] = useState('ig_post');
  const [style, setStyle] = useState('');
  const [instr, setInstr] = useState('');
  const [vids, setVids] = useState([]);
  const [design, setDesign] = useState(null);
  const [provider, setProvider] = useState('');
  const planner = useRunner(M);
  const gen = useRunner(M);
  useEffect(() => { call('settings.get').then((s) => setProvider(s.settings.images.provider)); }, []);
  const plan = async () => { const d = await planner.run('vision.imagePrompt', { projectId: p.id, videoIds: vids, layout, type, style, instructions: instr }, 'Design image'); if (d) setDesign(d); };
  const make = async () => { const out = await gen.run('vision.generateImage', { projectId: p.id, prompt: design.prompt, provider: adv ? provider : 'builtin', size: design.size, meta: { layout, type: design.typeName } }, 'Generate image', 'Image ready'); if (out) reload(); };
  return html`<div class="tool-grid">
    <aside class="panel tool-form">
      <h3>Design</h3>
      <${Field} label="Format"><${Select} value=${type} onChange=${setType} options=${data.IMAGE_TYPES.map((t) => [t[0], `${t[1]} (${t[2]})`])} /></${Field}>
      <${Field} label="Layout"><${Select} value=${layout} onChange=${setLayout} options=${data.IMAGE_LAYOUTS.map((l) => [l, l])} /></${Field}>
      <${Field} label="Visual style (optional)"><input class="input" value=${style} onInput=${(e) => setStyle(e.target.value)} placeholder="e.g. bold neon, hand-drawn, corporate blue" /></${Field}>
      <${Field} label="From"><${VideoPicker} project=${p} value=${vids} onChange=${setVids} multi /></${Field}>
      <${Field} label="Instructions (optional)"><textarea class="input" rows="2" value=${instr} onInput=${(e) => setInstr(e.target.value)} /></${Field}>
      <${Button} kind="primary" icon="wand" busy=${planner.busy} onClick=${plan}>Design the image</${Button}>
      <${Progress} runner=${planner} />
    </aside>
    <section class="tool-out">
      ${design ? html`<div class="panel">
        <h3>${design.headline || 'Image prompt'}</h3>
        ${design.points && design.points.length ? html`<ul>${design.points.map((x) => html`<li>${x}</li>`)}</ul>` : null}
        <${Field} label="Prompt (edit freely)"><textarea class="input" rows="7" value=${design.prompt} onInput=${(e) => setDesign(Object.assign({}, design, { prompt: e.target.value }))} /></${Field}>
        <div class="row gap wrap">${adv ? html`<${Select} value=${provider} onChange=${setProvider} options=${[['builtin', 'Built-in AI'], ['openai', 'OpenAI'], ['gemini', 'Google Gemini'], ['openrouter', 'OpenRouter'], ['fal', 'fal.ai']]} />` : null}
          <${Button} kind="primary" icon="image" busy=${gen.busy} onClick=${make}>Generate</${Button}><${Copyable} text=${design.prompt} label="Copy prompt" /><span class="muted small">Or paste the prompt into any image tool.</span></div>
        <${Progress} runner=${gen} />
      </div>` : html`<${Empty} icon="image" title="Design an image">The engine picks the strongest idea from your videos, writes the on-image text and a precise prompt. Generate it here, or copy the prompt into any image tool.</${Empty}>`}
      ${(p.images || []).length ? html`<h3>Gallery</h3><div class="gallery">${p.images.map((im) => html`<figure><img src=${mediaUrl(im.file)} alt="" /><figcaption><span class="muted small">${im.type || ''} ${im.layout ? '— ' + im.layout : ''}</span><div class="row gap"><${Button} size="sm" onClick=${() => showInFolder(im.file)}>Show file</${Button}><${Copyable} text=${im.prompt} label="Prompt" /><${IconButton} icon="trash" title="Remove" onClick=${async () => { await call('vision.deleteImage', { projectId: p.id, id: im.id }); reload(); }} /></div></figcaption></figure>`)}</div>` : null}
    </section>
  </div>`;
}

// ------------------------------------------------------------------ Chat
export function Chat({ videoId }) {
  return html`<${ToolPage} title="Chat" sub="Ask anything about a video or the whole project. Answers cite timestamps you can click." help="vision.chat">${(p, reload) => html`<${ChatBody} p=${p} reload=${reload} initialVid=${videoId} />`}</${ToolPage}>`;
}

function ChatBody({ p, reload, initialVid }) {
  const [vid, setVid] = useState(initialVid || '');
  const [chatId, setChatId] = useState('');
  const [msg, setMsg] = useState('');
  const [att, setAtt] = useState([]);
  const [stream, setStream] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState('');
  const [frames, setFrames] = useState([]);
  const listRef = useRef(null);
  const thread = (p.chats || []).find((c) => c.id === chatId);
  useEffect(() => {
    const ids = vid ? [vid] : p.videos.map((v) => v.id);
    Promise.all(ids.slice(0, 5).map((id) => call('vision.video', { projectId: p.id, videoId: id }).catch(() => null))).then((vs) => setFrames(vs.filter(Boolean).flatMap((v) => v.frames)));
  }, [vid]);
  const frameAt = frameFinder(frames);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [thread, stream, pending]);
  const send = async () => {
    if (!msg.trim() || busy) return;
    const text = msg;
    setMsg(''); setPending(text); setStream(''); setBusy(true);
    let jid = '';
    const off = on('chat-token', (d) => { if (d.jobId === jid) setStream(d.text); });
    try {
      const r = await job('vision.chat', { projectId: p.id, videoId: vid, chatId, message: text, attachments: att }, 'Chat', { module: M, onStart: (id) => { jid = id; } });
      setChatId(r.chatId); setAtt([]); await reload();
    } catch (e) { if (e.code !== 'cancelled') toast(e.message, 'error'); setMsg(text); } finally { off(); setBusy(false); setStream(''); setPending(''); }
  };
  const seek = (t) => { const target = vid || (p.videos[0] && p.videos[0].id); if (target) go('vision.video', { projectId: p.id, videoId: target, t }); };
  return html`<div class="chat">
    <aside class="chat-side panel">
      <${Button} icon="plus" onClick=${() => setChatId('')}>New chat</${Button}>
      <div class="history">${(p.chats || []).map((c) => html`<div class=${'hist ' + (c.id === chatId ? 'on' : '')}><button onClick=${() => { setChatId(c.id); setVid(c.videoId || ''); }}><b>${c.title}</b><span>${ago(c.updated || c.created)}</span></button><${IconButton} icon="trash" title="Delete chat" onClick=${async () => { await call('vision.deleteChat', { projectId: p.id, id: c.id }); if (chatId === c.id) setChatId(''); reload(); }} /></div>`)}</div>
    </aside>
    <section class="chat-main">
      <div class="row gap chat-scope"><span class="muted small">Ask about</span><${Select} value=${vid} onChange=${(x) => { setVid(x); setChatId(''); }} options=${[['', `Whole project (${p.videos.length} videos)`]].concat(p.videos.filter((v) => v.status === 'ready' || v.hasTranscript).map((v) => [v.id, v.title]))} /></div>
      <div class="chat-list" ref=${listRef}>
        ${!thread && !pending ? html`<div class="chat-hints">${['Summarize this in 5 bullet points', 'What is the main offer and how is it framed?', 'List every tool shown on screen', 'Write a hook for a short based on the best moment'].map((h) => html`<button class="chip" onClick=${() => setMsg(h)}>${h}</button>`)}</div>` : null}
        ${(thread ? thread.messages : []).map((m) => html`<div class=${'msg ' + m.role}>${m.role === 'assistant' ? html`<${Markdown} text=${m.content} onSeek=${seek} frameAt=${frameAt} />` : html`<p>${m.content}</p>`}</div>`)}
        ${pending ? html`<div class="msg user"><p>${pending}</p></div><div class="msg assistant">${stream ? html`<${Markdown} text=${stream} onSeek=${seek} frameAt=${frameAt} />` : html`<span class="typing"><i /><i /><i /></span>`}</div>` : null}
      </div>
      ${att.length ? html`<div class="chips">${att.map((a) => html`<button class="chip on" onClick=${() => setAtt(att.filter((x) => x !== a))}>${a.split(/[\\/]/).pop()} ✕</button>`)}</div>` : null}
      <div class="chat-input">
        <${IconButton} icon="upload" title="Attach frames or files" onClick=${async () => { const f = await pickFiles({ multi: true, filters: [{ name: 'Images & documents', extensions: ['jpg', 'jpeg', 'png', 'webp', 'txt', 'md', 'pdf', 'docx', 'srt', 'vtt'] }] }); setAtt(att.concat(f)); }} />
        <textarea class="input" rows="2" placeholder="Ask a question…" value=${msg} onInput=${(e) => setMsg(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <${Button} kind="primary" icon="chat" busy=${busy} disabled=${!msg.trim()} onClick=${send}>Send</${Button}>
      </div>
    </section>
  </div>`;
}

// ------------------------------------------------------------------ Export knowledge
export function ExportKnowledge() {
  return html`<${ToolPage} title="Export knowledge" sub="One Knowledge File of your project for ChatGPT, Claude, Gemini, NotebookLM, Ollama or LM Studio." help="vision.export">${(p) => html`<${ExportBody} p=${p} />`}</${ToolPage}>`;
}

function ExportBody({ p }) {
  const [level, setLevel] = useState('standard');
  const [format, setFormat] = useState('md');
  const [vids, setVids] = useState([]);
  const [out, setOut] = useState(null);
  const [opts, setOpts] = useState({ includeChats: false, overview: true, target: 'chatgpt' });
  const [tab, setTab] = useState('all');
  const fresh = useAsync(() => call('vision.knowledgeNew', { projectId: p.id }), [p.id, out && out.file]);
  const r = useRunner(M);
  const levels = { brief: 'Summary and key moments per video — small enough to paste straight into a chat.', standard: 'Summaries, takeaways, a visual timeline and a condensed transcript.', complete: 'Everything: every report, every frame description, findings and the full timestamped transcript.' };
  return html`<div class="tool-grid">
    <aside class="panel tool-form">
      <${Field} label="Detail"><${Segmented} value=${level} onChange=${setLevel} options=${[['brief', 'Brief'], ['standard', 'Standard'], ['complete', 'Complete']]} /></${Field}>
      <p class="muted small">${levels[level]}</p>
      <${Field} label="Format"><${Segmented} value=${format} onChange=${setFormat} options=${[['md', 'Markdown (.md)'], ['txt', 'Plain text (.txt)']]} /></${Field}>
      <${Field} label="For"><${Select} value=${opts.target} onChange=${(x) => setOpts(Object.assign({}, opts, { target: x }))} options=${[['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini'], ['notebooklm', 'NotebookLM'], ['agents', 'Codex · Claude Code'], ['local', 'Ollama · LM Studio']]} /></${Field}>
      <${Toggle} checked=${opts.overview} onChange=${(x) => setOpts(Object.assign({}, opts, { overview: x }))} label="Write a one-page overview first" />
      <${Toggle} checked=${opts.includeChats} onChange=${(x) => setOpts(Object.assign({}, opts, { includeChats: x }))} label="Include my chats" />
      <${Tabs} value=${tab} onChange=${setTab} tabs=${[['all', 'All videos'], ['created', 'Created', (fresh.data && fresh.data.videos.length) || 0]]} />
      ${tab === 'all' ? html`<${Field} label="Videos"><${VideoPicker} project=${p} value=${vids} onChange=${setVids} multi /></${Field}>` : html`<div class="list">${fresh.data && fresh.data.videos.length ? fresh.data.videos.map((v) => html`<div class="list-row"><span class="list-main"><b>${v.title}</b><span class="muted small">added ${ago(v.created)}</span></span></div>`) : html`<p class="muted small">${fresh.data && fresh.data.since ? 'No videos added since the last export.' : 'Every video is new — nothing exported yet.'}</p>`}</div>`}
      <${Button} kind="primary" icon="export" busy=${r.busy} disabled=${tab === 'created' && !(fresh.data && fresh.data.videos.length)} onClick=${async () => { const o = await r.run('vision.exportKnowledge', Object.assign({ projectId: p.id, level, format, videoIds: tab === 'all' ? vids : [], onlyNew: tab === 'created' }, opts), 'Export knowledge', 'Knowledge file ready'); if (o) setOut(o); }}>${tab === 'created' ? 'Export new videos' : 'Create Knowledge File'}</${Button}>
      <${Progress} runner=${r} />
    </aside>
    <section class="tool-out">${out ? html`<div class="panel">
      <div class="row between"><b>${out.file.split(/[\\/]/).pop()}</b><span class="muted small">${(out.chars / 1000).toFixed(0)}K characters</span></div>
      <div class="row gap">${level === 'brief' ? html`<${Copyable} text=${out.text} label="Copy to paste into a chat" />` : null}<${Button} size="sm" onClick=${() => openPath(out.file)}>Open</${Button}><${Button} size="sm" onClick=${() => showInFolder(out.file)}>Show file</${Button}></div>
      <pre class="pre-preview">${out.text}${out.text.length < out.chars ? '\n…' : ''}</pre></div>` : html`<${Empty} icon="export" title="Make your project portable">Upload the file to any AI assistant and ask questions about your videos there.</${Empty}>`}</section>
  </div>`;
}
