import { html, useState, useEffect, useRef, useMemo, useStore, setState, state, call, job, go, toast, useRunner, mediaUrl, clock, ago, count, copy, pickFiles, saveFile, openPath, showInFolder, on, MEDIA_FILTERS, SUB_FILTERS } from '../lib.js';
import { PageHeader, Button, IconButton, Icon, Field, Select, Toggle, Segmented, Tabs, Badge, Empty, Modal, Progress, Spinner, ErrorBox, Dropzone, useAsync, Confirm, LangSelect, LangMulti, Copyable, Markdown, Timecode } from '../ui.js';
import data from '../../shared/data.js';
import NLLB from '../../shared/nllb-languages.js';

const M = 'scribe';
const MEDIA_RE = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpg|mpeg|3gp|ts|mts|mp3|m4a|wav|flac|ogg|opus|aac|wma|aiff?|amr)$/i;
const FORMATS = [['txt', 'Text (.txt)'], ['txt-ts', 'Text with timestamps'], ['srt', 'Subtitles (.srt)'], ['vtt', 'Web subtitles (.vtt)'], ['csv', 'Spreadsheet (.csv)'], ['json', 'Data (.json)']];

function useWhisper() { return useAsync(() => Promise.all([call('whisper.models'), call('settings.get')]).then(([m, s]) => ({ models: m, t: s.settings.transcription })), []); }

function EngineOptions({ value, onChange, showTranslate = true }) {
  const w = useWhisper();
  const adv = useStore((s) => Boolean(s.info && s.info.advanced));
  useEffect(() => { if (w.data && !value.engine) onChange(Object.assign({}, value, { engine: w.data.t.engine, model: w.data.t.model, language: w.data.t.language })); }, [w.data]);
  if (!w.data) return html`<${Spinner} />`;
  const o = value;
  const up = (p) => onChange(Object.assign({}, o, p));
  return html`<div class="grid2">
    <${Field} label="Engine"><${Select} value=${o.engine} onChange=${(x) => up({ engine: x })} options=${[['cloud', 'Built-in AI — fastest'], ['local', 'Whisper on this PC (free, offline)']].concat(adv ? [['openai', 'OpenAI (your key)'], ['groq', 'Groq (your key)'], ['gladia', 'Gladia (your key)']] : [])} /></${Field}>
    ${o.engine === 'local' ? html`<${Field} label="Model"><${Select} value=${o.model} onChange=${(x) => up({ model: x })} options=${w.data.models.map((m) => [m.id, `${m.label}${m.installed ? '' : ` (${m.mb} MB download)`}`])} /></${Field}>` : html`<span />`}
    <${Field} label="Language"><${LangSelect} value=${o.language} onChange=${(x) => up({ language: x })} list=${data.WHISPER_LANGS} /></${Field}>
    ${showTranslate ? html`<${Toggle} checked=${Boolean(o.translate)} onChange=${(x) => up({ translate: x })} label="Translate speech to English" hint="Whisper's built-in translation." />` : null}
  </div>`;
}

// ------------------------------------------------------------------ Single
export function Single() {
  const [src, setSrc] = useState('file');
  const [file, setFile] = useState('');
  const [url, setUrl] = useState('');
  const [opts, setOpts] = useState({});
  const [prompt, setPrompt] = useState('');
  const r = useRunner(M);
  const hist = useAsync(() => call('scribe.open', { id: 'single' }), []);
  const go2 = async (input) => {
    const out = await r.run('scribe.transcribe', Object.assign({ projectId: 'single', options: Object.assign({}, opts, { initialPrompt: prompt }) }, input), 'Transcribe');
    if (out) go('scribe.editor', { projectId: out.projectId, rowId: out.row.id });
  };
  return html`<div class="page">
    <${PageHeader} title="Transcribe" sub="A file, a link or your voice — to text, captions or data. Fast with the built-in AI, or unlimited and offline with Whisper." module=${M} help="scribe.single" />
    <div class="tts-grid">
      <section class="panel">
        <${Segmented} value=${src} onChange=${setSrc} options=${[['file', 'Media file'], ['link', 'Video link'], ['record', 'Record']]} />
        ${src === 'file' ? html`<${Dropzone} label=${file ? file.split(/[\\/]/).pop() : 'Drop an audio or video file'} sub="26+ audio and 31+ video formats, any length" accept=${MEDIA_RE} onFiles=${(f) => setFile(f[0])} onPick=${async () => { const f = await pickFiles({ filters: MEDIA_FILTERS }); if (f[0]) setFile(f[0]); }} />
          <${Button} kind="primary" icon="pen" busy=${r.busy} disabled=${!file} onClick=${() => go2({ file })} cls="wide">Transcribe file</${Button}>` : null}
        ${src === 'link' ? html`<${Field} label="Link" hint="YouTube, TikTok, Vimeo, podcasts, X, Facebook and 1,800+ sites. Captions are used when available."><input class="input" value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://" /></${Field}>
          <${Button} kind="primary" icon="pen" busy=${r.busy} disabled=${!/^https?:\/\//.test(url)} onClick=${() => go2({ url: url.trim() })} cls="wide">Transcribe link</${Button}>` : null}
        ${src === 'record' ? html`<${MicRecorder} onFile=${(f) => go2({ file: f })} busy=${r.busy} />` : null}
        <${Progress} runner=${r} />
      </section>
      <section class="panel">
        <h3>Options</h3>
        <${EngineOptions} value=${opts} onChange=${setOpts} />
        <${Field} label="Vocabulary hint (optional)" hint="Names, brands or jargon to spell correctly."><input class="input" value=${prompt} onInput=${(e) => setPrompt(e.target.value)} placeholder="e.g. JVZoo, WarriorPlus, Kokoro" /></${Field}>
      </section>
    </div>
    <h3>Recent transcripts</h3>
    ${hist.data && hist.data.rows.length ? html`<div class="list">${hist.data.rows.slice(0, 30).map((row) => html`<div class="list-row">
      <${Icon} name=${row.source.type === 'url' ? 'link' : 'pen'} /><span class="list-main"><b>${row.name}</b><span class="muted small">${row.status === 'done' ? `${clock(row.duration)} — ${row.transcript ? row.transcript.words.toLocaleString() : 0} words — ${row.language || ''}` : row.status === 'error' ? row.error : row.status} — ${ago(row.created)}</span></span>
      ${row.transcript ? html`<${Button} size="sm" kind="primary" onClick=${() => go('scribe.editor', { projectId: hist.data.id, rowId: row.id })}>Open</${Button}>` : null}
      <${IconButton} icon="trash" title="Delete" onClick=${async () => hist.set(await call('scribe.deleteRows', { projectId: hist.data.id, rowIds: [row.id] }))} /></div>`)}</div>` : html`<p class="muted">Your transcripts will be listed here.</p>`}
  </div>`;
}

function MicRecorder({ onFile, busy }) {
  const [rec, setRec] = useState(null);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const chunks = useRef([]);
  const t = useRef(null);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop()); ctx.close();
        const ab = await new Blob(chunks.current, { type: 'audio/webm' }).arrayBuffer();
        const r = await call('recording.save', { buffer: ab, ext: 'webm' });
        onFile(r.file);
      };
      mr.start(500);
      setRec(mr); setSecs(0);
      t.current = setInterval(() => { setSecs((x) => x + 0.2); an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); setLevel(m / 128); }, 200);
    } catch (e) { toast('Microphone not available: ' + e.message, 'error'); }
  };
  const stop = () => { if (rec) rec.stop(); setRec(null); clearInterval(t.current); };
  useEffect(() => () => clearInterval(t.current), []);
  return html`<div class="recorder big">
    ${rec ? html`<button class="rec-btn on" onClick=${stop}><span class="rec-dot" />Stop and transcribe — ${clock(secs)}</button><div class="meter"><i style=${{ width: Math.min(100, level * 160) + '%' }} /></div>`
      : html`<button class="rec-btn" disabled=${busy} onClick=${start}><span class="rec-dot" />Start recording</button>`}
    <span class="muted small">Recordings are saved in your Recordings folder.</span>
  </div>`;
}

// ------------------------------------------------------------------ Editor
export function Editor({ projectId, rowId }) {
  const p = useAsync(() => call('scribe.open', { id: projectId }), [projectId, rowId]);
  const row0 = p.data && p.data.rows.find((r) => r.id === rowId);
  const [row, setRow] = useState(null);
  const [tab, setTab] = useState('segments');
  const [now, setNow] = useState(0);
  const [dirty, setDirty] = useState(false);
  const mref = useRef(null);
  useEffect(() => { if (row0) setRow(row0); }, [row0 && row0.id, p.data]);
  if (!row) return html`<div class="page">${p.error ? html`<${ErrorBox} error=${p.error} />` : html`<${Spinner} />`}</div>`;
  const segs = (row.transcript && row.transcript.segments) || [];
  const isVideo = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpg|mpeg|3gp|ts|mts)$/i.test(row.file || '');
  const seek = (t) => { if (mref.current) { mref.current.currentTime = t; mref.current.play().catch(() => {}); } };
  const setSeg = (i, text) => { const n = segs.slice(); n[i] = Object.assign({}, n[i], { text }); setRow(Object.assign({}, row, { transcript: Object.assign({}, row.transcript, { segments: n }) })); setDirty(true); };
  const save = async () => { const r = await call('scribe.updateRow', { projectId, row: { id: row.id, name: row.name, transcript: { segments: segs } } }); setRow(r); setDirty(false); toast('Saved', 'ok', 1200); };
  const active = segs.findIndex((s) => now >= s.start && now < s.end);
  return html`<div class="page">
    <div class="ws-head"><button class="link-btn" onClick=${() => go(projectId === p.data.id && p.data.kind === 'single' ? 'scribe.single' : 'scribe.bulk', { id: projectId })}>← Back</button>
      <input class="input title-input" value=${row.name} onInput=${(e) => { setRow(Object.assign({}, row, { name: e.target.value })); setDirty(true); }} />
      ${dirty ? html`<${Button} kind="primary" onClick=${save}>Save changes</${Button}>` : html`<span class="muted small">${row.transcript ? `${row.transcript.words.toLocaleString()} words — ${row.language || ''} — ${row.transcript.engine}${row.transcript.model ? ' ' + row.transcript.model : ''}` : ''}</span>`}</div>
    <div class="editor">
      <div class="editor-left">
        ${row.file ? html`<div class=${'player ' + (isVideo ? '' : 'audio-only')}>${isVideo ? html`<video ref=${mref} src=${mediaUrl(row.file)} controls onTimeUpdate=${(e) => setNow(e.target.currentTime)} />` : html`<audio ref=${mref} src=${mediaUrl(row.file)} controls onTimeUpdate=${(e) => setNow(e.target.currentTime)} />`}</div>` : html`<p class="muted small">Media not saved locally (captions were used). Turn on "Save media" in Bulk options to keep files.</p>`}
        <${Tabs} value=${tab} onChange=${setTab} tabs=${[['segments', 'Timed lines', segs.length], ['text', 'Full text'], ['translations', 'Translations', Object.keys(row.translations || {}).length]]} />
        ${tab === 'segments' ? html`<${FindReplace} segs=${segs} onApply=${(n) => { setRow(Object.assign({}, row, { transcript: Object.assign({}, row.transcript, { segments: n }) })); setDirty(true); }} />
          <div class="seg-edit">${segs.map((s, i) => html`<div class=${'tline ' + (i === active ? 'on' : '')}><${Timecode} t=${s.start} onSeek=${seek} /><textarea class="seg-text" rows=${Math.max(1, Math.ceil(s.text.length / 80))} value=${s.text} onInput=${(e) => setSeg(i, e.target.value)} /></div>`)}</div>` : null}
        ${tab === 'text' ? html`<div><div class="row gap"><${Copyable} text=${row.transcript ? row.transcript.text : ''} /></div><pre class="pre-preview tall">${row.transcript ? row.transcript.text : ''}</pre></div>` : null}
        ${tab === 'translations' ? html`<${Translations} projectId=${projectId} row=${row} onRow=${setRow} />` : null}
      </div>
      <div class="editor-right">
        <${ExportPanel} projectId=${projectId} row=${row} dirty=${dirty} save=${save} />
        <${AiPanel} projectId=${projectId} row=${row} onRow=${setRow} />
      </div>
    </div>
  </div>`;
}

function FindReplace({ segs, onApply }) {
  const [f, setF] = useState('');
  const [r, setR] = useState('');
  const hits = f ? segs.filter((s) => s.text.toLowerCase().includes(f.toLowerCase())).length : 0;
  return html`<div class="row gap find"><input class="input" placeholder="Find" value=${f} onInput=${(e) => setF(e.target.value)} /><input class="input" placeholder="Replace with" value=${r} onInput=${(e) => setR(e.target.value)} />
    <span class="muted small">${f ? count(hits, 'line') : ''}</span><${Button} size="sm" disabled=${!f || !hits} onClick=${() => { const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); onApply(segs.map((s) => Object.assign({}, s, { text: s.text.replace(re, r) }))); toast(`Replaced in ${count(hits, 'line')}`, 'ok'); }}>Replace all</${Button}></div>`;
}

function ExportPanel({ projectId, row, dirty, save }) {
  const [fmt, setFmt] = useState('srt');
  const [lang, setLang] = useState('');
  const prev = useAsync(() => call('scribe.preview', { projectId, rowId: row.id, format: fmt, lang }), [fmt, lang, row.id, row.transcript && row.transcript.text]);
  const ext = fmt === 'txt-ts' ? 'txt' : fmt;
  const saveAs = async () => {
    if (dirty) await save();
    const f = await saveFile({ defaultPath: `${row.name.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}${lang ? '.' + lang : ''}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!f) return;
    const text = (await call('scribe.preview', { projectId, rowId: row.id, format: fmt, lang })).text;
    const out = await call('scribe.export', { projectId, rowIds: [row.id], formats: [fmt], dir: f.replace(/[\\/][^\\/]+$/, ''), includeTranslations: false, includeAi: false });
    toast('Saved', 'ok');
    showInFolder(out.files[0] || f);
    return text;
  };
  return html`<section class="panel">
    <h3>Export</h3>
    <div class="row gap"><${Select} value=${fmt} onChange=${setFmt} options=${FORMATS} />${Object.keys(row.translations || {}).length ? html`<${Select} value=${lang} onChange=${setLang} options=${[['', 'Original']].concat(Object.keys(row.translations).map((k) => [k, k]))} />` : null}</div>
    <pre class="pre-preview">${prev.data ? prev.data.text.slice(0, 3000) : ''}</pre>
    <div class="row gap"><${Button} kind="primary" icon="download" onClick=${saveAs}>Save to Exports</${Button}><${Copyable} text=${prev.data ? prev.data.text : ''} /></div>
  </section>`;
}

function PromptSelect({ value, onChange }) {
  const pr = useAsync(() => call('scribe.prompts'), []);
  if (!pr.data) return html`<${Spinner} />`;
  return html`<select class="input" value=${value} onChange=${(e) => onChange(e.target.value, pr.data.prompts.find((p) => p.id === e.target.value))}>
    <option value="">Choose a prompt…</option>
    ${pr.data.categories.map((c, ci) => html`<optgroup label=${c}>${pr.data.prompts.filter((p) => p.cat === ci).map((p) => html`<option value=${p.id}>${p.title}</option>`)}</optgroup>`)}
  </select>`;
}

function AiPanel({ projectId, row, onRow }) {
  const [pid, setPid] = useState('');
  const [text, setText] = useState('');
  const [target, setTarget] = useState('text');
  const r = useRunner(M);
  const runIt = async () => {
    const out = await r.run('scribe.runPrompt', { projectId, rowIds: [row.id], promptText: text, target, scope: 'each' }, 'AI prompt');
    if (out && out.project) onRow(out.project.rows.find((x) => x.id === row.id));
  };
  return html`<section class="panel">
    <h3>Ask AI</h3>
    <${PromptSelect} value=${pid} onChange=${(id, p) => { setPid(id); if (p) setText(p.prompt); }} />
    <textarea class="input" rows="3" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Or write your own instruction…" />
    <div class="row gap"><${Select} value=${target} onChange=${setTarget} options=${[['text', 'Run on: text with timestamps'], ['srt', 'Run on: SRT'], ['vtt', 'Run on: VTT'], ['csv', 'Run on: CSV'], ['json', 'Run on: JSON']]} />
      <${Button} kind="primary" icon="sparkle" busy=${r.busy} disabled=${!text.trim()} onClick=${runIt}>Run</${Button}></div>
    <${Progress} runner=${r} />
    ${row.ai && (row.ai.output || row.ai.error) ? html`<div class="ai-out">${row.ai.error ? html`<div class="error-box">${row.ai.error}</div>` : html`<div class="row between"><span class="muted small">${row.ai.prompt.slice(0, 60)}</span><${Copyable} text=${row.ai.output} /></div><${Markdown} text=${row.ai.output} />`}</div>` : null}
  </section>`;
}

function Translations({ projectId, row, onRow }) {
  const [langs, setLangs] = useState([]);
  const [engine, setEngine] = useState('ai');
  const r = useRunner(M);
  useEffect(() => { call('settings.get').then((s) => setEngine(s.settings.translation.engine)); }, []);
  const tr = row.translations || {};
  return html`<div>
    <div class="grid2"><${Field} label="Translate to"><${LangMulti} value=${langs} onChange=${setLangs} list=${NLLB} /></${Field}>
    <div><${Field} label="Engine"><${Select} value=${engine} onChange=${setEngine} options=${[['ai', 'AI model'], ['local', 'NLLB-200 offline (free)']]} /></${Field}>
    <${Button} kind="primary" icon="globe" busy=${r.busy} disabled=${!langs.length} onClick=${async () => { const o = await r.run('scribe.translateRows', { projectId, rowIds: [row.id], targets: langs, engine }, 'Translate transcript', 'Translated — timestamps kept'); if (o) onRow(o.project.rows.find((x) => x.id === row.id)); }}>Translate</${Button}>
    <${Progress} runner=${r} /></div></div>
    ${Object.entries(tr).map(([k, t]) => html`<details class="tr-block"><summary><b>${(NLLB.find((l) => l[0] === t.lang) || [0, k])[1]}</b> <span class="muted small">${t.segments.length} lines — ${ago(t.at)}</span></summary><pre class="pre-preview">${t.segments.map((s) => `[${clock(s.start)}] ${s.text}`).join('\n')}</pre></details>`)}
  </div>`;
}

// ------------------------------------------------------------------ Bulk
function setScribe(id) { localStorage.setItem('ame.scribeProject', id || ''); setState({ scribeProject: id || '' }); }

export function Bulk({ id: openId }) {
  const projects = useAsync(() => call('scribe.projects').then((l) => l.filter((x) => x.kind !== 'single')), []);
  const cur = useStore((s) => s.scribeProject);
  useEffect(() => { if (openId) setScribe(openId); }, [openId]);
  useEffect(() => { const l = projects.data || []; if (l.length && !l.find((x) => x.id === cur)) setScribe(l[0].id); }, [projects.data]);
  const [creating, setCreating] = useState(false);
  const list = projects.data || [];
  return html`<div class="page">
    <${PageHeader} title="Bulk transcribe" sub="Unlimited files or links — downloaded, transcribed, analyzed and translated in one batch." module=${M} help="scribe.bulk">
      <div class="project-bar">${list.length ? html`<${Select} value=${cur} onChange=${setScribe} options=${list.map((p) => [p.id, `${p.name} (${p.done}/${p.rows})`])} />` : null}
        <${Button} size="sm" icon="plus" onClick=${() => setCreating(true)}>New batch</${Button}>
        <${Button} size="sm" icon="upload" onClick=${async () => { const f = await pickFiles({ filters: [{ name: 'Scribe project', extensions: ['amescribe', 'json'] }] }); if (f[0]) { try { const p = await call('scribe.importProject', { file: f[0] }); setScribe(p.id); projects.reload(); } catch (e) { toast(e.message, 'error'); } } }}>Open project file</${Button}></div>
    </${PageHeader}>
    ${!list.length && !projects.loading ? html`<${Empty} icon="layers" title="Start a batch" action=${html`<${Button} kind="primary" onClick=${() => setCreating(true)}>New batch</${Button}>`}>A batch is a project you can save, reopen and share with your team.</${Empty}>` : null}
    ${cur && list.find((x) => x.id === cur) ? html`<${Grid} key=${cur} id=${cur} onChanged=${projects.reload} onDeleted=${() => { setScribe(''); projects.reload(); }} />` : null}
    ${creating ? html`<${NewBatch} onClose=${() => setCreating(false)} onDone=${(p) => { setCreating(false); setScribe(p.id); projects.reload(); }} />` : null}
  </div>`;
}

function NewBatch({ onClose, onDone }) {
  const [name, setName] = useState('');
  return html`<${Modal} title="New batch" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" onClick=${async () => onDone(await call('scribe.create', { name: name || 'Untitled batch' }))}>Create</${Button}>`}><${Field} label="Name"><input class="input" autofocus value=${name} onInput=${(e) => setName(e.target.value)} /></${Field}></${Modal}>`;
}

const STATUS = { queued: ['Waiting', ''], working: ['Starting', 'info'], downloading: ['Downloading', 'info'], transcribing: ['Transcribing', 'info'], ai: ['AI prompt', 'info'], translating: ['Translating', 'info'], done: ['Done', 'ok'], error: ['Failed', 'warn'] };

function Grid({ id, onChanged, onDeleted }) {
  const pj = useAsync(() => call('scribe.open', { id }), [id]);
  const [p, setP] = useState(null);
  const [sel, setSel] = useState([]);
  const [sort, setSort] = useState({ k: 'n', d: 1 });
  const [filter, setFilter] = useState('');
  const [urls, setUrls] = useState('');
  const [expand, setExpand] = useState(true);
  const [opts, setOpts] = useState({});
  const [extra, setExtra] = useState({ useCaptions: true, saveMedia: false, saveVideo: false, promptText: '', translateTo: [], translateEngine: 'ai' });
  const [dlg, setDlg] = useState('');
  const [del, setDel] = useState(false);
  const r = useRunner(M);
  const adder = useRunner(M);
  useEffect(() => { if (pj.data) setP(pj.data); }, [pj.data]);
  useEffect(() => on('scribe-row', (d) => { if (d.projectId === id) setP((cur) => (cur ? Object.assign({}, cur, { rows: cur.rows.map((x) => (x.id === d.row.id ? d.row : x)) }) : cur)); }), [id]);
  if (!p) return pj.error ? html`<${ErrorBox} error=${pj.error} />` : html`<${Spinner} />`;
  const rows = p.rows.map((x, i) => Object.assign({ n: i + 1 }, x));
  let shown = rows.filter((x) => !filter || (x.name + ' ' + (x.transcript ? x.transcript.text : '') + ' ' + (x.ai ? x.ai.output : '')).toLowerCase().includes(filter.toLowerCase()));
  const key = { n: (x) => x.n, name: (x) => x.name.toLowerCase(), dur: (x) => x.duration || 0, lang: (x) => x.language || '', status: (x) => x.status, words: (x) => (x.transcript ? x.transcript.words : 0) }[sort.k];
  shown = shown.slice().sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * sort.d);
  const th = (k, label) => html`<th class="sortable" onClick=${() => setSort({ k, d: sort.k === k ? -sort.d : 1 })}>${label}${sort.k === k ? (sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const addItems = async (files, links) => { const np = await adder.run('scribe.addItems', { projectId: id, files, urls: links, expand }, 'Add items'); if (np) { setP(np); setUrls(''); onChanged(); } };
  const runAll = async (rowIds) => { const o = await r.run('scribe.runBulk', { projectId: id, rowIds, options: Object.assign({}, opts, extra) }, `Bulk: ${p.name}`); if (o) { setP(o.project); toast(`${o.done} done${o.failed ? `, ${o.failed} failed` : ''}`, o.failed ? 'error' : 'ok'); onChanged(); } };
  const waiting = rows.filter((x) => x.status !== 'done').length;
  const target = sel.length ? sel : rows.filter((x) => x.transcript).map((x) => x.id);
  return html`<div class="bulk">
    <div class="bulk-top">
      <section class="panel">
        <h3>Add</h3>
        <${Dropzone} label="Drop files" sub="or click to browse" accept=${MEDIA_RE} onFiles=${(f) => addItems(f, [])} onPick=${async () => { const f = await pickFiles({ multi: true, filters: MEDIA_FILTERS }); if (f.length) addItems(f, []); }} />
        <textarea class="input" rows="3" placeholder="Paste links, one per line — videos, playlists or channels" value=${urls} onInput=${(e) => setUrls(e.target.value)} />
        <div class="row between"><${Toggle} checked=${expand} onChange=${setExpand} label="Expand playlists and channels" /><${Button} disabled=${!urls.trim()} busy=${adder.busy} onClick=${() => addItems([], urls.split(/\s+/).filter(Boolean))}>Add links</${Button}></div>
        <${Progress} runner=${adder} />
      </section>
      <section class="panel">
        <h3>Options</h3>
        <${EngineOptions} value=${opts} onChange=${setOpts} />
        <div class="grid2"><${Toggle} checked=${extra.useCaptions} onChange=${(x) => setExtra(Object.assign({}, extra, { useCaptions: x }))} label="Use platform captions when available" />
        <${Toggle} checked=${extra.saveMedia} onChange=${(x) => setExtra(Object.assign({}, extra, { saveMedia: x }))} label="Keep downloaded media" />
        ${extra.saveMedia ? html`<${Toggle} checked=${extra.saveVideo} onChange=${(x) => setExtra(Object.assign({}, extra, { saveVideo: x }))} label="Keep video (not just audio)" />` : null}</div>
        <details><summary>After transcribing…</summary>
          <${Field} label="Run an AI prompt on each item"><${PromptSelect} value="" onChange=${(pid, pr) => setExtra(Object.assign({}, extra, { promptText: pr ? pr.prompt : '' }))} /><textarea class="input" rows="2" value=${extra.promptText} onInput=${(e) => setExtra(Object.assign({}, extra, { promptText: e.target.value }))} placeholder="(none)" /></${Field}>
          <${Field} label="Translate each item to"><${LangMulti} value=${extra.translateTo} onChange=${(x) => setExtra(Object.assign({}, extra, { translateTo: x }))} list=${NLLB} /></${Field}>
          ${extra.translateTo.length ? html`<${Field} label="Translation engine"><${Select} value=${extra.translateEngine} onChange=${(x) => setExtra(Object.assign({}, extra, { translateEngine: x }))} options=${[['ai', 'AI model'], ['local', 'NLLB-200 offline']]} /></${Field}>` : null}
        </details>
        <${Button} kind="primary" icon="play" busy=${r.busy} disabled=${!waiting} onClick=${() => runAll(null)} cls="wide">${waiting ? `Process ${count(waiting, 'waiting item')}` : 'Everything is processed'}</${Button}>
        <${Progress} runner=${r} />
      </section>
    </div>
    <div class="row between grid-bar">
      <input class="input search" placeholder="Filter by name, transcript or AI output" value=${filter} onInput=${(e) => setFilter(e.target.value)} />
      <div class="row gap wrap">
        <span class="muted small">${sel.length ? `${sel.length} selected` : `${rows.length} items`}</span>
        <${Button} size="sm" icon="sparkle" disabled=${!rows.some((x) => x.transcript)} onClick=${() => setDlg('ai')}>AI prompt</${Button}>
        <${Button} size="sm" icon="globe" disabled=${!rows.some((x) => x.transcript)} onClick=${() => setDlg('tr')}>Translate</${Button}>
        <${Button} size="sm" icon="export" disabled=${!rows.some((x) => x.transcript)} onClick=${() => setDlg('export')}>Export</${Button}>
        ${sel.length ? html`<${Button} size="sm" icon="refresh" onClick=${() => runAll(sel)}>Re-run selected</${Button}><${Button} size="sm" kind="danger" onClick=${async () => { setP(await call('scribe.deleteRows', { projectId: id, rowIds: sel })); setSel([]); }}>Remove selected</${Button}>` : null}
        <${IconButton} icon="folder" title="Save project file as…" onClick=${async () => { const f = await saveFile({ defaultPath: `${p.name}.amescribe`, filters: [{ name: 'Scribe project', extensions: ['amescribe'] }] }); if (f) { await call('scribe.exportProject', { id, file: f }); toast('Project file saved', 'ok'); } }} />
        <${IconButton} icon="trash" title="Delete batch" onClick=${() => setDel(true)} />
      </div>
    </div>
    ${rows.length ? html`<div class="grid-wrap"><table class="table grid">
      <thead><tr><th><input type="checkbox" checked=${sel.length && sel.length === shown.length} onChange=${(e) => setSel(e.target.checked ? shown.map((x) => x.id) : [])} /></th>${th('n', '#')}${th('name', 'Name')}${th('dur', 'Length')}${th('lang', 'Language')}${th('status', 'Status')}${th('words', 'Words')}<th>Transcript</th><th>AI output</th></tr></thead>
      <tbody>${shown.map((x) => html`<tr class=${sel.includes(x.id) ? 'sel' : ''} onDblClick=${() => x.transcript && go('scribe.editor', { projectId: id, rowId: x.id })}>
        <td><input type="checkbox" checked=${sel.includes(x.id)} onChange=${() => setSel(sel.includes(x.id) ? sel.filter((y) => y !== x.id) : sel.concat([x.id]))} /></td>
        <td class="tnum">${x.n}</td><td class="name-cell" title=${x.source.url || x.source.path}>${x.name}</td><td class="tnum">${x.duration ? clock(x.duration) : ''}</td><td>${x.language || ''}</td>
        <td><${Badge} kind=${(STATUS[x.status] || ['', ''])[1]}>${(STATUS[x.status] || [x.status])[0]}</${Badge}>${x.error ? html`<div class="err-cell" title=${x.error}>${x.error}</div>` : null}</td>
        <td class="tnum">${x.transcript ? x.transcript.words.toLocaleString() : ''}</td>
        <td class="clip-cell">${x.transcript ? x.transcript.text.slice(0, 140) : ''}</td><td class="clip-cell">${x.ai ? (x.ai.output || x.ai.error || '').slice(0, 140) : ''}</td></tr>`)}</tbody></table></div>
      <p class="muted small">Double-click a row to open it in the editor.</p>` : html`<${Empty} icon="layers" title="Add files or links to this batch" />`}
    ${(p.combined || []).length ? html`<section class="panel"><h3>Combined results</h3>${p.combined.map((c) => html`<details class="tr-block"><summary><b>${c.prompt.slice(0, 80)}</b> <span class="muted small">${count(c.rows.length, 'item')} — ${ago(c.at)}</span></summary><div class="row gap"><${Copyable} text=${c.output} /></div><${Markdown} text=${c.output} /></details>`)}</section>` : null}
    ${dlg === 'ai' ? html`<${BulkAi} id=${id} rowIds=${target} onClose=${() => setDlg('')} onDone=${(np) => { setDlg(''); if (np) setP(np); }} />` : null}
    ${dlg === 'tr' ? html`<${BulkTranslate} id=${id} rowIds=${target} onClose=${() => setDlg('')} onDone=${(np) => { setDlg(''); if (np) setP(np); }} />` : null}
    ${dlg === 'export' ? html`<${BulkExport} id=${id} rowIds=${target} name=${p.name} onClose=${() => setDlg('')} />` : null}
    ${del ? html`<${Confirm} title="Delete batch?" text=${`"${p.name}" and its transcripts will be deleted from this app. Exported files stay.`} onClose=${() => setDel(false)} onYes=${async () => { await call('scribe.remove', { id }); onDeleted(); }} />` : null}
  </div>`;
}

function BulkAi({ id, rowIds, onClose, onDone }) {
  const [text, setText] = useState('');
  const [scope, setScope] = useState('each');
  const [target, setTarget] = useState('text');
  const r = useRunner(M);
  const go2 = async () => {
    const o = scope === 'merge' ? await r.run('scribe.combine', { projectId: id, instruction: text }, 'Combine AI outputs') : await r.run('scribe.runPrompt', { projectId: id, rowIds, promptText: text, target, scope }, 'AI prompt on batch');
    if (o) { const np = o.project || await call('scribe.open', { id }); onDone(np); toast(scope === 'combined' || scope === 'merge' ? 'Combined result added below the grid' : 'AI Output column updated', 'ok'); }
  };
  return html`<${Modal} title=${`AI prompt — ${count(rowIds.length, 'item')}`} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${r.busy} disabled=${scope !== 'merge' && !text.trim()} onClick=${go2}>Run</${Button}>`}>
    <${Field} label="How"><${Segmented} value=${scope} onChange=${setScope} options=${[['each', 'Each item'], ['combined', 'All together'], ['aiout-each', 'On AI outputs'], ['merge', 'Merge AI outputs']]} /></${Field}>
    <p class="muted small">${{ each: 'Runs the prompt on every transcript and writes the result to its AI Output column.', combined: 'Sends all selected transcripts at once and creates one combined result.', 'aiout-each': 'Runs the prompt on each item\'s existing AI output (e.g. shorten or translate it).', merge: 'Merges every AI output into one master document.' }[scope]}</p>
    ${scope !== 'merge' ? html`<${PromptSelect} value="" onChange=${(pid, p) => p && setText(p.prompt)} />` : null}
    <${Field} label=${scope === 'merge' ? 'Extra instruction (optional)' : 'Prompt'}><textarea class="input" rows="4" value=${text} onInput=${(e) => setText(e.target.value)} /></${Field}>
    ${scope === 'each' || scope === 'combined' ? html`<${Field} label="Run on"><${Select} value=${target} onChange=${setTarget} options=${[['text', 'Text with timestamps'], ['srt', 'SRT'], ['vtt', 'VTT'], ['csv', 'CSV'], ['json', 'JSON']]} /></${Field}>` : null}
    <${Progress} runner=${r} />
  </${Modal}>`;
}

function BulkTranslate({ id, rowIds, onClose, onDone }) {
  const [langs, setLangs] = useState([]);
  const [engine, setEngine] = useState('ai');
  const r = useRunner(M);
  return html`<${Modal} wide title=${`Translate ${count(rowIds.length, 'transcript')}`} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${r.busy} disabled=${!langs.length} onClick=${async () => { const o = await r.run('scribe.translateRows', { projectId: id, rowIds, targets: langs, engine }, 'Bulk translate', 'Translations ready — export to get the files'); if (o) onDone(o.project); }}>Translate</${Button}>`}>
    <${LangMulti} value=${langs} onChange=${setLangs} list=${NLLB} />
    <${Field} label="Engine"><${Select} value=${engine} onChange=${setEngine} options=${[['ai', 'AI model (best quality)'], ['local', 'NLLB-200 offline (free, unlimited)']]} /></${Field}>
    <p class="muted small">Each source language is detected per file. Timestamps and structure are preserved.</p>
    <${Progress} runner=${r} />
  </${Modal}>`;
}

function BulkExport({ id, rowIds, name, onClose }) {
  const [fmts, setFmts] = useState(['txt', 'srt']);
  const [tr, setTr] = useState(true);
  const [ai, setAi] = useState(true);
  const r = useRunner(M);
  const go2 = async (dir) => { const o = await r.run('scribe.export', { projectId: id, rowIds, formats: fmts, dir, includeTranslations: tr, includeAi: ai }, 'Export batch', 'Exported'); if (o) { openPath(o.dir); onClose(); } };
  return html`<${Modal} title=${`Export ${count(rowIds.length, 'item')}`} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}>
    <${Button} onClick=${async () => { const f = await saveFile({ defaultPath: `${name}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] }); if (f) { await call('scribe.exportGrid', { projectId: id, file: f }); showInFolder(f); } }}>Grid as spreadsheet</${Button}>
    <${Button} onClick=${async () => { const d = await pickFiles({ directory: true }); if (d[0]) go2(d[0]); }}>Choose folder…</${Button}><${Button} kind="primary" busy=${r.busy} disabled=${!fmts.length} onClick=${() => go2('')}>Export to Exports folder</${Button}>`}>
    <div class="chips">${FORMATS.map((f) => html`<button class=${'chip ' + (fmts.includes(f[0]) ? 'on' : '')} onClick=${() => setFmts(fmts.includes(f[0]) ? fmts.filter((x) => x !== f[0]) : fmts.concat([f[0]]))}>${f[1]}</button>`)}</div>
    <${Toggle} checked=${tr} onChange=${setTr} label="Include translations (one file per language)" />
    <${Toggle} checked=${ai} onChange=${setAi} label="Include AI outputs" />
    <${Progress} runner=${r} />
  </${Modal}>`;
}

// ------------------------------------------------------------------ Translate files
export function Translate() {
  const [files, setFiles] = useState([]);
  const [langs, setLangs] = useState([]);
  const [engine, setEngine] = useState('ai');
  const [source, setSource] = useState('');
  const [out, setOut] = useState(null);
  const r = useRunner(M);
  useEffect(() => { call('settings.get').then((s) => setEngine(s.settings.translation.engine)); }, []);
  return html`<div class="page">
    <${PageHeader} title="Translate" sub="Translate transcripts and subtitles into 200+ languages in one run — timestamps and structure preserved." module=${M} help="scribe.translate" />
    <div class="tts-grid">
      <section class="panel">
        <h3>1. Files</h3>
        <${Dropzone} label="Drop SRT, VTT, CSV, JSON, TXT, Markdown, Word or PDF files" accept=${/\.(srt|vtt|csv|json|txt|md|docx|pdf|lrc|sbv)$/i} onFiles=${(f) => setFiles(files.concat(f))} onPick=${async () => { const f = await pickFiles({ multi: true, filters: SUB_FILTERS }); setFiles(files.concat(f)); }} />
        ${files.length ? html`<div class="chips">${files.map((f) => html`<button class="chip on" onClick=${() => setFiles(files.filter((x) => x !== f))}>${f.split(/[\\/]/).pop()} ✕</button>`)}</div>` : null}
        <${Field} label="Source language"><${LangSelect} value=${source} onChange=${setSource} list=${NLLB} placeholder="Detect automatically (per file)" /></${Field}>
        <${Field} label="Engine"><${Select} value=${engine} onChange=${setEngine} options=${[['ai', 'AI model (best quality)'], ['local', 'NLLB-200 offline (free, runs on this PC)']]} /></${Field}>
      </section>
      <section class="panel">
        <h3>2. Languages</h3>
        <${LangMulti} value=${langs} onChange=${setLangs} list=${NLLB} />
        <${Button} kind="primary" icon="globe" busy=${r.busy} disabled=${!files.length || !langs.length} cls="wide" onClick=${async () => { const o = await r.run('scribe.translateFiles', { files, targets: langs, engine, source }, `Translate ${count(files.length, 'file')}`, 'Translations saved'); if (o) setOut(o); }}>Translate ${files.length ? count(files.length, 'file') : ''} into ${langs.length ? count(langs.length, 'language') : '…'}</${Button}>
        <${Progress} runner=${r} />
        ${out ? html`<div class="result-card"><b>${count(out.files.length, 'file')} saved</b><div class="row gap"><${Button} size="sm" onClick=${() => openPath(out.dir)}>Open folder</${Button}></div><ul class="file-list">${out.files.slice(0, 50).map((f) => html`<li>${f.split(/[\\/]/).pop()}</li>`)}</ul></div>` : null}
      </section>
    </div>
    <p class="muted small">To translate transcripts you already made, use Translate in the Bulk grid or in the editor.</p>
  </div>`;
}

// ------------------------------------------------------------------ Prompt library
export function Prompts() {
  const pr = useAsync(() => call('scribe.prompts'), []);
  const [cat, setCat] = useState(-1);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  if (!pr.data) return html`<div class="page"><${Spinner} /></div>`;
  const shown = pr.data.prompts.filter((p) => (cat < 0 || p.cat === cat) && (!q || (p.title + p.prompt).toLowerCase().includes(q.toLowerCase())));
  return html`<div class="page">
    <${PageHeader} title="Prompt library" sub=${`${pr.data.prompts.length} prompts in ${pr.data.categories.length} categories. Save your own and share them with your team.`} module=${M} help="scribe.prompts">
      <${Button} icon="plus" kind="primary" onClick=${() => setEdit({ title: '', prompt: '' })}>New prompt</${Button}>
      <${Button} icon="download" onClick=${async () => { const f = await saveFile({ defaultPath: 'my-prompts.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); if (f) { await call('scribe.exportPrompts', { file: f }); toast('Prompts exported', 'ok'); } }}>Export mine</${Button}>
      <${Button} icon="upload" onClick=${async () => { const f = await pickFiles({ filters: [{ name: 'JSON', extensions: ['json'] }] }); if (f[0]) { try { pr.set(await call('scribe.importPrompts', { file: f[0] })); toast('Prompts imported', 'ok'); } catch (e) { toast(e.message, 'error'); } } }}>Import</${Button}>
    </${PageHeader}>
    <div class="row gap wrap"><input class="input search" placeholder="Search prompts" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips"><button class=${'chip ' + (cat < 0 ? 'on' : '')} onClick=${() => setCat(-1)}>All</button>${pr.data.categories.map((c, i) => html`<button class=${'chip ' + (cat === i ? 'on' : '')} onClick=${() => setCat(i)}>${c}</button>`)}</div></div>
    <div class="prompt-grid">${shown.map((p) => html`<article class="prompt-card"><header><b>${p.title}</b><span class="muted small">${pr.data.categories[p.cat]}</span></header><p>${p.prompt}</p>
      <div class="row gap"><${Copyable} text=${p.prompt} />${p.builtIn ? html`<${Button} size="sm" onClick=${() => setEdit({ title: p.title + ' (my version)', prompt: p.prompt })}>Duplicate</${Button}>` : html`<${Button} size="sm" onClick=${() => setEdit(p)}>Edit</${Button}><${Button} size="sm" kind="danger" onClick=${async () => pr.set(await call('scribe.deletePrompt', { id: p.id }))}>Delete</${Button}>`}</div></article>`)}</div>
    ${edit ? html`<${Modal} title=${edit.id ? 'Edit prompt' : 'New prompt'} onClose=${() => setEdit(null)} footer=${html`<${Button} onClick=${() => setEdit(null)}>Cancel</${Button}><${Button} kind="primary" onClick=${async () => { try { pr.set(await call('scribe.savePrompt', { prompt: edit })); setEdit(null); toast('Prompt saved', 'ok'); } catch (e) { toast(e.message, 'error'); } }}>Save prompt</${Button}>`}>
      <${Field} label="Title"><input class="input" value=${edit.title} onInput=${(e) => setEdit(Object.assign({}, edit, { title: e.target.value }))} /></${Field}>
      <${Field} label="Instruction" hint="The transcript is added automatically after your instruction."><textarea class="input" rows="7" value=${edit.prompt} onInput=${(e) => setEdit(Object.assign({}, edit, { prompt: e.target.value }))} /></${Field}>
    </${Modal}>` : null}
  </div>`;
}

// ------------------------------------------------------------------ Downloader
export function Downloader() {
  const [urls, setUrls] = useState('');
  const [mode, setMode] = useState('video');
  const [quality, setQuality] = useState('1080');
  const [afmt, setAfmt] = useState('mp3');
  const [dir, setDir] = useState('');
  const [items, setItems] = useState([]);
  const r = useRunner(M);
  useEffect(() => on('download-item', (d) => { if (d.jobId === r.jobId) setItems((x) => x.concat([d.item])); }), [r.jobId]);
  const links = urls.split(/\s+/).filter((u) => /^https?:\/\//.test(u));
  return html`<div class="page">
    <${PageHeader} title="Downloader" sub="Save video or audio from 1,800+ sites to your computer." module=${M} help="scribe.downloader" />
    <div class="tts-grid">
      <section class="panel">
        <${Field} label="Links (one per line)"><textarea class="input" rows="8" value=${urls} onInput=${(e) => setUrls(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></${Field}>
        <div class="grid2"><${Field} label="Save as"><${Segmented} value=${mode} onChange=${setMode} options=${[['video', 'Video'], ['audio', 'Audio only']]} /></${Field}>
        ${mode === 'video' ? html`<${Field} label="Max quality"><${Select} value=${quality} onChange=${setQuality} options=${[['2160', '4K'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']]} /></${Field}>` : html`<${Field} label="Audio format"><${Select} value=${afmt} onChange=${setAfmt} options=${[['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC'], ['opus', 'Opus']]} /></${Field}>`}</div>
        <div class="row gap"><${Button} icon="folder" onClick=${async () => { const d = await pickFiles({ directory: true }); if (d[0]) setDir(d[0]); }}>${dir ? dir.split(/[\\/]/).pop() : 'Downloads folder'}</${Button}>
        <${Button} kind="primary" icon="download" busy=${r.busy} disabled=${!links.length} onClick=${async () => { setItems([]); const o = await r.run('scribe.download', { urls: links, mode, quality, audioFormat: afmt, dir }, `Download ${count(links.length, 'item')}`); if (o) { setItems(o.results); toast(`${o.results.filter((x) => x.ok).length} downloaded`, 'ok'); } }}>Download ${links.length ? count(links.length, 'link') : ''}</${Button}></div>
        <${Progress} runner=${r} />
      </section>
      <section class="panel">
        <h3>Results</h3>
        ${items.length ? html`<div class="list">${items.map((x) => html`<div class="list-row"><${Icon} name=${x.ok ? 'check' : 'x'} /><span class="list-main"><b>${x.ok ? x.file.split(/[\\/]/).pop() : x.url}</b><span class="muted small">${x.ok ? '' : x.error}</span></span>${x.ok ? html`<${Button} size="sm" onClick=${() => showInFolder(x.file)}>Show</${Button}>` : null}</div>`)}</div>` : html`<p class="muted">Downloaded files appear here.</p>`}
      </section>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Link extractor
export function Extractor() {
  const [src, setSrc] = useState('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [engine, setEngine] = useState('google');
  const [pages, setPages] = useState(3);
  const [onlyVideos, setOnlyVideos] = useState(true);
  const [links, setLinks] = useState(null);
  const [sel, setSel] = useState([]);
  const [send, setSend] = useState(false);
  const r = useRunner(M);
  const go2 = async () => { const o = await r.run('scribe.extract', src === 'url' ? { url, pages, onlyVideos } : src === 'search' ? { query, engine, pages, onlyVideos } : { text }, src === 'search' ? 'Search' : 'Extract links'); if (o) { setLinks(o.links); setSel(o.links.map((l) => l.url)); if (!o.links.length) toast('No links found. Try another search or turn off “Only video links”.', 'info'); } };
  return html`<div class="page">
    <${PageHeader} title="Link extractor" sub="Scan playlists, channels, Google Docs, search results or any web page for YouTube, Vimeo and hosted video files." module=${M} help="scribe.extractor" />
    <section class="panel">
      <${Segmented} value=${src} onChange=${setSrc} options=${[['url', 'From a link'], ['search', 'From search results'], ['text', 'From pasted text']]} />
      ${src === 'search' ? html`<div class="row gap wrap"><input class="input grow" placeholder="What to search for, e.g. sourdough starter tutorial" value=${query} onInput=${(e) => setQuery(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && query.trim() && go2()} />
          <${Select} value=${engine} onChange=${setEngine} options=${[['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo']]} />
          <${Select} value=${String(pages)} onChange=${(v) => setPages(Number(v))} options=${[1, 2, 3, 5, 10].map((n) => [String(n), `${n} page${n > 1 ? 's' : ''}`])} />
          <${Button} kind="primary" icon="search" busy=${r.busy} disabled=${!query.trim()} onClick=${go2}>Search</${Button}></div>
        <${Toggle} checked=${onlyVideos} onChange=${setOnlyVideos} label="Only video links" hint="Off: every result link, for research lists and outreach." />
        <p class="muted small">Results are read in a hidden browser window. If the search engine asks you to accept cookies or confirm you're not a robot, that window opens so you can answer it.</p>`
      : src === 'url' ? html`<div class="row gap"><input class="input grow" placeholder="YouTube playlist or channel, Google Doc, or any page URL" value=${url} onInput=${(e) => setUrl(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && url && go2()} /><${Button} kind="primary" icon="link" busy=${r.busy} disabled=${!url} onClick=${go2}>Extract</${Button}></div>`
        : html`<textarea class="input" rows="6" placeholder="Paste HTML, emails, a list — any text containing links" value=${text} onInput=${(e) => setText(e.target.value)} /><${Button} kind="primary" icon="link" busy=${r.busy} disabled=${!text} onClick=${go2}>Extract</${Button}>`}
      <${Progress} runner=${r} />
    </section>
    ${links ? html`<div class="row between grid-bar"><span class="muted">${count(links.length, 'link')} found — ${sel.length} selected</span><div class="row gap">
      <${Button} size="sm" icon="copy" disabled=${!sel.length} onClick=${() => copy(sel.join('\n'), `${sel.length} links copied`)}>Copy</${Button}>
      <${Button} size="sm" icon="download" disabled=${!sel.length} onClick=${async () => { const f = await saveFile({ defaultPath: 'links.txt', filters: [{ name: 'Text', extensions: ['txt'] }] }); if (f) { await call('file.writeText', { file: f, text: sel.join('\n') + '\n' }); showInFolder(f); } }}>Save .txt</${Button}>
      <${Button} size="sm" kind="primary" icon="layers" disabled=${!sel.length} onClick=${() => setSend(true)}>Send to Bulk transcribe</${Button}></div></div>
      <div class="list">${links.map((l) => html`<label class="list-row"><input type="checkbox" checked=${sel.includes(l.url)} onChange=${() => setSel(sel.includes(l.url) ? sel.filter((x) => x !== l.url) : sel.concat([l.url]))} /><span class="list-main"><b>${l.title || l.url}</b>${l.title ? html`<span class="muted small">${l.url}</span>` : null}</span>${l.duration ? html`<span class="muted small tnum">${clock(l.duration)}</span>` : null}</label>`)}</div>` : null}
    ${send ? html`<${SendBulk} urls=${sel} onClose=${() => setSend(false)} />` : null}
  </div>`;
}

function SendBulk({ urls, onClose }) {
  const projects = useAsync(() => call('scribe.projects').then((l) => l.filter((x) => x.kind !== 'single')), []);
  const [pid, setPid] = useState('__new');
  const [name, setName] = useState('Extracted links');
  const go2 = async () => {
    let id = pid;
    if (id === '__new') id = (await call('scribe.create', { name })).id;
    await job('scribe.addItems', { projectId: id, urls, expand: false }, 'Add links', { module: M });
    setScribe(id);
    go('scribe.bulk', { id });
  };
  return html`<${Modal} title=${`Send ${count(urls.length, 'link')} to Bulk`} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" onClick=${go2}>Send</${Button}>`}>
    <${Field} label="Batch"><${Select} value=${pid} onChange=${setPid} options=${[['__new', '+ New batch']].concat((projects.data || []).map((p) => [p.id, p.name]))} /></${Field}>
    ${pid === '__new' ? html`<${Field} label="Name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /></${Field}>` : null}
  </${Modal}>`;
}
