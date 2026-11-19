import { html, useState, useEffect, call, toast, useRunner, openUrl, pickFiles, saveFile, showInFolder, openPath, bytes, useStore, setState, state, refreshAi } from '../lib.js';
import { PageHeader, Tabs, Field, Select, Toggle, Button, Range, Spinner, ErrorBox, Badge, Modal, Progress, useAsync, LangSelect } from '../ui.js';
import data from '../../shared/data.js';

const KEYS = [
  ['openai', 'OpenAI', 'Text, vision, images, voices (TTS) and cloud transcription', 'https://platform.openai.com/api-keys'],
  ['anthropic', 'Anthropic Claude', 'Text and vision', 'https://console.anthropic.com/settings/keys'],
  ['gemini', 'Google Gemini', 'Text, vision, "Watch with Gemini", images and 30 voices', 'https://aistudio.google.com/apikey'],
  ['openrouter', 'OpenRouter', 'Hundreds of models with one key, plus images', 'https://openrouter.ai/keys'],
  ['xai', 'xAI Grok', 'Text and vision', 'https://console.x.ai/'],
  ['mistral', 'Mistral', 'Text and vision', 'https://console.mistral.ai/api-keys'],
  ['deepseek', 'DeepSeek', 'Low-cost text', 'https://platform.deepseek.com/api_keys'],
  ['perplexity', 'Perplexity', 'Text with web knowledge', 'https://www.perplexity.ai/settings/api'],
  ['groq', 'Groq', 'Very fast text and cloud Whisper transcription', 'https://console.groq.com/keys'],
  ['elevenlabs', 'ElevenLabs', 'Premium voices, voice cloning, voice design, AI sound effects', 'https://elevenlabs.io/app/settings/api-keys'],
  ['gladia', 'Gladia', 'Cloud speech-to-text', 'https://app.gladia.io/'],
  ['fal', 'fal.ai', 'Fast image generation (Flux)', 'https://fal.ai/dashboard/keys'],
  ['jamendo', 'Jamendo (client ID)', 'Free Creative Commons background music', 'https://devportal.jamendo.com/'],
  ['freesound', 'Freesound', '700,000+ free sound effects', 'https://freesound.org/apiv2/apply'],
  ['custom', 'Custom server key', 'For your own OpenAI-compatible server (optional)', ''],
];

const ADV_TABS = ['models', 'images'];
const BASE_TABS = [['builtin', 'Built-in AI'], ['models', 'AI engine'], ['local', 'Offline engines'], ['transcription', 'Transcription'], ['voices', 'Voices & translation'], ['images', 'Images'], ['vision', 'Video analysis'], ['wordpress', 'WordPress'], ['folders', 'Folders & backup'], ['network', 'Network & tools']];

export function Settings({ tab: initial }) {
  const info = useStore((s) => s.info);
  const adv = Boolean(info && info.advanced);
  // The built-in AI is set up by your vendor (its models are fixed on the server), so customers see no model or provider choices.
  const tabs = adv ? BASE_TABS.slice(0, 1).concat([['keys', 'Own API keys']], BASE_TABS.slice(1)) : BASE_TABS.filter((t) => !ADV_TABS.includes(t[0]));
  const [tab, setTab] = useState(initial === 'ai' ? (adv ? 'keys' : 'builtin') : (initial || 'builtin'));
  const st = useAsync(() => call('settings.get'), []);
  const save = async (patch, msg = 'Saved') => {
    const r = await call('settings.set', { patch });
    st.set(Object.assign({}, st.data, { settings: r.settings }));
    if ('privateMode' in patch) setState({ info: Object.assign({}, state.info, { privateMode: Boolean(r.settings.privateMode) }) });
    toast(msg, 'ok', 1500);
  };
  // Vendor-only switch for "use your own API key" engines: Ctrl+Shift+K on this page.
  useEffect(() => {
    const onKey = async (e) => {
      if (!(e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k'))) return;
      e.preventDefault();
      const r = await call('settings.advanced', { on: !adv });
      setState({ info: Object.assign({}, state.info, { advanced: r.advanced }) });
      toast(r.advanced ? 'Advanced mode on: own-key engines are visible.' : 'Advanced mode off.', 'ok', 3000);
      if (!r.advanced && tab === 'keys') setTab('builtin');
      st.reload();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adv, tab]);
  const view = tabs.some((t) => t[0] === tab) ? tab : 'builtin';
  return html`<div class="page">
    <${PageHeader} title="Settings" sub="AI, engines and folders. Your files and projects stay on this computer." help="settings.ai" />
    <${Tabs} value=${view} onChange=${setTab} tabs=${tabs} />
    ${st.loading && !st.data ? html`<${Spinner} />` : st.error ? html`<${ErrorBox} error=${st.error} retry=${st.reload} />` : html`<div class="settings-body">
      ${view === 'builtin' ? html`<${BuiltIn} s=${st.data.settings} save=${save} />` : null}
      ${view === 'keys' ? html`<${Keys} st=${st} />` : null}
      ${view === 'models' ? html`<${Models} s=${st.data.settings} save=${save} keys=${st.data.keys} adv=${adv} />` : null}
      ${view === 'local' ? html`<${LocalEngines} s=${st.data.settings} save=${save} adv=${adv} />` : null}
      ${view === 'transcription' ? html`<${Transcription} s=${st.data.settings} save=${save} adv=${adv} />` : null}
      ${view === 'voices' ? html`<${VoiceSettings} s=${st.data.settings} save=${save} adv=${adv} />` : null}
      ${view === 'images' ? html`<${ImageSettings} s=${st.data.settings} save=${save} adv=${adv} />` : null}
      ${view === 'vision' ? html`<${VisionSettings} s=${st.data.settings} save=${save} />` : null}
      ${view === 'wordpress' ? html`<${WordPress} />` : null}
      ${view === 'folders' ? html`<${Folders} s=${st.data.settings} save=${save} />` : null}
      ${view === 'network' ? html`<${Network} s=${st.data.settings} save=${save} />` : null}
    </div>`}
  </div>`;
}

const FEATURES = [
  ['text', 'Writing and analysis', 'Reports, documents, posts, scripts, chat and prompts'],
  ['vision', 'Seeing video frames', 'Frame-by-frame video analysis'],
  ['transcribe', 'Transcription', 'Fast cloud transcription in 99 languages'],
  ['tts', 'Natural voices', (c) => (c.voice_engine === 'kokoro' ? '54 natural voices in 8 languages' : '13 lifelike voices with style direction')],
  ['voices', 'Voice cloning and design', (c) => (Array.isArray(c.clone_languages) ? 'Your own private voices (cloned voices speak English and Chinese)' : 'Your own private voices')],
  ['images', 'Images', 'Thumbnails, quote cards and infographics'],
  ['sfx', 'AI sound effects', 'Describe a sound and get it'],
  ['music_library', 'Music library', 'Free Creative Commons background music'],
  ['sound_library', 'Sound effect library', 'Free sound effects to search'],
];

function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : ''; }

function PrivateMode({ s, save }) {
  return html`<section class="panel span2 private-mode">
    <${Toggle} checked=${Boolean(s.privateMode)} onChange=${(on) => save({ privateMode: on }, on ? 'Private mode is on — AI work stays on this computer' : 'Private mode is off')} label="Private mode" hint="Keep your videos, audio and text on this computer. Writing uses your local AI model, transcription uses offline Whisper, voices use offline Kokoro and translation uses offline NLLB. Uses no credits. Online-only tools (AI images, cloud voices, sound library) are paused." />
  </section>`;
}

/** Built-in AI: no keys needed; credits come with the plan and reset monthly. */
function BuiltIn({ s, save }) {
  const ai = useStore((x) => x.ai);
  const [busy, setBusy] = useState(false);
  useEffect(() => { refreshAi(true); }, []);
  const reload = async () => { setBusy(true); try { await refreshAi(true); } finally { setBusy(false); } };
  if (!ai) return html`<${Spinner} label="Checking your AI plan…" />`;
  if (!ai.enabled) {
    return html`<div class="form-grid"><${PrivateMode} s=${s} save=${save} /><section class="panel span2 ai-off">
      <h3>Built-in AI is not available right now</h3>
      <p class="muted">${(ai.usage && ai.usage.error) || 'It is not switched on for your account yet, or this computer is offline.'} The free offline engines keep working: Whisper transcription, Kokoro and Piper voices, NLLB translation and local AI models.</p>
      <div class="row gap"><${Button} icon="refresh" busy=${busy} onClick=${reload}>Check again</${Button}></div>
    </section></div>`;
  }
  const u = ai.usage || {};
  const caps = ai.caps || {};
  const capped = u.user_cap > 0;
  const unlimited = u.unlimited && !capped;
  const total = capped ? u.user_cap : unlimited ? (u.fair || 0) : (u.monthly || 0) + (u.extra || 0);
  const used = capped ? (u.user_used || 0) : (u.monthly_used || 0) + (u.extra_used || 0);
  const left = Math.max(0, u.remaining || 0);
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const ownerView = u.is_owner !== false;
  return html`<div class="form-grid">
    <${PrivateMode} s=${s} save=${save} />
    <section class="panel span2 ai-plan">
      <div class="ai-plan-head">
        <div><h3>${unlimited ? 'Unlimited AI' : 'AI credits this month'}</h3><p class="muted small">${unlimited ? `No API keys needed. Your plan includes unlimited AI under fair use${u.fair ? ` (up to ${u.fair.toLocaleString()} credits a month)` : ''}; the count resets on ${fmtDate(u.resets_at)}.` : `No API keys needed. Credits come with your plan and reset on ${fmtDate(u.resets_at)}.`}${capped ? ' Your account owner set a monthly limit for you.' : ''}</p></div>
        <div class="row gap">${ai.buyUrl && ownerView ? html`<${Button} kind="primary" onClick=${() => openUrl(ai.buyUrl)}>Buy more credits</${Button}>` : null}<${Button} icon="refresh" busy=${busy} onClick=${reload}>Refresh</${Button}></div>
      </div>
      <div class="ai-plan-numbers">
        <div><b>${unlimited && !u.fair ? 'Unlimited' : left.toLocaleString()}</b><span>${unlimited ? 'left before the fair-use limit' : 'credits left'}</span></div>
        <div><b>${used.toLocaleString()}</b><span>used${capped ? ' by you' : ''}</span></div>
        <div><b>${unlimited && !u.fair ? '∞' : total.toLocaleString()}</b><span>${capped ? 'your monthly limit' : unlimited ? 'fair-use limit' : 'available this month'}</span></div>
      </div>
      <div class=${'ai-plan-bar' + (pct >= 90 ? ' low' : '')} role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><i style=${{ width: pct + '%' }} /></div>
      ${!capped && u.extra ? html`<p class="muted small">Includes ${(u.extra - (u.extra_used || 0)).toLocaleString()} extra credits from credit packs or bonuses — used after the monthly credits and they never expire.</p>` : null}
      ${u.error ? html`<p class="small warn">${u.error}</p>` : null}
    </section>
    <section class="panel">
      <h3>What's included</h3>
      <ul class="ai-feature-list">${FEATURES.map(([k, name, what]) => html`<li class=${caps[k] ? 'on' : 'off'}><span><b>${name}</b><span class="muted small">${typeof what === 'function' ? what(caps) : what}</span></span><${Badge} kind=${caps[k] ? 'ok' : ''}>${caps[k] ? 'Included' : 'Not on your plan'}</${Badge}></li>`)}</ul>
    </section>
    <${WhereRuns} s=${s} save=${save} caps=${caps} />
  </div>`;
}

/** Each feature runs on the built-in AI (set up by your vendor, nothing to choose) or on this computer. */
function WhereRuns({ s, save, caps }) {
  const kokoro = caps.voice_engine === 'kokoro';
  const rows = [
    ['text', 'Writing and analysis', s.ai.textProvider === 'builtin'],
    ['vision', 'Video frames', s.ai.visionProvider === 'builtin'],
    ['transcription', 'Transcription', s.transcription.engine === 'cloud'],
    ['tts', 'Voices', s.tts.engine === 'cloud' || s.tts.engine === 'myvoices'],
  ];
  const setWhere = async (key, builtin) => {
    if (key === 'transcription') return save({ transcription: Object.assign({}, s.transcription, { engine: builtin ? 'cloud' : 'local' }) }, builtin ? 'Transcription uses the built-in AI' : 'Transcription runs on this computer (Whisper downloads on first use)');
    if (key === 'tts') return save({ tts: Object.assign({}, s.tts, { engine: builtin ? 'cloud' : 'kokoro', voice: 'af_heart' }) }, builtin ? 'Voices use the built-in AI' : 'Voices run on this computer (Kokoro downloads on first use)');
    const field = key === 'text' ? ['textProvider', 'textModel', 'standard'] : ['visionProvider', 'visionModel', 'vision'];
    if (builtin) return save({ ai: Object.assign({}, s.ai, { [field[0]]: 'builtin', [field[1]]: field[2] }) }, `${key === 'text' ? 'Writing' : 'Video frames'} use the built-in AI`);
    // Offline: use the model already picked under Offline engines, or the first suitable one installed.
    const [st, cat] = await Promise.all([call('ollama.status').catch(() => null), call('ollama.catalog').catch(() => [])]);
    const installed = (st && st.models) || [];
    const kindOf = (name) => { const c = (cat || []).find((m) => name === m.name || name.startsWith(m.name + ':')); return c ? c.kind : /vl|vision|gemma3|llava|minicpm/i.test(name) ? 'vision' : 'text'; };
    const usable = installed.map((m) => m.name).filter((n) => key === 'text' || kindOf(n) === 'vision');
    const pick = usable.includes(s.ai[field[1]]) ? s.ai[field[1]] : usable.includes(s.ai.models.ollama) ? s.ai.models.ollama : usable[0];
    if (!pick) { toast(key === 'text' ? 'Install a local AI model under Settings → Offline engines first.' : 'Install a local vision model (for example Qwen 2.5 VL) under Settings → Offline engines first.', 'error', 6000); return null; }
    return save({ ai: Object.assign({}, s.ai, { [field[0]]: 'ollama', [field[1]]: pick }) }, `${key === 'text' ? 'Writing' : 'Video frames'} run on this computer with ${pick}`);
  };
  const allBuiltIn = () => save({ ai: Object.assign({}, s.ai, { textProvider: 'builtin', textModel: 'standard', visionProvider: 'builtin', visionModel: 'vision' }), transcription: Object.assign({}, s.transcription, { engine: 'cloud' }), tts: Object.assign({}, s.tts, { engine: 'cloud', voice: kokoro ? 'af_heart' : 'marin' }), images: Object.assign({}, s.images, { provider: 'builtin' }) }, 'Everything now uses the built-in AI');
  return html`<section class="panel">
    <h3>Where the AI runs</h3>
    <p class="muted small">The built-in AI is set up for you on fast servers, with nothing to install or choose. You can keep any feature on this computer instead, using the free offline engines.</p>
    <ul class="ai-feature-list">
      ${rows.map(([key, name, on]) => html`<li class=${on && !s.privateMode ? 'on' : 'off'}><span><b>${name}</b></span>${s.privateMode ? html`<${Badge} kind="info">This computer (Private mode)</${Badge}>`
        : html`<${Select} value=${on ? 'builtin' : 'local'} onChange=${(v) => setWhere(key, v === 'builtin')} options=${[['builtin', 'Built-in AI'], ['local', 'This computer (offline)']]} />`}</li>`)}
      <li class=${s.privateMode ? 'off' : 'on'}><span><b>Images</b></span><${Badge} kind=${s.privateMode ? 'info' : 'ok'}>${s.privateMode ? 'Paused (Private mode)' : 'Built-in AI'}</${Badge}></li>
    </ul>
    ${!s.privateMode && rows.some((x) => !x[2]) ? html`<${Button} onClick=${allBuiltIn}>Use the built-in AI for everything</${Button}>` : null}
    <p class="muted small">${kokoro ? 'Rough guide: transcribing 10 minutes uses about 5 credits, a written document about 5–15, a minute of voice about 2, a square image about 1 (wide images and infographics about 40), and a full 10-minute video analysis (frames and report) about 40–80.' : 'Rough guide: transcribing 10 minutes uses under 10 credits, a written document about 10–30, a minute of voice about 15, an image about 40, and a full 10-minute video analysis (frames and report) about 100–200.'}</p>
  </section>`;
}

function Keys({ st }) {
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState('');
  const set = async (k) => {
    setBusy(k);
    try {
      const r = await call('keys.set', { key: k, value: vals[k] || '' });
      st.set(Object.assign({}, st.data, { keys: r.keys, masked: Object.assign({}, st.data.masked, { [k]: r.masked }) }));
      setVals(Object.assign({}, vals, { [k]: '' }));
      if (vals[k]) {
        try { const t = await call('keys.test', { provider: k }); toast(`${KEYS.find((x) => x[0] === k)[1]} connected — ${t.detail}`, 'ok'); } catch (e) { toast(`Saved, but the test failed: ${e.message}`, 'error', 7000); }
      } else toast('Key removed', 'ok');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  return html`<div class="key-list">
    <p class="muted">Advanced mode: requests made with these keys go straight to each provider and use no AI credits. Keys are encrypted with your Windows account.</p>
    ${KEYS.map(([k, name, what, url]) => html`<div class="key-row">
      <div class="key-info"><b>${name}</b><span class="muted small">${what}</span></div>
      <div class="key-status">${st.data.keys[k] ? html`<${Badge} kind="ok">Connected ${st.data.masked[k]}</${Badge}>` : html`<${Badge}>Not set</${Badge}>`}</div>
      <input class="input" type="password" placeholder=${st.data.keys[k] ? 'Paste a new key to replace' : 'Paste key'} value=${vals[k] || ''} onInput=${(e) => setVals(Object.assign({}, vals, { [k]: e.target.value }))} />
      <div class="row gap">
        <${Button} size="sm" kind="primary" busy=${busy === k} disabled=${!vals[k]} onClick=${() => set(k)}>Save</${Button}>
        ${st.data.keys[k] ? html`<${Button} size="sm" onClick=${() => { setVals(Object.assign({}, vals, { [k]: '' })); call('keys.set', { key: k, value: '' }).then((r) => st.set(Object.assign({}, st.data, { keys: r.keys }))); }}>Remove</${Button}>` : null}
        ${url ? html`<button class="link-btn small" onClick=${() => openUrl(url)}>Get a key</button>` : null}
      </div>
    </div>`)}
  </div>`;
}

function ModelInput({ provider, value, onChange }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { setList(await call('ai.models', { provider })); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  return html`<div class="row gap">
    <input class="input" list=${'ml-' + provider} value=${value} onChange=${(e) => onChange(e.target.value.trim())} placeholder="model name" />
    ${list ? html`<datalist id=${'ml-' + provider}>${list.map((m) => html`<option value=${m} />`)}</datalist>` : null}
    <${Button} size="sm" icon="refresh" busy=${busy} onClick=${load} title="Load available models">${list ? `${list.length} found` : 'List models'}</${Button}>
  </div>`;
}

function Models({ s, save, keys, adv }) {
  const [ai, setAi] = useState(s.ai);
  const providers = useAsync(() => call('ai.providers'), []);
  const p = providers.data || {};
  const opts = Object.entries(p).map(([k, v]) => [k, v.label + (v.cloud ? ' — recommended' : v.local ? ' (free, offline)' : keys[k] || k === 'custom' ? '' : ' (no key)')]);
  const visOpts = Object.entries(p).filter(([, v]) => v.vision).map(([k, v]) => [k, v.label]);
  const upd = (patch) => setAi(Object.assign({}, ai, patch));
  const updModel = (prov, m) => setAi(Object.assign({}, ai, { models: Object.assign({}, ai.models, { [prov]: m }) }));
  return html`<div class="form-grid">
    <section class="panel">
      <h3>Writing and analysis</h3>
      <p class="muted small">Used for reports, documents, posts, scripts, prompts and chat.</p>
      <${Field} label="Engine"><${Select} value=${ai.textProvider} onChange=${(v) => upd({ textProvider: v, textModel: ai.models[v] || '' })} options=${opts} /></${Field}>
      ${p[ai.textProvider] && p[ai.textProvider].cloud ? html`<p class="muted small">Fast and accurate, no setup. Uses AI credits.</p>` : html`<${Field} label="Model"><${ModelInput} provider=${ai.textProvider} value=${ai.textModel || ai.models[ai.textProvider]} onChange=${(v) => upd({ textModel: v })} /></${Field}>`}
    </section>
    <section class="panel">
      <h3>Seeing video frames</h3>
      <p class="muted small">Needs a vision-capable model. Offline, Qwen 2.5 VL or Gemma 3 run free on your PC (Settings → Offline engines).</p>
      <${Field} label="Engine"><${Select} value=${ai.visionProvider} onChange=${(v) => upd({ visionProvider: v, visionModel: ai.models[v] || '' })} options=${visOpts} /></${Field}>
      ${p[ai.visionProvider] && p[ai.visionProvider].cloud ? html`<p class="muted small">Fast and accurate, no setup. Uses AI credits.</p>` : html`<${Field} label="Model"><${ModelInput} provider=${ai.visionProvider} value=${ai.visionModel || ai.models[ai.visionProvider]} onChange=${(v) => upd({ visionModel: v })} /></${Field}>`}
    </section>
    <section class="panel span2">
      <h3>${adv ? 'Default model per provider' : 'Offline model servers'}</h3>
      ${adv ? html`<div class="grid2">${Object.keys(ai.models).filter((k) => p[k] && !p[k].cloud).map((k) => html`<${Field} label=${(p[k] && p[k].label) || k}><input class="input" value=${ai.models[k]} onChange=${(e) => updModel(k, e.target.value.trim())} /></${Field}>`)}</div>` : null}
      <div class="grid2">
        <${Field} label="Ollama address"><input class="input" value=${ai.ollamaUrl} onChange=${(e) => upd({ ollamaUrl: e.target.value.trim() })} /></${Field}>
        <${Field} label="LM Studio address"><input class="input" value=${ai.lmstudioUrl} onChange=${(e) => upd({ lmstudioUrl: e.target.value.trim() })} /></${Field}>
        ${adv ? html`<${Field} label="Custom OpenAI-compatible base URL" hint="e.g. https://my-server/v1"><input class="input" value=${ai.customBaseUrl} onChange=${(e) => upd({ customBaseUrl: e.target.value.trim() })} /></${Field}>` : null}
        <${Range} label="Creativity" value=${ai.temperature} min=${0} max=${1.2} step=${0.05} onChange=${(v) => upd({ temperature: v })} fmt=${(v) => v.toFixed(2)} />
      </div>
    </section>
    <div class="span2"><${Button} kind="primary" onClick=${() => save({ ai })}>Save AI engine</${Button}></div>
  </div>`;
}

function ToolUpdates({ runner, onChecked }) {
  const tl = useAsync(() => call('tools.list'), []);
  const [checked, setChecked] = useState(0);
  const check = async () => { const r = await runner.run('models.check', {}, 'Checking for new models'); if (r) { tl.set(r.tools); setChecked(r.checked); onChecked && onChecked(); const n = r.tools.filter((t) => t.updateAvailable).length; toast(n ? `${n} update${n > 1 ? 's' : ''} available` : 'Everything is up to date', 'ok'); } };
  const list = (tl.data || []).filter((t) => t.installed || t.canRevert);
  return html`<section class="panel span2">
    <div class="row between wrap gap"><div><h3>Engines and updates</h3><p class="muted small">Check for new versions and new models your vendor has added. Every update keeps the previous version, so you can go back in one click.</p></div>
      <${Button} icon="refresh" busy=${runner.busy} onClick=${check}>Check for new models</${Button}></div>
    ${list.length ? html`<table class="table"><thead><tr><th>Engine</th><th>Version</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((t) => html`<tr><td><b>${t.label}</b></td><td class="mono-num">${t.version || '—'}${t.canRevert && t.backupVersion ? html`<div class="muted small">Previous: ${t.backupVersion}</div>` : null}</td>
        <td>${t.checkError ? html`<span class="muted small">${t.checkError}</span>` : t.updateAvailable ? html`<${Badge} kind="info">${t.latest} available</${Badge}>` : checked && t.latest ? html`<${Badge} kind="ok">Up to date</${Badge}>` : null}</td>
        <td><div class="row gap end">${t.updateAvailable ? html`<${Button} size="sm" kind="primary" busy=${runner.busy} onClick=${async () => { const r = await runner.run('tools.update', { id: t.id }, `Updating ${t.label}`, `${t.label} updated`); if (r) tl.set(r); }}>Update</${Button}>` : null}
          ${t.canRevert ? html`<${Button} size="sm" onClick=${async () => { try { tl.set(await call('tools.revert', { id: t.id })); toast(`${t.label} reverted`, 'ok'); } catch (e) { toast(e.message, 'error'); } }}>Revert</${Button}>` : null}</div></td></tr>`)}
    </tbody></table>` : html`<p class="muted small">No offline engines are installed yet. They download the first time you use them, or from the sections below.</p>`}
  </section>`;
}

function VoicePacks({ runner }) {
  const vp = useAsync(() => call('voice.localPacks').catch(() => null), []);
  if (!vp.data) return null;
  const note = { kokoro: 'Natural offline text-to-speech in English, Spanish, French, Italian, Portuguese, Hindi, Japanese and Chinese.', zipvoice: 'Clone a voice from a short sample without the internet.', vocos: 'Needed by offline voice cloning.', espeak: 'Pronunciation for Spanish, French, Italian, Portuguese and Hindi voices (GPL, downloaded separately).' };
  return html`<section class="panel span2">
    <h3>Offline voice packs</h3>
    <p class="muted small">Voices that run on this computer with no credits and no internet. Each pack downloads once.</p>
    <table class="table"><thead><tr><th>Pack</th><th>Size</th><th>Notes</th><th></th></tr></thead><tbody>
      ${Object.entries(vp.data).map(([k, p]) => html`<tr><td><b>${p.label}</b></td><td class="nowrap">${p.mb} MB</td><td class="muted small">${note[k] || ''}</td><td><div class="row gap end">
        ${p.installed ? html`<${Badge} kind="ok">Installed</${Badge}><${Button} size="sm" onClick=${async () => { try { vp.set(await call('voice.localPackRemove', { name: k })); } catch (e) { toast(e.message, 'error'); } }}>Remove</${Button}>`
          : html`<${Button} size="sm" busy=${runner.busy} onClick=${async () => { const r = await runner.run('voice.localPackInstall', { name: k }, `Downloading ${p.label}`, `${p.label} installed`); if (r) vp.set(r); }}>Download</${Button}>`}
      </div></td></tr>`)}
    </tbody></table>
  </section>`;
}

function HfAdd({ placeholder, hint, onAdd, busy, disabled, label = 'Add' }) {
  const [v, setV] = useState('');
  return html`<div class="hf-add"><div class="row gap"><input class="input grow" aria-label=${placeholder} placeholder=${placeholder} value=${v} onInput=${(e) => setV(e.target.value)} /><${Button} busy=${busy} disabled=${disabled || !v.trim()} onClick=${async () => { if (await onAdd(v.trim())) setV(''); }}>${label}</${Button}></div>${hint ? html`<p class="muted small">${hint}</p>` : null}</div>`;
}

function LocalEngines({ s, save, adv }) {
  const ol = useAsync(() => Promise.all([call('ollama.status'), call('ollama.catalog')]).then(([st, cat]) => ({ st, cat })), []);
  const wm = useAsync(() => call('whisper.models'), []);
  const bins = useAsync(() => call('bins.status'), []);
  const runner = useRunner('');
  const pull = async (name) => { await runner.run('ollama.pull', { name }, `Downloading ${name}`, `${name} is ready`); ol.reload(); };
  return html`<div class="form-grid">
    <${ToolUpdates} runner=${runner} onChecked=${() => { ol.reload(); wm.reload(); }} />
    <${VoicePacks} runner=${runner} />
    <section class="panel span2">
      <div class="row between"><h3>Local AI models (free, private)</h3>${ol.data && ol.data.st.running ? html`<${Badge} kind="ok">Ollama running</${Badge}>` : html`<${Badge} kind="warn">Ollama not running</${Badge}>`}</div>
      <p class="muted small">Optional. The built-in AI needs none of this. Local models run on your computer with Ollama, so nothing leaves your PC. You need about 4 GB of graphics memory (NVIDIA recommended) or 16 GB RAM. Use them from Settings → Built-in AI → Where the AI runs, or with the buttons below.</p>
      ${ol.data && !ol.data.st.running ? html`<div class="row gap"><${Button} kind="primary" icon="download" busy=${runner.busy} onClick=${() => runner.run('ollama.install', {}, 'Installing Ollama')}>Install Ollama (one click)</${Button}><${Button} icon="refresh" onClick=${ol.reload}>Check again</${Button}></div>` : null}
      <div class="grid2"><${Field} label="Ollama address" hint="Change only if Ollama runs on another computer or port."><input class="input" value=${s.ai.ollamaUrl} onChange=${async (e) => { await save({ ai: Object.assign({}, s.ai, { ollamaUrl: e.target.value.trim() || 'http://127.0.0.1:11434' }) }, 'Ollama address saved'); ol.reload(); }} /></${Field}></div>
      <${Progress} runner=${runner} />
      ${ol.data ? html`<table class="table"><thead><tr><th>Model</th><th>Type</th><th>Size</th><th>Notes</th><th></th></tr></thead><tbody>
        ${ol.data.cat.map((m) => {
          const have = ol.data.st.models.some((x) => x.name === m.name || x.name.startsWith(m.name + ':'));
          const inst = have ? (ol.data.st.models.find((x) => x.name === m.name || x.name.startsWith(m.name + ':')) || {}).name : '';
          const usesText = s.ai.textProvider === 'ollama' && s.ai.textModel === inst;
          const usesVision = s.ai.visionProvider === 'ollama' && s.ai.visionModel === inst;
          return html`<tr><td><b>${m.label}</b>${m.isNew ? html` <${Badge} kind="info">New</${Badge}>` : null}<div class="muted small">${m.name}</div></td><td>${m.kind === 'vision' ? 'Vision + text' : 'Text'}</td><td>${m.gb} GB</td><td class="muted small">${m.note}</td>
          <td>${have ? html`<div class="row gap wrap"><${Badge} kind="ok">Installed</${Badge}>
            ${usesText ? html`<${Badge} kind="info">Writing</${Badge}>` : html`<${Button} size="sm" onClick=${() => save({ ai: Object.assign({}, s.ai, { textProvider: 'ollama', textModel: inst }) }, `Writing now runs on this computer with ${inst}`)}>Use for writing</${Button}>`}
            ${m.kind === 'vision' ? (usesVision ? html`<${Badge} kind="info">Video frames</${Badge}>` : html`<${Button} size="sm" onClick=${() => save({ ai: Object.assign({}, s.ai, { visionProvider: 'ollama', visionModel: inst }) }, `Video frames now run on this computer with ${inst}`)}>Use for video frames</${Button}>`) : null}
            <${Button} size="sm" onClick=${async () => { await call('ollama.delete', { name: m.name }); ol.reload(); }}>Remove</${Button}></div>` : html`<${Button} size="sm" disabled=${!ol.data.st.running || runner.busy} onClick=${() => pull(m.name)}>Install</${Button}>`}</td></tr>`;
        })}
        ${ol.data.st.models.filter((x) => !ol.data.cat.some((m) => x.name.startsWith(m.name))).map((x) => html`<tr><td><b>${x.name}</b></td><td>Your model</td><td>${bytes(x.size)}</td><td></td><td><div class="row gap wrap"><${Badge} kind="ok">Installed</${Badge}>
          ${s.ai.textProvider === 'ollama' && s.ai.textModel === x.name ? html`<${Badge} kind="info">Writing</${Badge}>` : html`<${Button} size="sm" onClick=${() => save({ ai: Object.assign({}, s.ai, { textProvider: 'ollama', textModel: x.name }) }, `Writing now runs on this computer with ${x.name}`)}>Use for writing</${Button}>`}
          ${/vl|vision|gemma3|llava|minicpm/i.test(x.name) ? (s.ai.visionProvider === 'ollama' && s.ai.visionModel === x.name ? html`<${Badge} kind="info">Video frames</${Badge}>` : html`<${Button} size="sm" onClick=${() => save({ ai: Object.assign({}, s.ai, { visionProvider: 'ollama', visionModel: x.name }) }, `Video frames now run on this computer with ${x.name}`)}>Use for video frames</${Button}>`) : null}</div></td></tr>`)}
      </tbody></table>
      <${AddOllama} disabled=${!ol.data.st.running || runner.busy} onPull=${pull} />
      <${HfAdd} placeholder="Hugging Face link, e.g. https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF" hint="Any GGUF model on Hugging Face. Link to a specific .gguf file to choose its size (for example Q4_K_M)." label="Add from Hugging Face" busy=${runner.busy} disabled=${!ol.data.st.running} onAdd=${async (url) => { const r = await runner.run('ollama.hf', { url }, 'Downloading from Hugging Face', 'Model installed'); ol.reload(); return Boolean(r); }} />` : html`<${Spinner} />`}
    </section>
    <section class="panel span2">
      <h3>Whisper transcription models</h3>
      <p class="muted small">Unlimited offline transcription. Bigger models are more accurate but slower.</p>
      ${bins.data ? html`<div class="row gap wrap">
        <span>Engine: ${bins.data.whisperCpu ? html`<${Badge} kind="ok">CPU ready</${Badge}>` : html`<${Badge}>CPU not installed</${Badge}>`} ${bins.data.whisperCuda ? html`<${Badge} kind="ok">NVIDIA ready</${Badge}>` : null}</span>
        ${!bins.data.whisperCpu ? html`<${Button} size="sm" onClick=${async () => { await runner.run('whisper.engine', { flavor: 'cpu' }, 'Installing Whisper engine'); bins.reload(); }}>Install CPU engine</${Button}>` : null}
        ${!bins.data.whisperCuda ? html`<${Button} size="sm" onClick=${async () => { await runner.run('whisper.engine', { flavor: 'cuda' }, 'Installing NVIDIA Whisper engine'); bins.reload(); }}>Install NVIDIA GPU engine (CUDA 12)</${Button}>` : null}
      </div>` : null}
      ${wm.data ? html`<table class="table"><thead><tr><th>Model</th><th>Size</th><th>Notes</th><th></th></tr></thead><tbody>
        ${wm.data.map((m) => html`<tr><td><b>${m.label}</b>${m.isNew ? html` <${Badge} kind="info">New</${Badge}>` : null}${s.transcription.model === m.id ? html` <${Badge} kind="info">Default</${Badge}>` : null}</td><td>${m.mb} MB</td><td class="muted small">${m.note}</td><td><div class="row gap">
          ${m.installed ? html`<${Button} size="sm" onClick=${() => save({ transcription: Object.assign({}, s.transcription, { model: m.id }) }, 'Default model set')}>Use</${Button}><${Button} size="sm" onClick=${async () => wm.set(await call('whisper.delete', { id: m.id }))}>Delete</${Button}>`
            : html`<${Button} size="sm" disabled=${runner.busy} onClick=${async () => { const r = await runner.run('whisper.download', { id: m.id }, `Downloading Whisper ${m.label}`, `${m.label} installed`); if (r) wm.set(r); }}>Download</${Button}>`}
        </div></td></tr>`)}
      </tbody></table>
      <div class="row gap wrap"><${Button} size="sm" icon="upload" onClick=${async () => { const f = await pickFiles({ filters: [{ name: 'Whisper model', extensions: ['bin'] }] }); if (f[0]) wm.set(await call('whisper.import', { file: f[0] })); }}>Import a custom Whisper model (.bin)</${Button}></div>
      <${HfAdd} placeholder="Hugging Face link to a ggml .bin file" hint="For example a fine-tuned Whisper for your language. The link must point to a ggml-….bin file." label="Add from Hugging Face" busy=${runner.busy} onAdd=${async (url) => { const r = await runner.run('whisper.addHf', { url }, 'Downloading Whisper model', 'Model added'); if (r) wm.set(r); return Boolean(r); }} />` : html`<${Spinner} />`}
    </section>
    <section class="panel span2">
      <h3>In-app voice and translation models</h3>
      <p class="muted small">Kokoro voices (local TTS) and NLLB-200 offline translation download automatically the first time you use them (about 90 MB and 900 MB) and are cached on this computer.</p>
      <div class="row gap"><${Button} size="sm" onClick=${async () => { try { const r = await runner.run('engines.status', {}, 'Checking local engines'); if (r) toast(`GPU acceleration: ${r.webgpu ? 'available (WebGPU)' : 'not available — using CPU'}; cached models: ${r.cached}`, 'ok', 7000); } catch (e) { toast(e.message, 'error'); } }}>Check local engine</${Button}>
      <${Button} size="sm" onClick=${() => runner.run('engines.clear', {}, 'Clearing model cache', 'Model cache cleared')}>Clear downloaded models</${Button}></div>
    </section>
  </div>`;
}

function AddOllama({ disabled, onPull }) {
  const [name, setName] = useState('');
  return html`<div class="row gap" style="margin-top:10px"><input class="input" placeholder="Any Ollama model, e.g. llama3.2-vision:11b" value=${name} onInput=${(e) => setName(e.target.value)} /><${Button} disabled=${disabled || !name} onClick=${() => onPull(name.trim())}>Install</${Button}></div>`;
}

function Transcription({ s, save, adv }) {
  const [t, setT] = useState(s.transcription);
  const wm = useAsync(() => call('whisper.models'), []);
  const up = (p) => setT(Object.assign({}, t, p));
  return html`<div class="form-grid">
    <section class="panel">
      <h3>Default engine</h3>
      <${Field} label="Engine"><${Select} value=${t.engine} onChange=${(v) => up({ engine: v })} options=${[['cloud', 'Built-in AI — fastest, no setup (uses credits)'], ['local', 'Whisper on this computer (free, offline, unlimited)']].concat(adv ? [['openai', 'OpenAI Whisper (your key)'], ['groq', 'Groq Whisper (your key)'], ['gladia', 'Gladia (your key)']] : [])} /></${Field}>
      ${t.engine === 'cloud' ? html`<p class="muted small">Long files are split into parts and transcribed side by side — an hour of audio usually takes about a minute. Under 1 credit per minute.</p>` : null}
      ${t.engine === 'local' ? html`
        <${Field} label="Model"><${Select} value=${t.model} onChange=${(v) => up({ model: v })} options=${(wm.data || []).map((m) => [m.id, m.label + (m.installed ? '' : ' (downloads on first use)')])} /></${Field}>
        <${Field} label="Hardware"><${Select} value=${t.gpu} onChange=${(v) => up({ gpu: v })} options=${[['cpu', 'CPU (works everywhere)'], ['cuda', 'NVIDIA GPU (CUDA 12 driver)']]} /></${Field}>
        <${Field} label="CPU threads" hint="0 = automatic"><input class="input" type="number" min="0" max="64" value=${t.threads} onInput=${(e) => up({ threads: Number(e.target.value) || 0 })} /></${Field}>` : null}
      ${t.engine === 'openai' ? html`<${Field} label="OpenAI model"><input class="input" value=${t.openaiModel} onChange=${(e) => up({ openaiModel: e.target.value.trim() })} /></${Field}>` : null}
      ${t.engine === 'groq' ? html`<${Field} label="Groq model"><input class="input" value=${t.groqModel} onChange=${(e) => up({ groqModel: e.target.value.trim() })} /></${Field}>` : null}
    </section>
    <section class="panel">
      <h3>Language and captions</h3>
      <${Field} label="Spoken language"><${LangSelect} value=${t.language} onChange=${(v) => up({ language: v })} list=${data.WHISPER_LANGS} /></${Field}>
      <${Toggle} checked=${t.useCaptions} onChange=${(v) => up({ useCaptions: v })} label="Use the platform's captions when a link has them" hint="Instant and free for most YouTube videos." />
    </section>
    <div class="span2"><${Button} kind="primary" onClick=${() => save({ transcription: t })}>Save transcription settings</${Button}></div>
  </div>`;
}

function VoiceSettings({ s, save, adv }) {
  const [tts, setTts] = useState(Object.assign({ geminiModel: 'gemini-2.5-flash-preview-tts', openaiModel: 'gpt-4o-mini-tts', elevenModel: 'eleven_multilingual_v2', customBaseUrl: '', customModel: 'tts-1', customVoices: '' }, s.tts));
  const [tr, setTr] = useState(s.translation);
  const up = (p) => setTts(Object.assign({}, tts, p));
  if (!adv) {
    return html`<div class="form-grid">
      <section class="panel">
        <h3>Default voice engine</h3>
        <${Field} label="Engine"><${Select} value=${tts.engine} onChange=${(v) => up({ engine: v, voice: v === 'cloud' || v === 'kokoro' ? 'af_heart' : '' })} options=${[['cloud', 'Built-in voices (natural, uses credits)'], ['kokoro', 'Kokoro on this computer (free, offline)'], ['piper', 'Piper on this computer (free, offline, 40+ languages)']]} /></${Field}>
        <p class="muted small">Your cloned and designed voices appear in every voice menu marked with ★.</p>
      </section>
      <section class="panel">
        <h3>Translation</h3>
        <${Field} label="Default translation engine"><${Select} value=${tr.engine} onChange=${(v) => setTr({ engine: v })} options=${[['ai', 'AI (best quality — built-in AI or your offline model)'], ['local', 'NLLB-200 offline (free, 200+ languages, runs on this PC)']]} /></${Field}>
      </section>
      <div class="span2"><${Button} kind="primary" onClick=${() => save({ tts, translation: tr })}>Save</${Button}></div>
    </div>`;
  }
  return html`<div class="form-grid">
    <section class="panel">
      <h3>Voice engine models</h3>
      <${Field} label="OpenAI voice model"><input class="input" value=${tts.openaiModel} onChange=${(e) => up({ openaiModel: e.target.value.trim() })} /></${Field}>
      <${Field} label="Gemini voice model"><input class="input" value=${tts.geminiModel} onChange=${(e) => up({ geminiModel: e.target.value.trim() })} /></${Field}>
      <${Field} label="ElevenLabs model"><${Select} value=${tts.elevenModel} onChange=${(v) => up({ elevenModel: v })} options=${[['eleven_multilingual_v2', 'Multilingual v2 (best quality)'], ['eleven_v3', 'Eleven v3 (most expressive)'], ['eleven_flash_v2_5', 'Flash v2.5 (fastest, cheapest)'], ['eleven_turbo_v2_5', 'Turbo v2.5']]} /></${Field}>
    </section>
    <section class="panel">
      <h3>Custom voice server</h3>
      <p class="muted small">Connect any OpenAI-compatible speech server you run (e.g. Kokoro-FastAPI, Chatterbox, OpenVoice, XTTS servers) — including local cloning servers.</p>
      <${Field} label="Base URL" hint="e.g. http://127.0.0.1:8880/v1"><input class="input" value=${tts.customBaseUrl} onChange=${(e) => up({ customBaseUrl: e.target.value.trim() })} /></${Field}>
      <${Field} label="Model"><input class="input" value=${tts.customModel} onChange=${(e) => up({ customModel: e.target.value.trim() })} /></${Field}>
      <${Field} label="Voice names (comma separated)" hint="Only needed if the server can't list its voices."><input class="input" value=${tts.customVoices} onChange=${(e) => up({ customVoices: e.target.value })} /></${Field}>
    </section>
    <section class="panel">
      <h3>Translation</h3>
      <${Field} label="Default translation engine"><${Select} value=${tr.engine} onChange=${(v) => setTr({ engine: v })} options=${[['ai', 'AI (best quality — built-in AI or your offline model)'], ['local', 'NLLB-200 offline (free, 200+ languages, runs on this PC)']]} /></${Field}>
    </section>
    <div class="span2"><${Button} kind="primary" onClick=${() => save({ tts, translation: tr })}>Save</${Button}></div>
  </div>`;
}

function ImageSettings({ s, save, adv }) {
  const [im, setIm] = useState(s.images);
  if (!adv) {
    return html`<div class="form-grid"><section class="panel">
      <h3>Image generation</h3>
      <p class="muted">Images are made by the built-in AI — no setup needed. Each image uses about 40 credits.</p>
      ${im.provider !== 'builtin' ? html`<${Button} kind="primary" onClick=${() => save({ images: Object.assign({}, im, { provider: 'builtin' }) })}>Use the built-in AI for images</${Button}>` : null}
    </section></div>`;
  }
  return html`<div class="form-grid"><section class="panel">
    <h3>Image generation</h3>
    <${Field} label="Provider"><${Select} value=${im.provider} onChange=${(v) => setIm(Object.assign({}, im, { provider: v }))} options=${[['builtin', 'Built-in AI'], ['openai', 'OpenAI'], ['gemini', 'Google Gemini'], ['openrouter', 'OpenRouter'], ['fal', 'fal.ai']]} /></${Field}>
    ${['openai', 'gemini', 'openrouter', 'fal'].map((k) => html`<${Field} label=${k + ' model'}><input class="input" value=${im.models[k]} onChange=${(e) => setIm(Object.assign({}, im, { models: Object.assign({}, im.models, { [k]: e.target.value.trim() }) }))} /></${Field}>`)}
    <${Button} kind="primary" onClick=${() => save({ images: im })}>Save</${Button}>
  </section></div>`;
}

function VisionSettings({ s, save }) {
  const [v, setV] = useState(s.vision);
  return html`<div class="form-grid"><section class="panel">
    <h3>Video analysis</h3>
    <${Field} label="Frame detail" hint="How many key frames the vision model looks at per video."><${Select} value=${v.frameDetail} onChange=${(x) => setV(Object.assign({}, v, { frameDetail: x }))} options=${[['low', 'Low — up to 40 frames (cheapest)'], ['standard', 'Standard — up to 120 frames'], ['high', 'High — every key frame (up to 400)']]} /></${Field}>
    <${Range} label="Scene change sensitivity" value=${v.sceneThreshold} min=${0.15} max=${0.6} step=${0.01} onChange=${(x) => setV(Object.assign({}, v, { sceneThreshold: x }))} fmt=${(x) => (x < 0.25 ? 'more frames' : x > 0.45 ? 'fewer frames' : 'balanced') + ` (${x.toFixed(2)})`} />
    <${Range} label="Longest gap without a frame" value=${v.maxGap} min=${5} max=${60} step=${1} onChange=${(x) => setV(Object.assign({}, v, { maxGap: x }))} fmt=${(x) => x + ' s'} />
    <${Button} kind="primary" onClick=${() => save({ vision: v })}>Save</${Button}>
  </section></div>`;
}

function WordPress() {
  const sites = useAsync(() => call('wp.sites'), []);
  const [edit, setEdit] = useState(null);
  return html`<div>
    <p class="muted">Publish posts straight to your WordPress sites. In WordPress go to Users → Profile → Application Passwords, create one, and paste it here. No plugin needed.</p>
    <div class="list">${(sites.data || []).map((x) => html`<div class="list-row"><span class="list-main"><b>${x.name}</b><span class="muted small">${x.url} — ${x.username}</span></span>
      <${Button} size="sm" onClick=${async () => { try { const r = await call('wp.test', { id: x.id }); toast(`Connected as ${r.user}`, 'ok'); } catch (e) { toast(e.message, 'error'); } }}>Test</${Button}>
      <${Button} size="sm" onClick=${() => setEdit(x)}>Edit</${Button}><${Button} size="sm" kind="danger" onClick=${async () => sites.set(await call('wp.remove', { id: x.id }))}>Remove</${Button}></div>`)}</div>
    <${Button} icon="plus" kind="primary" onClick=${() => setEdit({})}>Add a WordPress site</${Button}>
    ${edit ? html`<${WpModal} site=${edit} onClose=${() => setEdit(null)} onSaved=${(l) => { sites.set(l); setEdit(null); }} />` : null}
  </div>`;
}

function WpModal({ site, onClose, onSaved }) {
  const [f, setF] = useState({ id: site.id, name: site.name || '', url: site.url || '', username: site.username || '', appPassword: '' });
  const up = (p) => setF(Object.assign({}, f, p));
  const save = async () => { try { onSaved(await call('wp.save', f)); toast('Site saved', 'ok'); } catch (e) { toast(e.message, 'error'); } };
  return html`<${Modal} title=${site.id ? 'Edit site' : 'Add WordPress site'} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel</${Button}><${Button} kind="primary" onClick=${save}>Save site</${Button}>`}>
    <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => up({ name: e.target.value })} placeholder="My blog" /></${Field}>
    <${Field} label="Site address"><input class="input" value=${f.url} onInput=${(e) => up({ url: e.target.value })} placeholder="https://myblog.com" /></${Field}>
    <${Field} label="Username"><input class="input" value=${f.username} onInput=${(e) => up({ username: e.target.value })} /></${Field}>
    <${Field} label="Application password" hint=${site.id ? 'Leave empty to keep the current one.' : ''}><input class="input" type="password" value=${f.appPassword} onInput=${(e) => up({ appPassword: e.target.value })} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" /></${Field}>
  </${Modal}>`;
}

function Folders({ s, save }) {
  const info = useAsync(() => call('app.info'), []);
  const runner = useRunner('');
  const pick = async (key) => { const d = await pickFiles({ directory: true }); if (d[0]) { await save({ folders: Object.assign({}, s.folders, { [key]: d[0] }) }, 'Folder updated'); info.reload(); } };
  const row = (key, label, cur) => html`<div class="list-row"><span class="list-main"><b>${label}</b><span class="muted small">${cur}</span></span>
    <${Button} size="sm" onClick=${() => openPath(cur)}>Open</${Button}><${Button} size="sm" onClick=${() => pick(key)}>Change</${Button}>
    ${s.folders[key] ? html`<${Button} size="sm" onClick=${async () => { await save({ folders: Object.assign({}, s.folders, { [key]: '' }) }, 'Reset to default'); info.reload(); }}>Default</${Button}>` : null}</div>`;
  return html`<div>
    ${info.data ? html`<div class="list">
      ${row('workspace', 'Projects and libraries', info.data.paths.workspace)}
      ${row('exports', 'Exports', info.data.paths.exports)}
      ${row('models', 'Downloaded AI models', info.data.paths.models)}
    </div>` : html`<${Spinner} />`}
    <section class="panel" style="margin-top:18px">
      <h3>Backup and move to a new computer</h3>
      <p class="muted small">One zip with your Audio Library, Voice Library, Studio projects, custom prompts and settings (API keys are not included).</p>
      <div class="row gap">
        <${Button} icon="download" busy=${runner.busy} onClick=${async () => { const f = await saveFile({ defaultPath: 'Vid Vision backup.zip', filters: [{ name: 'Zip', extensions: ['zip'] }] }); if (f) { const r = await runner.run('library.backup', { file: f }, 'Creating backup', 'Backup saved'); if (r) showInFolder(r.file); } }}>Create backup</${Button}>
        <${Button} icon="upload" busy=${runner.busy} onClick=${async () => { const f = await pickFiles({ filters: [{ name: 'Zip', extensions: ['zip'] }] }); if (f[0]) { const r = await runner.run('library.restore', { file: f[0] }, 'Restoring backup'); if (r) toast(`Restored ${r.audio} audio files, ${r.voices} voices, ${r.prompts} prompts`, 'ok'); } }}>Restore backup</${Button}>
      </div>
      <${Progress} runner=${runner} />
    </section>
  </div>`;
}

function Network({ s, save }) {
  const [n, setN] = useState(s.network);
  const bins = useAsync(() => call('bins.status'), []);
  const runner = useRunner('');
  return html`<div class="form-grid">
    <section class="panel">
      <h3>Proxy</h3>
      <p class="muted small">Use a proxy to search or download YouTube as if you were in another country.</p>
      <${Field} label="Proxy URL" hint="http://user:pass@host:port or socks5://host:port"><input class="input" value=${n.proxy} onInput=${(e) => setN(Object.assign({}, n, { proxy: e.target.value.trim() }))} /></${Field}>
      <${Field} label="Default market for Discover"><${Select} value=${n.market} onChange=${(v) => setN(Object.assign({}, n, { market: v }))} options=${data.MARKETS} /></${Field}>
      <${Button} kind="primary" onClick=${() => save({ network: n })}>Save</${Button}>
    </section>
    <section class="panel">
      <h3>Media tools</h3>
      ${bins.data ? html`<ul class="checklist compact">
        <li class=${bins.data.ffmpeg ? 'done' : ''}>FFmpeg ${bins.data.ffmpeg ? 'ready' : 'missing'}</li>
        <li class=${bins.data.ytdlp ? 'done' : ''}>Video downloader ${bins.data.ytdlp ? 'ready' : 'downloads on first use'}</li>
        <li class=${bins.data.whisperCpu ? 'done' : ''}>Whisper engine ${bins.data.whisperCpu ? 'ready' : 'downloads on first use'}</li>
        <li class=${bins.data.piper ? 'done' : ''}>Piper engine ${bins.data.piper ? 'ready' : 'downloads on first use'}</li>
      </ul>` : null}
      <div class="row gap">
        <${Button} size="sm" busy=${runner.busy} onClick=${async () => { await runner.run('bins.ensure', {}, 'Installing media tools', 'Media tools ready'); bins.reload(); }}>Install missing tools</${Button}>
        <${Button} size="sm" busy=${runner.busy} onClick=${async () => { const r = await runner.run('bins.updateYtdlp', {}, 'Updating downloader'); if (r) toast(r, 'ok', 6000); }}>Update video downloader</${Button}>
      </div>
      <${Progress} runner=${runner} />
    </section>
  </div>`;
}
