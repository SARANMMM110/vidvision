import { html, useState, useEffect, useRef, useMemo, useStore, call, job, go, toast, useRunner, mediaUrl, clock, ago, count, copy, pickFiles, saveFile, openPath, showInFolder, AUDIO_FILTERS, DOC_FILTERS, MEDIA_FILTERS, bytes } from '../lib.js';
import { PageHeader, Button, IconButton, Icon, Field, Select, Toggle, Range, Segmented, Tabs, Badge, Empty, Modal, Progress, Spinner, ErrorBox, Audio, useAsync, Confirm, LangSelect, Copyable, Dropzone } from '../ui.js';
import data from '../../shared/data.js';
import NLLB from '../../shared/nllb-languages.js';

const M = 'voice';

// ------------------------------------------------------------------ voice picker
function useEngines() { return useAsync(() => call('voice.engines'), []); }
const ENGINE_NAMES = { cloud: 'Built-in voice', myvoices: 'Your voice (cloud)', localclone: 'Your voice (offline)', kokoro: 'Kokoro (offline)', piper: 'Piper (offline)', openai: 'OpenAI', gemini: 'Gemini', elevenlabs: 'ElevenLabs', custom: 'Custom server' };
const engineName = (id) => ENGINE_NAMES[id] || id || '';
/** Can this account clone/design voices right now (built-in, or own ElevenLabs key in advanced mode)? */
/** Languages built-in cloned voices speak, when the AI server limits them (null = every language). */
function cloneLangs(list) { const e = (list || []).find((x) => x.id === 'myvoices'); return e && Array.isArray(e.languages) ? e.languages : null; }

function canClone(list) { return (list || []).some((e) => (e.id === 'myvoices' || e.id === 'elevenlabs') && e.ready); }

/** AI enhance / auto / writer + saved styles for engines with style direction. */
function StyleTools({ style, text, onStyle }) {
  const r = useRunner(M);
  const saved = useAsync(() => call('voice.styles'), []);
  const [idea, setIdea] = useState(null);
  const [naming, setNaming] = useState(null);
  return html`<div class="style-tools">
    <div class="row gap wrap">
      <${Button} size="sm" icon="sparkle" busy=${r.busy} onClick=${async () => { const o = await r.run('voice.styleEnhance', { style, text }, 'AI enhance style'); if (o) onStyle(o.style); }}>AI enhance</${Button}>
      <${Button} size="sm" busy=${r.busy} disabled=${!String(text || '').trim()} title=${text ? 'Direction chosen from your script' : 'Write the script first'} onClick=${async () => { const o = await r.run('voice.styleAuto', { text }, 'Auto style'); if (o) onStyle(o.style); }}>Auto</${Button}>
      <${Button} size="sm" onClick=${() => setIdea('')}>AI writer</${Button}>
      <${Button} size="sm" disabled=${!String(style || '').trim()} onClick=${() => setNaming('My style')}>Save style</${Button}>
      ${(saved.data || []).length ? html`<${Select} value="" onChange=${(id) => { const s = (saved.data || []).find((x) => x.id === id); if (s) onStyle(s.style); }} options=${[['', 'My styles…']].concat(saved.data.map((s) => [s.id, s.name]))} />` : null}
    </div>
    ${naming !== null ? html`<div class="row gap"><input class="input grow" placeholder="Style name" value=${naming} onInput=${(e) => setNaming(e.target.value)} /><${Button} size="sm" kind="primary" disabled=${!naming.trim()} onClick=${async () => { saved.set(await call('voice.styleSave', { name: naming, style })); setNaming(null); toast('Style saved', 'ok'); }}>Save</${Button}><${Button} size="sm" onClick=${() => setNaming(null)}>Cancel</${Button}></div>` : null}
    ${idea !== null ? html`<div class="row gap"><input class="input grow" placeholder="Describe the feel in a few words, e.g. late-night radio host" value=${idea} onInput=${(e) => setIdea(e.target.value)} /><${Button} size="sm" kind="primary" busy=${r.busy} disabled=${!idea.trim()} onClick=${async () => { const o = await r.run('voice.styleWrite', { idea }, 'AI writer'); if (o) { onStyle(o.style); setIdea(null); } }}>Write</${Button}><${Button} size="sm" onClick=${() => setIdea(null)}>Cancel</${Button}></div>` : null}
    <${Progress} runner=${r} />
  </div>`;
}

export function VoicePicker({ value, onChange, compact, text }) {
  const engines = useEngines();
  const v = value || { engine: 'cloud', voice: 'marin', style: '', speed: 1 };
  const voices = useAsync(() => call('voice.voices', { engine: v.engine }).catch((e) => { throw e; }), [v.engine]);
  const [playing, setPlaying] = useState('');
  const pr = useRunner(M);
  const eng = (engines.data || []).find((e) => e.id === v.engine) || {};
  const set = (p) => onChange(Object.assign({}, v, p));
  useEffect(() => {
    if (value) return;
    call('settings.get').then((s) => {
      const e = (s.settings.tts && s.settings.tts.engine) || 'cloud';
      onChange({ engine: e, voice: e === 'kokoro' ? 'af_heart' : e === 'cloud' ? (s.settings.tts.voice || 'marin') : '', speed: 1, style: '' });
    }).catch(() => onChange(v));
  }, []);
  useEffect(() => {
    if (voices.data && voices.data.length && !voices.data.find((x) => x.id === v.voice && (x.libId || '') === (v.libId || ''))) set({ voice: voices.data[0].id, libId: voices.data[0].libId, name: voices.data[0].name });
  }, [voices.data]);
  const preview = async () => {
    const r = await pr.run('voice.preview', { engine: v.engine, voice: v.voice, style: v.style, speed: v.speed }, 'Voice preview');
    if (r) { setPlaying(r.file); }
  };
  const voiceOpts = (voices.data || []).map((x) => [x.libId ? 'lib:' + x.libId : x.id, `${x.name}${x.gender ? ' — ' + x.gender : ''}${x.lang && x.lang !== 'multi' ? ' — ' + (x.language || x.lang) : ''}${x.installed === false ? ' (downloads)' : ''}`]);
  return html`<div class=${'voice-picker ' + (compact ? 'compact' : '')}>
    <div class="grid2">
      <${Field} label="Engine"><${Select} value=${v.engine} onChange=${(e) => set({ engine: e, voice: '', libId: '' })} options=${(engines.data || []).map((e) => [e.id, `${e.label}${e.local ? ' (free, offline)' : ''}${e.ready ? '' : e.cloud ? ' — unavailable' : ' — needs setup'}`])} /></${Field}>
      <${Field} label="Voice">${voices.error ? html`<div class="error-box small">${voices.error.message}</div>` : html`<div class="row gap"><${Select} value=${v.libId ? 'lib:' + v.libId : v.voice} onChange=${(id) => { const x = (voices.data || []).find((y) => (y.libId ? 'lib:' + y.libId : y.id) === id); set({ voice: x ? x.id : id, libId: x && x.libId ? x.libId : '', name: x ? x.name : id }); }} options=${voiceOpts} cls="grow" />
        <${IconButton} icon="play" title="Preview voice" onClick=${preview} /></div>`}</${Field}>
    </div>
    ${playing ? html`<audio class="preview-audio" src=${mediaUrl(playing)} autoplay controls />` : null}
    <${Progress} runner=${pr} />
    ${compact ? null : html`<div class="grid2">
      <${Range} label="Speed" value=${v.speed || 1} min=${0.6} max=${1.6} step=${0.05} onChange=${(x) => set({ speed: x })} fmt=${(x) => x.toFixed(2) + '×'} />
      ${eng.style ? html`<${Field} label="Style"><${Select} value=${(data.VOICE_STYLES.find((s) => s[1] === v.style) || ['custom'])[0] === 'custom' && v.style ? '__custom' : v.style} onChange=${(x) => set({ style: x === '__custom' ? (v.style || ' ') : x })} options=${[['', 'Natural (no direction)']].concat(data.VOICE_STYLES.map((s) => [s[1], s[0]]), [['__custom', 'Custom direction…']])} /></${Field}>` : html`<p class="muted small">This engine has no style control — pick a different voice for a different feel.</p>`}
    </div>
    ${eng.style && v.style && !data.VOICE_STYLES.find((s) => s[1] === v.style) ? html`<${Field} label="Custom direction"><textarea class="input" rows="2" value=${v.style.trim()} onInput=${(e) => set({ style: e.target.value })} placeholder="e.g. Excited but calm, slight British accent, speaks slowly" /></${Field}>` : null}
    ${eng.style ? html`<${StyleTools} style=${v.style} text=${text} onStyle=${(st) => set({ style: st || ' ' })} />` : null}`}
    ${eng.id && !eng.ready ? html`<p class="muted small">${eng.local ? 'Downloads automatically on first use.' : eng.cloud ? html`Needs an internet connection and the built-in AI on your plan — see <button class="link-btn" onClick=${() => go('settings', { tab: 'builtin' })}>Settings</button>. Kokoro and Piper work offline.` : html`Add your ${eng.label} key in <button class="link-btn" onClick=${() => go('settings', { tab: eng.id === 'custom' ? 'voices' : 'ai' })}>Settings</button>.`}</p>` : null}
  </div>`;
}

// ------------------------------------------------------------------ music bed picker
function BedPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = async () => { setBusy(true); try { setRes(await call('voice.music', { q })); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  const b = value || {};
  return html`<div class="bed">
    <div class="row gap"><${Segmented} value=${b.file || b.item ? 'on' : 'none'} onChange=${(x) => onChange(x === 'none' ? null : Object.assign({ volume: 0.15, duck: true }, b))} options=${[['none', 'No music'], ['on', 'Background music']]} /></div>
    ${b.volume !== undefined ? html`<div class="bed-body">
      <div class="row gap"><input class="input grow" placeholder="Search free music (Jamendo): calm piano, upbeat corporate…" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && search()} /><${Button} busy=${busy} icon="search" onClick=${search}>Search</${Button}>
        <${Button} icon="folder" onClick=${async () => { const f = await pickFiles({ filters: AUDIO_FILTERS }); if (f[0]) onChange(Object.assign({}, b, { file: f[0], item: null, label: f[0].split(/[\\/]/).pop() })); }}>Use my file</${Button}></div>
      ${res ? html`<div class="track-list">${res.map((t) => html`<div class=${'track ' + (b.item && b.item.id === t.id ? 'on' : '')}><button class="track-pick" onClick=${() => onChange(Object.assign({}, b, { item: t, file: '', label: `${t.title} — ${t.artist}` }))}><b>${t.title}</b><span>${t.artist} — ${clock(t.duration)}</span></button><audio controls preload="none" src=${t.preview} /></div>`)}</div>` : null}
      ${b.label ? html`<p class="small">Selected: <b>${b.label}</b>${b.item ? html` <span class="muted">(${b.item.credit})</span>` : null}</p>` : null}
      <div class="grid2"><${Range} label="Music volume" value=${b.volume} min=${0.02} max=${0.6} step=${0.01} onChange=${(x) => onChange(Object.assign({}, b, { volume: x }))} fmt=${(x) => Math.round(x * 100) + '%'} />
      <${Toggle} checked=${b.duck !== false} onChange=${(x) => onChange(Object.assign({}, b, { duck: x }))} label="Lower music while speaking" /></div>
    </div>` : null}
  </div>`;
}

// ------------------------------------------------------------------ Quick TTS
export function QuickTTS() {
  const [text, setText] = useState(() => localStorage.getItem('ame.tts.text') || '');
  const [spec, setSpec] = useState(() => { try { return JSON.parse(localStorage.getItem('ame.tts.spec')) || null; } catch (_) { return null; } });
  const [bed, setBed] = useState(null);
  const [fmt, setFmt] = useState('mp3');
  const [title, setTitle] = useState('');
  const [full, setFull] = useState(false);
  const [write, setWrite] = useState(false);
  const [lang, setLang] = useState('');
  const [result, setResult] = useState(null);
  const r = useRunner(M);
  const tr = useRunner(M);
  useEffect(() => { localStorage.setItem('ame.tts.text', text); }, [text]);
  useEffect(() => { if (spec) localStorage.setItem('ame.tts.spec', JSON.stringify(spec)); }, [spec]);
  const gen = async () => {
    const out = await r.run('voice.tts', { text, voiceSpec: spec, bed, format: fmt, title }, 'Generate speech', 'Saved to Audio Library');
    if (out) setResult(out);
  };
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return html`<div class="page">
    <${PageHeader} title="Quick TTS" sub="Paste a script, pick a voice, generate. Natural built-in voices, your cloned voices, or free offline voices." module=${M} help="voice.tts" />
    <div class="tts-grid">
      <section class=${'panel script ' + (full ? 'full' : '')}>
        <div class="row between"><b>Script</b><div class="row gap">
          <span class="muted small">${text.length.toLocaleString()} characters — ${words} words — about ${clock(words / 2.5)}</span>
          <${Button} size="sm" icon="sparkle" onClick=${() => setWrite(true)}>AI write</${Button}>
          <${IconButton} icon=${full ? 'x' : 'layers'} title=${full ? 'Exit full screen' : 'Full-screen editor'} onClick=${() => setFull(!full)} /></div></div>
        <textarea class="input script-input" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Type or paste what the voice should say…" />
        <div class="row gap"><${LangSelect} value=${lang} onChange=${setLang} list=${NLLB} placeholder="Translate script to…" /><${Button} size="sm" disabled=${!lang || !text.trim()} busy=${tr.busy} onClick=${async () => { const o = await tr.run('voice.translate', { text, lang }, 'Translate script'); if (o) setText(o.text); }}>Translate</${Button}></div>
        <${Progress} runner=${tr} />
      </section>
      <section class="panel">
        <${VoicePicker} value=${spec} onChange=${setSpec} text=${text} />
        <${BedPicker} value=${bed} onChange=${setBed} />
        <div class="grid2"><${Field} label="Title (optional)"><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} /></${Field}>
        <${Field} label="Format"><${Select} value=${fmt} onChange=${setFmt} options=${[['mp3', 'MP3'], ['wav', 'WAV'], ['m4a', 'M4A'], ['flac', 'FLAC'], ['ogg', 'OGG']]} /></${Field}></div>
        <${Button} kind="primary" icon="wave" busy=${r.busy} disabled=${!text.trim() || !spec} onClick=${gen} cls="wide">Generate</${Button}>
        <${Progress} runner=${r} />
        ${result ? html`<${ResultCard} item=${result} onChange=${setResult} />` : null}
      </section>
    </div>
    ${write ? html`<${WriteModal} onClose=${() => setWrite(false)} onText=${(t) => { setText(t); setWrite(false); }} />` : null}
  </div>`;
}

function WriteModal({ onClose, onText, kind = 'voiceover' }) {
  const [f, setF] = useState({ prompt: '', words: 200, tone: '', lang: '' });
  const r = useRunner(M);
  const go2 = async () => { const o = await r.run('voice.write', Object.assign({ kind }, f), 'AI write'); if (o) onText(o.text); };
  return html`<${Modal} title="Write a script with AI" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${r.busy} disabled=${!f.prompt.trim()} onClick=${go2}>Write</${Button}>`}>
    <${Field} label="What is it about?"><textarea class="input" rows="4" value=${f.prompt} onInput=${(e) => setF(Object.assign({}, f, { prompt: e.target.value }))} placeholder="e.g. 60-second promo for a dentist in Austin offering free whitening this month" /></${Field}>
    <div class="grid2"><${Range} label="Length" value=${f.words} min=${30} max=${1500} step=${10} onChange=${(x) => setF(Object.assign({}, f, { words: x }))} fmt=${(x) => `${x} words (~${clock(x / 2.5)})`} />
    <${Field} label="Tone"><input class="input" value=${f.tone} onInput=${(e) => setF(Object.assign({}, f, { tone: e.target.value }))} placeholder="warm, energetic…" /></${Field}></div>
    <${Field} label="Language"><${LangSelect} value=${f.lang} onChange=${(x) => setF(Object.assign({}, f, { lang: x }))} list=${NLLB} placeholder="Same as my request" /></${Field}>
    <${Progress} runner=${r} />
  </${Modal}>`;
}

function ResultCard({ item, onChange }) {
  const [trim, setTrim] = useState({ start: 0, end: item.duration });
  const [editing, setEditing] = useState(false);
  const r = useRunner(M);
  useEffect(() => setTrim({ start: 0, end: item.duration }), [item.id]);
  const exportAs = async (fmt) => { const f = await saveFile({ defaultPath: `${item.title}.${fmt}`, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] }); if (f) { const o = await r.run('voice.audioExport', { id: item.id, format: fmt, file: f }, 'Export audio', 'Exported'); if (o) showInFolder(f); } };
  return html`<div class="result-card">
    <${Audio} file=${item.file} title=${item.title} />
    <details onToggle=${(e) => setEditing(e.target.open)}><summary>Edit (trim / cut)</summary>${editing ? html`<${WaveEditor} item=${item} onChange=${onChange} />` : null}</details>
    <div class="row gap wrap"><span class="muted small">${clock(item.duration)} — ${bytes(item.size)}</span>
      ${['mp3', 'wav', 'flac', 'ogg', 'm4a'].map((f) => html`<${Button} size="sm" onClick=${() => exportAs(f)}>${f.toUpperCase()}</${Button}>`)}
      <${Button} size="sm" onClick=${() => showInFolder(item.file)}>Show file</${Button}></div>
    <${Progress} runner=${r} />
  </div>`;
}

// ------------------------------------------------------------------ waveform editor (trim = keep selection, cut = remove selection)
export function WaveEditor({ item, onChange }) {
  const canvas = useRef(null);
  const audio = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [asNew, setAsNew] = useState(false);
  const [pos, setPos] = useState(0);
  const drag = useRef(null);
  const r = useRunner(M);
  const dur = item.duration || 1;
  useEffect(() => {
    let off = false;
    setPeaks(null);
    (async () => {
      try {
        const buf = await (await fetch(mediaUrl(item.file))).arrayBuffer();
        const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
        const ab = await ac.decodeAudioData(buf);
        const ch = ab.getChannelData(0);
        const n = 600;
        const step = Math.max(1, Math.floor(ch.length / n));
        const p = new Float32Array(n);
        for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; } p[i] = m; }
        if (!off) { setPeaks(p); setSel({ start: 0, end: 0 }); }
      } catch (_) { if (!off) setPeaks(new Float32Array(0)); }
    })();
    return () => { off = true; };
  }, [item.file, item.duration]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !peaks) return;
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = 96 * devicePixelRatio);
    const g = c.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, w, h);
    if (sel.end > sel.start) { g.fillStyle = 'rgba(109,94,252,.28)'; g.fillRect((sel.start / dur) * w, 0, ((sel.end - sel.start) / dur) * w, h); }
    g.fillStyle = cs.getPropertyValue('--voice').trim() || '#35c9b5';
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) { const v = Math.max(1, peaks[i] * h * 0.9); g.fillRect(i * bw, (h - v) / 2, Math.max(1, bw - 1), v); }
    g.fillStyle = '#fff';
    g.fillRect((pos / dur) * w, 0, 2 * devicePixelRatio, h);
  }, [peaks, sel, pos]);
  const tAt = (e) => { const b = canvas.current.getBoundingClientRect(); return Math.max(0, Math.min(dur, ((e.clientX - b.left) / b.width) * dur)); };
  const down = (e) => { const t = tAt(e); drag.current = t; setSel({ start: t, end: t }); };
  const move = (e) => { if (drag.current === null) return; const t = tAt(e); setSel({ start: Math.min(drag.current, t), end: Math.max(drag.current, t) }); };
  const up = (e) => { if (drag.current === null) return; const t = tAt(e); if (Math.abs(t - drag.current) < 0.05) { setSel({ start: 0, end: 0 }); if (audio.current) { audio.current.currentTime = t; setPos(t); } } drag.current = null; };
  const has = sel.end - sel.start >= 0.05;
  const playSel = () => { const a = audio.current; if (!a || !has) return; a.currentTime = sel.start; a.play(); const stop = () => { if (a.currentTime >= sel.end) { a.pause(); a.removeEventListener('timeupdate', stop); } }; a.addEventListener('timeupdate', stop); };
  const apply = async (kind) => {
    const o = await r.run(kind === 'cut' ? 'voice.cutAudio' : 'voice.trim', { id: item.id, start: sel.start, end: sel.end, saveAsNew: asNew }, kind === 'cut' ? 'Cut audio' : 'Trim audio', asNew ? 'Saved as a new clip' : (kind === 'cut' ? 'Cut' : 'Trimmed'));
    if (o) onChange(o);
  };
  return html`<div class="wave-editor">
    ${peaks ? html`<canvas ref=${canvas} class="wave-canvas" onMouseDown=${down} onMouseMove=${move} onMouseUp=${up} onMouseLeave=${up} title="Drag to select a part" />` : html`<${Spinner} label="Reading audio…" />`}
    <audio ref=${audio} src=${mediaUrl(item.file)} controls preload="metadata" onTimeUpdate=${(e) => setPos(e.target.currentTime)} />
    <div class="row gap wrap"><span class="muted small">${has ? `Selected ${sel.start.toFixed(2)}–${sel.end.toFixed(2)} s (${(sel.end - sel.start).toFixed(2)} s)` : 'Drag across the waveform to select a part. Click to move the playhead.'}</span></div>
    <div class="row gap wrap">
      <${Button} size="sm" icon="play" disabled=${!has} onClick=${playSel}>Play selection</${Button}>
      <${Button} size="sm" disabled=${!has} busy=${r.busy} onClick=${() => apply('trim')}>Keep selection</${Button}>
      <${Button} size="sm" icon="scissors" disabled=${!has} busy=${r.busy} onClick=${() => apply('cut')}>Cut selection</${Button}>
      <${Toggle} checked=${asNew} onChange=${setAsNew} label="Save as a new clip" />
    </div>
    <${Progress} runner=${r} />
  </div>`;
}

// ------------------------------------------------------------------ recorder
function Recorder({ onFile }) {
  const [rec, setRec] = useState(null);
  const [secs, setSecs] = useState(0);
  const chunks = useRef([]);
  const timer = useRef(null);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const buf = await new Blob(chunks.current, { type: 'audio/webm' }).arrayBuffer();
        const r = await call('recording.save', { buffer: buf, ext: 'webm' });
        onFile(r.file);
      };
      mr.start(250);
      setRec(mr); setSecs(0);
      timer.current = setInterval(() => setSecs((x) => x + 1), 1000);
    } catch (e) { toast('Microphone not available: ' + e.message, 'error'); }
  };
  const stop = () => { if (rec) rec.stop(); setRec(null); clearInterval(timer.current); };
  useEffect(() => () => { clearInterval(timer.current); if (rec && rec.state !== 'inactive') rec.stop(); }, []);
  return html`<div class="recorder">${rec ? html`<button class="rec-btn on" onClick=${stop}><span class="rec-dot" />Stop — ${clock(secs)}</button>` : html`<button class="rec-btn" onClick=${start}><span class="rec-dot" />Record</button>`}<span class="muted small">Read naturally for 10–60 seconds in a quiet room.</span></div>`;
}

// ------------------------------------------------------------------ Voice clone
export function VoiceClone() {
  const engines = useEngines();
  const [where, setWhere] = useState(localStorage.getItem('ame.clone.where') || 'cloud');
  useEffect(() => { localStorage.setItem('ame.clone.where', where); }, [where]);
  const [src, setSrc] = useState('record');
  const [file, setFile] = useState('');
  const [dur, setDur] = useState(0);
  const [trim, setTrim] = useState({ start: 0, end: 0 });
  const [url, setUrl] = useState({ url: '', start: 0, seconds: 30 });
  const [f, setF] = useState({ name: '', description: '', gender: '', lang: 'multi', removeNoise: true });
  const lib = useAsync(() => call('voice.audio'), []);
  const fetcher = useRunner(M);
  const cloner = useRunner(M);
  const [done, setDone] = useState(null);
  const setSample = (p) => { setFile(p); };
  useEffect(() => { if (!file) return; const a = new window.Audio(mediaUrl(file)); a.onloadedmetadata = () => { setDur(a.duration); setTrim({ start: 0, end: Math.min(a.duration, 60) }); }; }, [file]);
  const clone = async () => {
    const out = await cloner.run('voice.clone', Object.assign({ file, start: trim.start, end: trim.end, where }, f), `Clone voice: ${f.name}`, 'Voice cloned and saved to your Voice Library');
    if (out) setDone(out);
  };
  return html`<div class="page">
    <${PageHeader} title="Voice clone" sub="Make a reusable voice from a short sample — then use it in Quick TTS, Studio and Audiobooks." module=${M} help="voice.clone" />
    <div class="tts-grid">
      <section class="panel">
        <h3>1. Sample</h3>
        <${Segmented} value=${src} onChange=${setSrc} options=${[['record', 'Record'], ['file', 'Import file'], ['url', 'From a link'], ['library', 'Audio library']]} />
        ${src === 'record' ? html`<${Recorder} onFile=${setSample} />` : null}
        ${src === 'file' ? html`<${Dropzone} label="Drop an audio or video file" accept=${/\.(wav|mp3|m4a|flac|ogg|webm|mp4|mov|mkv)$/i} onFiles=${(x) => setSample(x[0])} onPick=${async () => { const x = await pickFiles({ filters: MEDIA_FILTERS }); if (x[0]) setSample(x[0]); }} />` : null}
        ${src === 'url' ? html`<div><${Field} label="Video or podcast link" hint="YouTube, Vimeo, podcasts and 1,800+ sites."><input class="input" value=${url.url} onInput=${(e) => setUrl(Object.assign({}, url, { url: e.target.value }))} /></${Field}>
          <div class="grid2"><${Field} label="Start at (seconds)"><input class="input" type="number" min="0" value=${url.start} onInput=${(e) => setUrl(Object.assign({}, url, { start: Number(e.target.value) || 0 }))} /></${Field}>
          <${Field} label="Length (seconds)"><input class="input" type="number" min="5" max="120" value=${url.seconds} onInput=${(e) => setUrl(Object.assign({}, url, { seconds: Number(e.target.value) || 30 }))} /></${Field}></div>
          <${Button} busy=${fetcher.busy} disabled=${!url.url} onClick=${async () => { const o = await fetcher.run('voice.sourceFromUrl', url, 'Get audio from link'); if (o) setSample(o.file); }}>Get audio</${Button}><${Progress} runner=${fetcher} /></div>` : null}
        ${src === 'library' ? html`<div class="pick-list">${(lib.data || []).slice(0, 50).map((a) => html`<button class=${'pick ' + (file === a.file ? 'on' : '')} onClick=${() => setSample(a.file)}><b>${a.title}</b><span>${clock(a.duration)}</span></button>`)}</div>` : null}
        ${file ? html`<div class="sample"><${Audio} file=${file} title="Sample" />
          <div class="grid2"><${Range} label="Use from" value=${trim.start} min=${0} max=${dur || 1} step=${0.1} onChange=${(x) => setTrim(Object.assign({}, trim, { start: Math.min(x, trim.end - 3) }))} fmt=${(x) => x.toFixed(1) + ' s'} />
          <${Range} label="Use until" value=${trim.end} min=${0} max=${dur || 1} step=${0.1} onChange=${(x) => setTrim(Object.assign({}, trim, { end: Math.max(x, trim.start + 3) }))} fmt=${(x) => x.toFixed(1) + ' s'} /></div>
          <p class=${'small ' + (trim.end - trim.start < 3 ? 'warn' : 'muted')}>${(trim.end - trim.start).toFixed(1)} s selected — 10–60 s of clean speech gives the best clone.</p></div>` : null}
      </section>
      <section class="panel">
        <h3>2. Name it</h3>
        <${Field} label="Voice name"><input class="input" value=${f.name} onInput=${(e) => setF(Object.assign({}, f, { name: e.target.value }))} placeholder="e.g. My podcast voice" /></${Field}>
        <${Field} label="Description (optional)"><input class="input" value=${f.description} onInput=${(e) => setF(Object.assign({}, f, { description: e.target.value }))} placeholder="Warm male narrator" /></${Field}>
        <div class="grid2"><${Field} label="Gender"><${Select} value=${f.gender} onChange=${(x) => setF(Object.assign({}, f, { gender: x }))} options=${[['', '—'], ['female', 'Female'], ['male', 'Male'], ['neutral', 'Neutral']]} /></${Field}>
        <${Toggle} checked=${f.removeNoise} onChange=${(x) => setF(Object.assign({}, f, { removeNoise: x }))} label="Remove background noise" /></div>
        <${Field} label="Where to keep this voice"><${Segmented} value=${where} onChange=${setWhere} options=${[['cloud', 'Built-in (nothing to install)'], ['local', 'On this computer (free, private)']]} /></${Field}>
        ${where === 'local' ? html`<p class="muted small">Cloned on this computer — the sample never leaves it and speaking uses no credits. Best with 5–10 seconds of clean speech; English and Chinese. The first clone downloads the cloning engine (about 160 MB).</p>`
          : engines.data && !canClone(engines.data) ? html`<p class="small warn">Built-in cloning isn't on your plan yet. Use "On this computer" — it's free.</p>`
          : cloneLangs(engines.data) ? html`<p class="muted small">Cloned on the built-in voice server, so there is nothing to download. Best with 5–10 seconds of clean speech. Cloned voices speak English and Chinese; for other languages use a designed voice or one of the natural voices. Speaking uses a few credits.</p>`
          : html`<p class="muted small">Highest likeness in 29 languages; speaking uses AI credits.</p>`}
        <p class="muted small">Only clone voices you own or have permission to use.</p>
        <${Button} kind="primary" icon="clone" busy=${cloner.busy} disabled=${!file || !f.name.trim() || trim.end - trim.start < 3 || (where === 'cloud' && engines.data && !canClone(engines.data))} onClick=${clone} cls="wide">Clone voice</${Button}>
        <${Progress} runner=${cloner} />
        ${done ? html`<div class="result-card"><b>${done.name}</b> is in your Voice Library.<div class="row gap"><${Button} size="sm" onClick=${() => go('voice.tts')}>Use in Quick TTS</${Button}><${Button} size="sm" onClick=${() => go('voice.voices')}>Voice library</${Button}></div></div>` : null}
      </section>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Voice lab
export function VoiceLab() {
  const [tab, setTab] = useState('describe');
  const [desc, setDesc] = useState('');
  const [chips, setChips] = useState({ gender: 'female', age: 'adult', pitch: 'medium', accent: 'American', tone: 'warm', pace: 'natural' });
  const [previews, setPreviews] = useState(null);
  const [prompted, setPrompted] = useState(null);
  const [name, setName] = useState('');
  const adv = useStore((s) => Boolean(s.info && s.info.advanced));
  const [engine, setEngine] = useState('cloud');
  const [an, setAn] = useState({ file: '', url: '' });
  const r = useRunner(M);
  const engines = useEngines();
  const designOk = !engines.data || canClone(engines.data);
  const fromChips = () => `A ${chips.age} ${chips.gender} voice with a ${chips.accent} accent, ${chips.pitch} pitch, ${chips.tone} tone and ${chips.pace} pace.`;
  const design = async () => { const o = await r.run('voice.design', { description: desc }, 'Design voice'); if (o) setPreviews(o.previews); };
  const designOffline = async (useChips) => { const o = await r.run('voice.designLocal', useChips ? { chips } : { description: desc }, 'Design voice offline'); if (o) setPreviews(o.previews.map((p) => Object.assign({ chips: o.chips }, p))); };
  const favs = useAsync(() => call('voice.descriptions'), []);
  const [ideaText, setIdeaText] = useState('');
  const prompt = async () => { const o = await r.run('voice.prompted', { description: desc, engine }, 'Design prompted voice'); if (o) { setPrompted(o); setName(o.name); } };
  const chip = (k, opts) => html`<${Field} label=${k[0].toUpperCase() + k.slice(1)}><div class="chips">${opts.map((o) => html`<button class=${'chip ' + (chips[k] === o ? 'on' : '')} onClick=${() => setChips(Object.assign({}, chips, { [k]: o }))}>${o}</button>`)}</div></${Field}>`;
  return html`<div class="page">
    <${PageHeader} title="Voice lab" sub="Design brand-new, original voices from a description." module=${M} help="voice.lab" />
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[['describe', 'Describe'], ['builder', 'Builder'], ['analyze', 'Analyze audio']]} />
    <div class="tts-grid">
      <section class="panel">
        ${tab === 'builder' ? html`<div>${chip('gender', ['female', 'male', 'neutral'])}${chip('age', ['young', 'adult', 'middle-aged', 'senior'])}${chip('pitch', ['low', 'medium', 'high'])}${chip('accent', data.ACCENTS)}${chip('tone', ['warm', 'bright', 'deep', 'raspy', 'soft', 'authoritative', 'playful'])}${chip('pace', ['slow', 'natural', 'fast'])}
          <div class="row gap wrap"><${Button} kind="primary" icon="sparkle" busy=${r.busy} onClick=${() => designOffline(true)}>Design offline (free)</${Button}><${Button} onClick=${() => { setDesc(fromChips()); setTab('describe'); }}>Use as description</${Button}></div>
          <p class="muted small">Offline design runs on this computer: it picks the closest of 54 voices, shapes pitch and tone, and saves the result as your own offline voice.</p></div>` : null}
        ${tab === 'analyze' ? html`<div><p class="muted">Upload a clip or paste a link; the first 30 seconds are described so you can design an original voice with similar qualities.</p>
          <div class="row gap"><${Button} icon="folder" onClick=${async () => { const x = await pickFiles({ filters: MEDIA_FILTERS }); if (x[0]) setAn({ file: x[0], url: '' }); }}>${an.file ? an.file.split(/[\\/]/).pop() : 'Choose file'}</${Button}><input class="input grow" placeholder="…or paste a link" value=${an.url} onInput=${(e) => setAn({ file: '', url: e.target.value })} /></div>
          <${Button} kind="primary" busy=${r.busy} disabled=${!an.file && !an.url} onClick=${async () => { const o = await r.run('voice.analyze', an, 'Analyze audio'); if (o) { setDesc(o.description); setTab('describe'); } }}>Analyze</${Button}></div>` : null}
        ${tab === 'describe' ? html`<div>
          <${Field} label=${`Voice description (${desc.length}/4000)`}><textarea class="input" rows="8" maxlength="4000" value=${desc} onInput=${(e) => setDesc(e.target.value)} placeholder="e.g. A calm, confident woman in her 40s with a soft Irish accent, like a late-night radio host. Slightly husky, unhurried." /></${Field}>
          <div class="row gap wrap ai-writer"><input class="input grow" placeholder="AI writer: a few words, e.g. wise old wizard narrator" value=${ideaText} onInput=${(e) => setIdeaText(e.target.value)} /><${Button} size="sm" busy=${r.busy} disabled=${!ideaText.trim()} onClick=${async () => { const o = await r.run('voice.describeWrite', { idea: ideaText }, 'AI writer'); if (o) { setDesc(o.description); setName(o.name); } }}>Write description</${Button}></div>
          ${(favs.data || []).length ? html`<div class="row gap wrap"><${Select} value="" onChange=${(id) => { const d = favs.data.find((x) => x.id === id); if (d) { setDesc(d.description); setName(d.name); } }} options=${[['', 'Saved descriptions…']].concat(favs.data.map((d) => [d.id, d.name]))} /></div>` : null}
          <div class="row gap wrap"><${Button} kind="primary" icon="sparkle" busy=${r.busy} disabled=${desc.length < 20 || !designOk} onClick=${design}>Design a new voice</${Button}>
          <${Button} busy=${r.busy} disabled=${desc.length < 10} onClick=${() => designOffline(false)}>Design offline (free)</${Button}>
          <${Button} size="sm" disabled=${desc.length < 10} onClick=${async () => { favs.set(await call('voice.descriptionSave', { name: name || 'Voice idea', description: desc })); toast('Description saved', 'ok'); }}>Save description</${Button}>
          <span class="muted small">or</span>${adv ? html`<${Select} value=${engine} onChange=${setEngine} options=${[['cloud', 'Built-in voices'], ['openai', 'OpenAI voices'], ['gemini', 'Gemini voices']]} />` : null}<${Button} busy=${r.busy} disabled=${desc.length < 10} onClick=${prompt}>Create prompted voice</${Button}></div>
          <p class="muted small">${designOk ? '“Design a new voice” creates a truly original voice for your account. ' : 'Designing brand-new voices is not on your plan yet. '}Prompted voices pick the closest built-in voice and save precise delivery directions with it.</p></div>` : null}
        <${Progress} runner=${r} />
      </section>
      <section class="panel">
        <h3>Results</h3>
        ${previews ? html`<div class="previews">${previews.map((p, i) => html`<div class="preview-row"><b>Option ${i + 1}${p.offline ? html` <${Badge}>offline</${Badge}>` : null}</b>${p.label ? html`<span class="muted small">${p.label}</span>` : null}<audio controls src=${mediaUrl(p.file)} />
          <${Button} size="sm" kind="primary" busy=${r.busy} onClick=${async () => { const n = name || `Designed voice ${i + 1}`; if (p.offline) { const o = await r.run('voice.saveLocalDesign', { name: n, description: desc, file: p.file, refText: p.refText, chips: p.chips }, 'Save offline voice', `${n} saved to your Voice Library`); return o; } try { await call('voice.saveDesigned', { name: n, description: desc, generatedVoiceId: p.generatedVoiceId, previewFile: p.file }); toast(`${n} saved to your Voice Library`, 'ok'); } catch (e) { toast(e.message, 'error'); } }}>Save</${Button}></div>`)}
          <${Field} label="Name for the saved voice"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /></${Field}></div>` : null}
        ${prompted ? html`<div class="result-card"><${Field} label="Name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /></${Field}>
          <p class="small"><b>Base voice:</b> ${engineName(prompted.engine)} / ${prompted.voice}</p><p class="small muted">${prompted.style}</p>
          <${VoiceTest} spec=${{ engine: prompted.engine, voice: prompted.voice, style: prompted.style }} />
          <${Button} kind="primary" onClick=${async () => { await call('voice.libraryAdd', { voice: { name: name || prompted.name, engine: prompted.engine, voice: prompted.voice, style: prompted.style, gender: prompted.gender, description: desc, source: 'design', tags: ['prompted'] } }); toast('Saved to your Voice Library', 'ok'); }}>Save to library</${Button}></div>` : null}
        ${!previews && !prompted ? html`<${Empty} icon="sparkle" title="Describe a voice to begin" />` : null}
      </section>
    </div>
  </div>`;
}

function VoiceTest({ spec }) {
  const [file, setFile] = useState('');
  const r = useRunner(M);
  return html`<div><${Button} size="sm" icon="play" busy=${r.busy} onClick=${async () => { const o = await r.run('voice.preview', spec, 'Voice preview'); if (o) setFile(o.file); }}>Hear it</${Button}>${file ? html`<audio controls autoplay src=${mediaUrl(file)} />` : null}</div>`;
}

// ------------------------------------------------------------------ Studio
export function Studio() {
  const list = useAsync(() => call('voice.studioList'), []);
  const [del, setDel] = useState(null);
  const create = async () => { const p = await call('voice.studioSave', { project: { title: 'Untitled production', speakers: [], lines: [] } }); go('voice.studioEdit', { id: p.id }); };
  return html`<div class="page">
    <${PageHeader} title="Studio" sub="Multi-speaker productions: podcasts, interviews, ads and stories with music and sound effects." module=${M} help="voice.studio"><${Button} kind="primary" icon="plus" onClick=${create}>New production</${Button}></${PageHeader}>
    ${list.data && list.data.length ? html`<div class="card-grid">${list.data.map((p) => html`<article class="obj-card"><button class="obj-main" onClick=${() => go('voice.studioEdit', { id: p.id })}><b>${p.title}</b><span class="muted small">${count(p.speakers, 'speaker')} — ${count(p.lines, 'line')} — ${ago(p.updated)}</span></button>
      <div class="row gap">${p.output ? html`<${Audio} file=${p.output} compact />` : null}<${IconButton} icon="trash" title="Delete" onClick=${() => setDel(p)} /></div></article>`)}</div>`
      : list.loading ? html`<${Spinner} />` : html`<${Empty} icon="studio" title="No productions yet" action=${html`<${Button} kind="primary" onClick=${create}>New production</${Button}>`}>Let AI write a script and cast the voices, import a document, or write your own lines.</${Empty}>`}
    ${del ? html`<${Confirm} title="Delete production?" text=${`"${del.title}" will be deleted. Rendered files in the Audio Library stay.`} onClose=${() => setDel(null)} onYes=${async () => list.set(await call('voice.studioDelete', { id: del.id }))} />` : null}
  </div>`;
}

export function StudioEditor({ id }) {
  const pj = useAsync(() => call('voice.studioGet', { id }), [id]);
  const [p, setP] = useState(null);
  const [write, setWrite] = useState(false);
  const [sfxFor, setSfxFor] = useState(null);
  const [playing, setPlaying] = useState('');
  const [lang, setLang] = useState('');
  const r = useRunner(M);
  const line = useRunner(M);
  const [clip, setClip] = useState(null); // cut/copied line
  const [lastFile, setLastFile] = useState({});
  useEffect(() => { if (pj.data) setP(pj.data); }, [pj.data]);
  useEffect(() => { if (!p) return undefined; const t = setTimeout(() => call('voice.studioSave', { project: p }).catch(() => {}), 800); return () => clearTimeout(t); }, [p]);
  if (!p) return html`<div class="page">${pj.error ? html`<${ErrorBox} error=${pj.error} />` : html`<${Spinner} />`}</div>`;
  const up = (patch) => setP(Object.assign({}, p, patch));
  const upLine = (lid, patch) => up({ lines: p.lines.map((l) => (l.id === lid ? Object.assign({}, l, patch) : l)) });
  const upSpk = (sid, patch) => up({ speakers: p.speakers.map((s) => (s.id === sid ? Object.assign({}, s, patch) : s)) });
  const addSpeaker = () => up({ speakers: p.speakers.concat([{ id: Math.random().toString(36).slice(2, 8), name: `Speaker ${p.speakers.length + 1}`, description: '', voice: null }]) });
  const addLine = (after) => {
    const nl = { id: Math.random().toString(36).slice(2, 8), speaker: (p.speakers[0] || {}).id, text: '', style: '' };
    const i = after ? p.lines.findIndex((l) => l.id === after) + 1 : p.lines.length;
    up({ lines: p.lines.slice(0, i).concat([nl], p.lines.slice(i)) });
  };
  const apply = (o) => o && up(o);
  const sfx = p.sfx || [];
  const moveLine = (lid, d) => { const i = p.lines.findIndex((l) => l.id === lid); const j = i + d; if (i < 0 || j < 0 || j >= p.lines.length) return; const a = p.lines.slice(); [a[i], a[j]] = [a[j], a[i]]; up({ lines: a }); };
  const cutLine = (l) => { setClip(Object.assign({}, l)); up({ lines: p.lines.filter((x) => x.id !== l.id) }); toast('Line cut — use Paste below another line', 'ok', 2500); };
  const pasteAfter = (lid) => { if (!clip) return; const i = p.lines.findIndex((l) => l.id === lid) + 1; up({ lines: p.lines.slice(0, i).concat([Object.assign({}, clip, { id: Math.random().toString(36).slice(2, 8) })], p.lines.slice(i)) }); setClip(null); };
  const renderOne = async (l, i) => { const o = await line.run('voice.studioRenderLine', { project: p, lineId: l.id }, `Line ${i + 1}`); if (o) { setLastFile(Object.assign({}, lastFile, { [l.id]: o.file })); setPlaying(o.file + '?' + Date.now()); } return o; };
  const downloadLine = async (l, i) => {
    const f = lastFile[l.id] || (await renderOne(l, i) || {}).file;
    if (!f) return;
    const ext = (f.split('.').pop() || 'wav').toLowerCase();
    const dest = await saveFile({ defaultPath: `${p.title} - line ${i + 1}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (dest) { await call('file.copy', { from: f, to: dest }); showInFolder(dest); }
  };
  return html`<div class="page">
    <div class="ws-head"><button class="link-btn" onClick=${() => go('voice.studio')}>← Studio</button><input class="input title-input" value=${p.title} onInput=${(e) => up({ title: e.target.value })} /></div>
    <div class="row gap wrap toolbar">
      <${Button} icon="sparkle" onClick=${() => setWrite(true)}>AI write & cast</${Button}>
      <${Button} icon="upload" busy=${r.busy} onClick=${async () => { const f = await pickFiles({ filters: DOC_FILTERS }); if (f[0]) apply(await r.run('voice.studioImport', { file: f[0] }, 'Import document')); }}>Import document</${Button}>
      <${Button} icon="users" busy=${r.busy} disabled=${!p.speakers.length} onClick=${async () => apply(await r.run('voice.studioCast', { project: p }, 'Auto-cast voices'))}>Auto-cast</${Button}>
      <${Button} icon="wand" busy=${r.busy} disabled=${!p.lines.length} onClick=${async () => apply(await r.run('voice.studioStyleAll', { project: p }, 'Direct all lines'))}>Direct every line</${Button}>
      <${LangSelect} value=${lang} onChange=${setLang} list=${NLLB} placeholder="Translate all lines to…" /><${Button} disabled=${!lang} busy=${r.busy} title="Translates every line and recasts voices that can speak the new language" onClick=${async () => apply(await r.run('voice.studioTranslate', { project: p, lang, recast: true }, 'Translate production'))}>Translate & recast</${Button}>
    </div>
    <${Progress} runner=${r} />
    <div class="studio">
      <aside class="panel">
        <div class="row between"><h3>Cast</h3><${Button} size="sm" icon="plus" onClick=${addSpeaker}>Speaker</${Button}></div>
        ${p.speakers.map((s) => html`<div class="speaker">
          <div class="row gap"><input class="input" value=${s.name} onInput=${(e) => upSpk(s.id, { name: e.target.value })} /><${IconButton} icon="trash" title="Remove speaker" onClick=${() => up({ speakers: p.speakers.filter((x) => x.id !== s.id) })} /></div>
          ${s.description ? html`<p class="muted small">${s.description}</p>` : null}
          <${VoicePicker} value=${s.voice} onChange=${(v) => upSpk(s.id, { voice: v })} compact />
        </div>`)}
        <h3>Music</h3>
        <${BedPicker} value=${p.music} onChange=${(m) => up({ music: m })} />
        <${Field} label="Pause between lines"><${Range} label="" value=${p.gapMs || 300} min=${0} max=${1500} step=${50} onChange=${(x) => up({ gapMs: x })} fmt=${(x) => x + ' ms'} /></${Field}>
      </aside>
      <section class="lines">
        ${p.lines.map((l, i) => {
          const fx = sfx.filter((x) => x.lineId === l.id);
          return html`<div class="line">
            <span class="line-n">${i + 1}</span>
            <div class="line-body">
              <div class="row gap"><${Select} value=${l.speaker} onChange=${(x) => upLine(l.id, { speaker: x })} options=${p.speakers.map((s) => [s.id, s.name])} cls="speaker-select" />
                <input class="input style-input" value=${l.style} onInput=${(e) => upLine(l.id, { style: e.target.value })} placeholder="Direction (e.g. excited, whispering)" /></div>
              <textarea class="input" rows=${Math.min(6, Math.max(2, Math.ceil(l.text.length / 90)))} value=${l.text} onInput=${(e) => upLine(l.id, { text: e.target.value })} />
              ${fx.length ? html`<div class="chips">${fx.map((x) => html`<button class="chip on" onClick=${() => up({ sfx: sfx.filter((y) => y !== x) })}>♪ ${x.label} ✕</button>`)}</div>` : null}
            </div>
            <div class="line-actions">
              <${IconButton} icon="play" title="Generate (regenerate) and play this line" onClick=${() => renderOne(l, i)} />
              <${IconButton} icon="wand" title="Restyle: AI writes a new direction for this line" onClick=${async () => { const o = await line.run('voice.studioRestyle', { project: p, lineId: l.id }, `Restyle line ${i + 1}`); if (o) upLine(l.id, { style: o.style }); }} />
              <${IconButton} icon="download" title="Download this line" onClick=${() => downloadLine(l, i)} />
              <${IconButton} icon="chevron" cls="rot-90" title="Move up" onClick=${() => moveLine(l.id, -1)} />
              <${IconButton} icon="chevron" cls="rot90" title="Move down" onClick=${() => moveLine(l.id, 1)} />
              <${IconButton} icon="scissors" title="Cut line (paste it elsewhere)" onClick=${() => cutLine(l)} />
              ${clip ? html`<${IconButton} icon="copy" title="Paste the cut line below" onClick=${() => pasteAfter(l.id)} />` : null}
              <${IconButton} icon="music" title="Add a sound effect here" onClick=${() => setSfxFor(l.id)} />
              <${IconButton} icon="plus" title="Insert line below" onClick=${() => addLine(l.id)} />
              <${IconButton} icon="trash" title="Delete line" onClick=${() => up({ lines: p.lines.filter((x) => x.id !== l.id) })} />
            </div>
          </div>`;
        })}
        <${Button} icon="plus" onClick=${() => addLine()} disabled=${!p.speakers.length}>${p.speakers.length ? 'Add line' : 'Add a speaker first'}</${Button}>
        ${playing ? html`<audio class="floating-audio" src=${mediaUrl(playing.split('?')[0])} autoplay controls />` : null}
        <${Progress} runner=${line} />
        <div class="render-bar panel">
          <span class="muted small">${count(p.lines.length, 'line')} — about ${clock(p.lines.reduce((a, l) => a + l.text.split(/\s+/).length, 0) / 2.5)}</span>
          <${Button} kind="primary" icon="wave" busy=${r.busy} disabled=${!p.lines.length} onClick=${async () => { const o = await r.run('voice.studioRender', { project: p }, `Render: ${p.title}`, 'Production rendered and saved'); if (o) setP(o.project); }}>Render production</${Button}>
          ${p.output ? html`<${Audio} file=${p.output} title="Latest render" />` : null}
        </div>
      </section>
    </div>
    ${write ? html`<${StudioWrite} onClose=${() => setWrite(false)} onDone=${async (o) => { setWrite(false); const next = Object.assign({}, p, o); setP(next); const c = await r.run('voice.studioCast', { project: next }, 'Auto-cast voices'); if (c) setP(Object.assign({}, next, c)); }} />` : null}
    ${sfxFor ? html`<${SfxModal} onClose=${() => setSfxFor(null)} onPick=${(x) => { up({ sfx: sfx.concat([Object.assign({ lineId: sfxFor, volume: 0.8 }, x)]) }); setSfxFor(null); }} />` : null}
  </div>`;
}

function StudioWrite({ onClose, onDone }) {
  const [f, setF] = useState({ prompt: '', format: 'podcast', speakers: 2, minutes: 2, lang: '', names: '' });
  const r = useRunner(M);
  return html`<${Modal} title="AI write & cast" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" busy=${r.busy} disabled=${!f.prompt.trim()} onClick=${async () => { const o = await r.run('voice.studioWrite', f, 'Write production'); if (o) onDone(o); }}>Write script</${Button}>`}>
    <${Field} label="Brief"><textarea class="input" rows="4" value=${f.prompt} onInput=${(e) => setF(Object.assign({}, f, { prompt: e.target.value }))} placeholder="e.g. Two hosts debate whether AI will replace copywriters; one optimist, one sceptic; end with practical tips." /></${Field}>
    <div class="grid2">
      <${Field} label="Format"><${Select} value=${f.format} onChange=${(x) => setF(Object.assign({}, f, { format: x }))} options=${data.STUDIO_FORMATS} /></${Field}>
      <${Field} label="Speakers"><${Select} value=${String(f.speakers)} onChange=${(x) => setF(Object.assign({}, f, { speakers: Number(x) }))} options=${[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']]} /></${Field}>
      <${Range} label="Length" value=${f.minutes} min=${0.5} max=${20} step=${0.5} onChange=${(x) => setF(Object.assign({}, f, { minutes: x }))} fmt=${(x) => x + ' min'} />
      <${Field} label="Speaker names (optional)"><input class="input" value=${f.names} onInput=${(e) => setF(Object.assign({}, f, { names: e.target.value }))} placeholder="Ava, Marcus" /></${Field}>
    </div>
    <${Field} label="Language"><${LangSelect} value=${f.lang} onChange=${(x) => setF(Object.assign({}, f, { lang: x }))} list=${NLLB} placeholder="Same as the brief" /></${Field}>
    <${Progress} runner=${r} />
  </${Modal}>`;
}

function SfxModal({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const r = useRunner(M);
  const search = async () => { setBusy(true); try { setRes(await call('voice.sfx', { q })); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  return html`<${Modal} title="Add a sound effect" onClose=${onClose}>
    <div class="row gap"><input class="input grow" placeholder="door creak, applause, whoosh…" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && search()} />
      <${Button} icon="search" busy=${busy} onClick=${search}>Search library</${Button}>
      <${Button} icon="sparkle" busy=${r.busy} disabled=${!q} onClick=${async () => { const o = await r.run('voice.sfxGenerate', { prompt: q, seconds: 3 }, 'Generate sound effect'); if (o) onPick({ file: o.file, label: q }); }}>Generate with AI</${Button}>
      <${Button} icon="folder" onClick=${async () => { const f = await pickFiles({ filters: AUDIO_FILTERS }); if (f[0]) onPick({ file: f[0], label: f[0].split(/[\\/]/).pop() }); }}>My file</${Button}></div>
    <${Progress} runner=${r} />
    ${res ? html`<div class="track-list">${res.map((t) => html`<div class="track"><button class="track-pick" onClick=${() => onPick({ item: t, label: t.title })}><b>${t.title}</b><span>${t.artist} — ${t.duration.toFixed(1)} s</span></button><audio controls preload="none" src=${t.preview} /></div>`)}</div>` : null}
  </${Modal}>`;
}

// ------------------------------------------------------------------ Audiobooks
export function Audiobooks() {
  const list = useAsync(() => call('voice.bookList'), []);
  const r = useRunner(M);
  const [del, setDel] = useState(null);
  const imp = async (file) => { const b = await r.run('voice.bookImport', { file }, 'Import manuscript'); if (b) go('voice.bookEdit', { id: b.id }); };
  return html`<div class="page">
    <${PageHeader} title="Audiobooks" sub="Import a manuscript; render it with one narrator or a full cast, chapter by chapter." module=${M} help="voice.audiobooks" />
    <${Dropzone} label="Drop a manuscript" sub=".txt, .md, .docx, .pdf, .srt, .vtt, .lrc, .sbv — or click to browse" icon="book" accept=${/\.(txt|md|docx|pdf|srt|vtt|lrc|sbv)$/i} onFiles=${(f) => imp(f[0])} onPick=${async () => { const f = await pickFiles({ filters: [{ name: 'Manuscripts', extensions: ['txt', 'md', 'docx', 'pdf', 'srt', 'vtt', 'lrc', 'sbv'] }] }); if (f[0]) imp(f[0]); }} />
    <${Progress} runner=${r} />
    ${list.data && list.data.length ? html`<div class="card-grid">${list.data.map((b) => html`<article class="obj-card"><button class="obj-main" onClick=${() => go('voice.bookEdit', { id: b.id })}><b>${b.title}</b><span class="muted small">${count(b.chapters, 'chapter')} — ${b.mode === 'cast' ? 'full cast' : 'single narrator'} — ${ago(b.updated)}</span></button>
      <div class="row gap">${b.output ? html`<${Button} size="sm" onClick=${() => showInFolder(b.output)}>Show book</${Button}>` : null}<${IconButton} icon="trash" title="Delete" onClick=${() => setDel(b)} /></div></article>`)}</div>` : null}
    ${del ? html`<${Confirm} title="Delete audiobook?" text=${`"${del.title}" and its rendered chapters will be deleted.`} onClose=${() => setDel(null)} onYes=${async () => list.set(await call('voice.bookDelete', { id: del.id }))} />` : null}
  </div>`;
}

export function BookEditor({ id }) {
  const bk = useAsync(() => call('voice.bookGet', { id }), [id]);
  const [b, setB] = useState(null);
  const [open, setOpen] = useState('');
  const [fmt, setFmt] = useState('m4b');
  const r = useRunner(M);
  const seg = useRunner(M);
  const [playing, setPlaying] = useState('');
  useEffect(() => { if (bk.data) { setB(bk.data); if (!open && bk.data.chapters[0]) setOpen(bk.data.chapters[0].id); } }, [bk.data]);
  useEffect(() => { if (!b) return undefined; const t = setTimeout(() => call('voice.bookSave', { book: b }).catch(() => {}), 800); return () => clearTimeout(t); }, [b]);
  if (!b) return html`<div class="page">${bk.error ? html`<${ErrorBox} error=${bk.error} />` : html`<${Spinner} />`}</div>`;
  const up = (patch) => setB(Object.assign({}, b, patch));
  const ch = b.chapters.find((c) => c.id === open);
  const segs = ch ? (b.mode === 'cast' && ch.segments && ch.segments.length ? ch.segments : ch.text.split(/\n{2,}/).map((t, i) => ({ id: 'n' + i, speaker: 'narrator', text: t.replace(/\s+/g, ' ').trim() })).filter((s) => s.text)) : [];
  const who = (sid) => (sid === 'narrator' ? 'Narrator' : ((b.characters || []).find((c) => c.id === sid) || { name: 'Narrator' }).name);
  const refresh = (nb) => nb && setB(nb);
  return html`<div class="page">
    <div class="ws-head"><button class="link-btn" onClick=${() => go('voice.books')}>← Audiobooks</button><input class="input title-input" value=${b.title} onInput=${(e) => up({ title: e.target.value })} /><input class="input" value=${b.author || ''} placeholder="Author" onInput=${(e) => up({ author: e.target.value })} /></div>
    <div class="book">
      <aside class="panel">
        <${Field} label="Mode"><${Segmented} value=${b.mode} onChange=${(m) => up({ mode: m })} options=${[['single', 'Single narrator'], ['cast', 'Full cast']]} /></${Field}>
        <h3>Narrator</h3>
        <${VoicePicker} value=${b.narrator} onChange=${(v) => up({ narrator: v })} compact />
        ${b.mode === 'cast' ? html`<div class="row between"><h3>Characters</h3><${Button} size="sm" icon="users" busy=${r.busy} onClick=${async () => refresh(await r.run('voice.bookAnalyze', { id: b.id }, 'Find characters'))}>Find characters</${Button}></div>
          ${(b.characters || []).map((c) => html`<div class="speaker"><b>${c.name}</b>${c.description ? html`<p class="muted small">${c.description}</p>` : null}<${VoicePicker} value=${c.voice} onChange=${(v) => up({ characters: b.characters.map((x) => (x.id === c.id ? Object.assign({}, x, { voice: v }) : x)) })} compact /></div>`)}
          ${!(b.characters || []).length ? html`<p class="muted small">Click "Find characters" — AI splits narration from dialogue and lists every speaking character.</p>` : null}` : null}
        <h3>Chapters</h3>
        <div class="history">${b.chapters.map((c, i) => html`<button class=${'hist ' + (c.id === open ? 'on' : '')} onClick=${() => setOpen(c.id)}><b>${i + 1}. ${c.title}</b><span>${c.status === 'rendered' ? 'Rendered' : c.status === 'cast' ? 'Cast' : 'Draft'} — ${c.text.split(/\s+/).length.toLocaleString()} words</span></button>`)}</div>
        <div class="render-bar">
          <${Field} label="Format"><${Select} value=${fmt} onChange=${setFmt} options=${[['m4b', 'M4B audiobook (chapters)'], ['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV']]} /></${Field}>
          <${Button} kind="primary" icon="book" busy=${r.busy} disabled=${!b.narrator} onClick=${async () => refresh(await r.run('voice.bookRender', { id: b.id, format: fmt }, `Render audiobook: ${b.title}`, 'Audiobook rendered'))}>Render whole book</${Button}>
          ${b.output ? html`<${Button} size="sm" onClick=${() => showInFolder(b.output)}>Show book file</${Button}>` : null}
        </div>
      </aside>
      <section class="chapter">
        <${Progress} runner=${r} />
        ${ch ? html`<div class="row between"><input class="input title-input" value=${ch.title} onInput=${(e) => up({ chapters: b.chapters.map((x) => (x.id === ch.id ? Object.assign({}, x, { title: e.target.value }) : x)) })} />
          <${Button} icon="play" busy=${r.busy} disabled=${!b.narrator} onClick=${async () => refresh(await r.run('voice.bookRender', { id: b.id, chapterIds: [ch.id], format: fmt === 'm4b' ? 'mp3' : fmt, combine: false }, `Render chapter: ${ch.title}`, 'Chapter rendered'))}>Render chapter</${Button}></div>
          ${ch.output ? html`<${Audio} file=${ch.output} title="Chapter audio" />` : null}
          ${b.mode === 'cast' && !(ch.segments && ch.segments.length) ? html`<p class="muted">This chapter hasn't been cast yet. <button class="link-btn" onClick=${async () => refresh(await r.run('voice.bookAnalyze', { id: b.id, chapterIds: [ch.id] }, 'Find characters'))}>Cast this chapter</button></p>` : null}
          <div class="segments">${segs.map((s) => html`<div class=${'segment ' + (s.speaker === 'narrator' ? '' : 'dialogue')}>
            <span class="seg-who">${who(s.speaker)}</span>
            <p contenteditable="true" onBlur=${async (e) => { const t = e.target.innerText.trim(); if (t !== s.text) { const o = await seg.run('voice.bookRenderSegment', { id: b.id, chapterId: ch.id, segId: s.id, text: t }, 'Re-render line'); if (o) { setB(o.book); setPlaying(o.file); } } }}>${s.text}</p>
            <${IconButton} icon="refresh" title="Re-render this line" onClick=${async () => { const o = await seg.run('voice.bookRenderSegment', { id: b.id, chapterId: ch.id, segId: s.id }, 'Render line'); if (o) { setB(o.book); setPlaying(o.file); } }} />
          </div>`)}</div>
          ${playing ? html`<audio class="floating-audio" src=${mediaUrl(playing)} autoplay controls />` : null}
          <${Progress} runner=${seg} />` : null}
      </section>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Libraries
export function VoiceLibrary() {
  const lib = useAsync(() => call('voice.library'), []);
  const [browse, setBrowse] = useState(null);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const shown = (lib.data || []).filter((v) => !q || (v.name + v.description + (v.tags || []).join(' ')).toLowerCase().includes(q.toLowerCase()));
  return html`<div class="page">
    <${PageHeader} title="Voice library" sub="Your cloned and designed voices, plus every built-in voice to audition." module=${M} help="voice.library"><${Button} icon="search" onClick=${() => setBrowse({ engine: 'cloud', voice: 'marin', speed: 1 })}>Browse built-in voices</${Button}></${PageHeader}>
    <input class="input search" placeholder="Search your voices" value=${q} onInput=${(e) => setQ(e.target.value)} />
    ${shown.length ? html`<div class="card-grid">${shown.map((v) => html`<article class="obj-card voice-card">
      <div class="obj-main"><b>${v.name}</b><span class="muted small">${engineName(v.engine)}${v.gender ? ' — ' + v.gender : ''} — ${v.source === 'clone' ? 'cloned' : v.source === 'design' ? 'designed' : 'saved'}</span>${v.description ? html`<p class="small">${v.description.slice(0, 160)}</p>` : null}
        <div class="chips">${(v.tags || []).map((t) => html`<span class="chip">${t}</span>`)}</div></div>
      ${v.sample ? html`<${Audio} file=${v.sample} compact />` : html`<${VoiceTest} spec=${{ engine: v.engine, voice: v.voice, style: v.style }} />`}
      <div class="row gap"><${Button} size="sm" onClick=${() => setEdit(v)}>Edit</${Button}><${Button} size="sm" kind="danger" onClick=${async () => lib.set(await call('voice.libraryRemove', { id: v.id }))}>Delete</${Button}></div>
    </article>`)}</div>` : html`<${Empty} icon="users" title="No saved voices yet">Clone a voice or design one in Voice lab — they appear here and in every voice menu marked with ★.</${Empty}>`}
    ${browse ? html`<${Modal} title="Built-in voices" onClose=${() => setBrowse(null)} footer=${html`<${Button} onClick=${() => setBrowse(null)}>Close</${Button}><${Button} kind="primary" onClick=${async () => { await call('voice.libraryAdd', { voice: { name: browse.name || browse.voice, engine: browse.engine, voice: browse.voice, style: browse.style, speed: browse.speed, source: 'saved', tags: ['favourite'] } }); toast('Saved to your library', 'ok'); lib.reload(); }}>Save as favourite</${Button}>`}><${VoicePicker} value=${browse} onChange=${setBrowse} /></${Modal}>` : null}
    ${edit ? html`<${VoiceEdit} v=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); lib.reload(); }} />` : null}
  </div>`;
}

function VoiceEdit({ v, onClose, onSaved }) {
  const [f, setF] = useState({ name: v.name, description: v.description || '', tags: (v.tags || []).join(', '), style: v.style || '' });
  return html`<${Modal} title="Edit voice" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" onClick=${async () => { await call('voice.libraryUpdate', { id: v.id, patch: { name: f.name, description: f.description, style: f.style, tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean) } }); onSaved(); }}>Save</${Button}>`}>
    <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => setF(Object.assign({}, f, { name: e.target.value }))} /></${Field}>
    <${Field} label="Description"><input class="input" value=${f.description} onInput=${(e) => setF(Object.assign({}, f, { description: e.target.value }))} /></${Field}>
    <${Field} label="Tags (comma separated)"><input class="input" value=${f.tags} onInput=${(e) => setF(Object.assign({}, f, { tags: e.target.value }))} /></${Field}>
    ${['cloud', 'openai', 'gemini', 'custom'].includes(v.engine) ? html`<${Field} label="Delivery direction"><textarea class="input" rows="3" value=${f.style} onInput=${(e) => setF(Object.assign({}, f, { style: e.target.value }))} /></${Field}>` : null}
  </${Modal}>`;
}

export function AudioLibrary() {
  const lib = useAsync(() => call('voice.audio'), []);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('new');
  const [edit, setEdit] = useState(null);
  const [wave, setWave] = useState(null);
  const [showTx, setShowTx] = useState(null);
  const r = useRunner(M);
  let shown = (lib.data || []).filter((a) => !q || (a.title + ' ' + (a.tags || []).join(' ') + ' ' + (a.text || '') + ' ' + (a.engine || '')).toLowerCase().includes(q.toLowerCase()));
  shown = shown.slice().sort((a, b) => (sort === 'new' ? b.created - a.created : sort === 'long' ? b.duration - a.duration : a.title.localeCompare(b.title)));
  const exp = async (a, fmt) => { const f = await saveFile({ defaultPath: `${a.title}.${fmt}`, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] }); if (f) { const o = await r.run('voice.audioExport', { id: a.id, format: fmt, file: f }, 'Export audio', 'Exported'); if (o) showInFolder(f); } };
  return html`<div class="page">
    <${PageHeader} title="Audio library" sub="Every render, searchable and taggable. Export to WAV, MP3, FLAC, OGG or M4A." module=${M} help="voice.library">
      <${Button} icon="upload" onClick=${async () => { const f = await pickFiles({ multi: true, filters: AUDIO_FILTERS }); if (f.length) lib.set(await call('voice.audioImport', { files: f })); }}>Import audio</${Button}></${PageHeader}>
    <div class="row gap"><input class="input grow" placeholder="Search titles, tags, script text…" value=${q} onInput=${(e) => setQ(e.target.value)} /><${Select} value=${sort} onChange=${setSort} options=${[['new', 'Newest'], ['long', 'Longest'], ['az', 'A–Z']]} /></div>
    <${Progress} runner=${r} />
    ${shown.length ? html`<div class="audio-list">${shown.map((a) => html`<div class="audio-row">
      <div class="audio-main"><b>${a.title}</b><span class="muted small">${clock(a.duration)} — ${a.format.toUpperCase()} — ${engineName(a.engine) || a.source} — ${ago(a.created)}</span>
        <div class="chips">${(a.tags || []).map((t) => html`<span class="chip">${t}</span>`)}</div></div>
      <audio controls preload="none" src=${mediaUrl(a.file)} />
      <div class="row gap"><${Select} value="" onChange=${(f) => f && exp(a, f)} options=${[['', 'Export…'], ['mp3', 'MP3'], ['wav', 'WAV'], ['flac', 'FLAC'], ['ogg', 'OGG'], ['m4a', 'M4A']]} />
        <${IconButton} icon="pen" title="Rename / tag" onClick=${() => setEdit(a)} /><${IconButton} icon="scissors" title="Edit waveform (trim / cut)" onClick=${() => setWave(a)} /><${IconButton} icon="text" title=${a.transcript ? 'Show transcript' : 'Transcribe'} onClick=${async () => { if (a.transcript) setShowTx(a); else { const o = await r.run('voice.audioTranscribe', { id: a.id }, 'Transcribe audio', 'Transcript saved'); if (o) { lib.reload(); setShowTx(o); } } }} /><${IconButton} icon="folder" title="Show file" onClick=${() => showInFolder(a.file)} /><${IconButton} icon="trash" title="Delete" onClick=${async () => lib.set(await call('voice.audioRemove', { id: a.id }))} /></div>
    </div>`)}</div>` : html`<${Empty} icon="music" title=${q ? 'Nothing matches' : 'No audio yet'}>Everything you generate in Quick TTS, Studio and Audiobooks is saved here automatically.</${Empty}>`}
    ${edit ? html`<${AudioEdit} a=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); lib.reload(); }} />` : null}
    ${wave ? html`<${Modal} wide title=${'Edit — ' + wave.title} onClose=${() => { setWave(null); lib.reload(); }}><${WaveEditor} item=${wave} onChange=${(o) => { setWave(o); lib.reload(); }} /></${Modal}>` : null}
    ${showTx ? html`<${Modal} title=${'Transcript — ' + showTx.title} onClose=${() => setShowTx(null)} footer=${html`<${Copyable} text=${showTx.transcript || ''} label="Copy transcript" /><${Button} onClick=${() => setShowTx(null)}>Close</${Button}>`}><p class="pre-wrap">${showTx.transcript}</p></${Modal}>` : null}
  </div>`;
}

function AudioEdit({ a, onClose, onSaved }) {
  const [f, setF] = useState({ title: a.title, tags: (a.tags || []).join(', ') });
  return html`<${Modal} title="Rename and tag" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" onClick=${async () => { await call('voice.audioUpdate', { id: a.id, patch: { title: f.title, tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean) } }); onSaved(); }}>Save</${Button}>`}>
    <${Field} label="Title"><input class="input" value=${f.title} onInput=${(e) => setF(Object.assign({}, f, { title: e.target.value }))} /></${Field}>
    <${Field} label="Tags (comma separated)"><input class="input" value=${f.tags} onInput=${(e) => setF(Object.assign({}, f, { tags: e.target.value }))} /></${Field}>
  </${Modal}>`;
}
