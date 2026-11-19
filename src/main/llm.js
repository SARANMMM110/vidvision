'use strict';
// Text + vision LLM providers behind one interface.
// Default: the built-in AI" (no keys on the PC; credits per plan, see cloud.js).
// Cloud (bring your own key): OpenAI, Anthropic Claude, Google Gemini, OpenRouter, xAI Grok, Mistral, DeepSeek,
// Perplexity, Groq, custom OpenAI-compatible. Local (free): Ollama, LM Studio.
const fs = require('fs');
const { Readable } = require('stream');
const store = require('./store');
const net = require('./util/net');
const cloud = require('./cloud');

const PROVIDERS = {
  builtin: { label: 'Built-in AI', vision: true, jsonMode: true, cloud: true },
  openai: { label: 'OpenAI', base: () => 'https://api.openai.com/v1', vision: true, jsonMode: true },
  anthropic: { label: 'Anthropic Claude', vision: true },
  gemini: { label: 'Google Gemini', vision: true },
  openrouter: { label: 'OpenRouter', base: () => 'https://openrouter.ai/api/v1', vision: true, headers: { 'HTTP-Referer': require('./appconfig').serverUrl || 'https://openrouter.ai', 'X-Title': require('./appconfig').appName } },
  xai: { label: 'xAI Grok', base: () => 'https://api.x.ai/v1', vision: true, jsonMode: true },
  mistral: { label: 'Mistral', base: () => 'https://api.mistral.ai/v1', vision: true, jsonMode: true },
  deepseek: { label: 'DeepSeek', base: () => 'https://api.deepseek.com/v1', vision: false, jsonMode: true },
  perplexity: { label: 'Perplexity', base: () => 'https://api.perplexity.ai', vision: false },
  groq: { label: 'Groq', base: () => 'https://api.groq.com/openai/v1', vision: true, jsonMode: true },
  ollama: { label: 'Ollama (local, free)', base: () => store.getSettings().ai.ollamaUrl.replace(/\/+$/, '') + '/v1', vision: true, local: true, jsonMode: true },
  lmstudio: { label: 'LM Studio (local, free)', base: () => store.getSettings().ai.lmstudioUrl.replace(/\/+$/, ''), vision: true, local: true },
  custom: { label: 'Custom (OpenAI-compatible)', base: () => store.getSettings().ai.customBaseUrl.replace(/\/+$/, ''), vision: true },
};

function keyFor(provider) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('Unknown AI provider: ' + provider);
  if (p.local) return 'local';
  if (p.cloud) return 'cloud';
  const k = store.getSecret(provider);
  if (!k && provider !== 'custom') throw Object.assign(new Error(`Add your ${p.label} API key in Settings → AI keys (or choose a local model).`), { code: 'nokey' });
  return k;
}

/** Resolve provider + model for a purpose ("text" or "vision"), honouring overrides. */
function pick(purpose, override) {
  const ai = store.getSettings().ai;
  const provider = (override && override.provider) || (purpose === 'vision' ? ai.visionProvider : ai.textProvider) || 'builtin';
  if (store.getSettings().privateMode && !(PROVIDERS[provider] && PROVIDERS[provider].local)) {
    // Private mode: route to the local model (Ollama first, then LM Studio).
    const mine = (purpose === 'vision' ? ai.visionProvider : ai.textProvider);
    const local = PROVIDERS[mine] && PROVIDERS[mine].local ? mine : ['ollama', 'lmstudio'].find((p) => ai.models[p]);
    if (!local) throw Object.assign(new Error('Private mode is on, so AI writing runs only on this computer. Install a local model in Settings → Offline engines, or turn Private mode off.'), { code: 'private' });
    return { provider: local, model: (local === mine ? (purpose === 'vision' ? ai.visionModel : ai.textModel) : '') || ai.models[local] };
  }
  if (provider === 'builtin') return { provider, model: purpose === 'vision' ? 'vision' : 'standard' };
  const model = (override && override.model) || (purpose === 'vision' ? (ai.visionProvider === provider ? ai.visionModel : '') : (ai.textProvider === provider ? ai.textModel : '')) || ai.models[provider] || '';
  if (!model) throw new Error(`Choose a model for ${PROVIDERS[provider] ? PROVIDERS[provider].label : provider} in Settings → Offline engines.`);
  return { provider, model };
}

function isReasoningOpenAI(model) { return /^(o\d|gpt-5)/i.test(model); }

function oaMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.images && m.images.length) {
      const parts = [{ type: 'text', text: m.content || '' }];
      for (const im of m.images) parts.push({ type: 'image_url', image_url: { url: `data:${im.mime || 'image/jpeg'};base64,${im.data}` } });
      out.push({ role: m.role, content: parts });
    } else if (m.audio && m.audio.length) {
      const parts = [{ type: 'text', text: m.content || '' }];
      for (const a of m.audio) parts.push({ type: 'input_audio', input_audio: { data: a.data, format: /wav/.test(a.mime || '') ? 'wav' : 'mp3' } });
      out.push({ role: m.role, content: parts });
    } else out.push({ role: m.role, content: m.content || '' });
  }
  return out;
}

async function readSSE(res, onData, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    if (signal && signal.aborted) { try { reader.cancel(); } catch (_) { /* ignore */ } throw net.cancelled(); }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (d === '[DONE]') return;
      try { onData(JSON.parse(d)); } catch (_) { /* partial */ }
    }
  }
}

async function postStream(url, headers, body, signal, label) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal && signal.aborted) throw net.cancelled();
    throw new Error(`${label}: network error — ${e.message}`);
  }
  if (!res.ok) {
    const t = await res.text();
    let b = t;
    try { b = JSON.parse(t); } catch (_) { /* text */ }
    throw Object.assign(new Error(`${label}: ${net.errorMessage(b, res.status)}`), { status: res.status });
  }
  return res;
}

async function chatOpenAICompat(provider, o) {
  const p = PROVIDERS[provider];
  const key = keyFor(provider);
  const base = p.base();
  if (!base) throw new Error(`Set the server address for ${p.label} in Settings → Offline engines.`);
  const headers = Object.assign({}, p.headers || {});
  if (key && key !== 'local') headers.Authorization = 'Bearer ' + key;
  const body = { model: o.model, messages: oaMessages(o.system, o.messages) };
  if (provider === 'openai' && isReasoningOpenAI(o.model)) {
    body.max_completion_tokens = o.maxTokens || 8000;
  } else {
    body.max_tokens = o.maxTokens || 4000;
    body.temperature = o.temperature === undefined ? store.getSettings().ai.temperature : o.temperature;
  }
  if (o.json && p.jsonMode) body.response_format = { type: 'json_object' };
  const url = base + '/chat/completions';
  if (o.onToken) {
    body.stream = true;
    const res = await postStream(url, headers, body, o.signal, p.label);
    let text = '';
    await readSSE(res, (d) => {
      const t = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
      if (t) { text += t; o.onToken(t, text); }
    }, o.signal);
    return { text };
  }
  const j = await net.json(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: o.signal, label: p.label });
  const c = j.choices && j.choices[0];
  const text = c && c.message ? (typeof c.message.content === 'string' ? c.message.content : (c.message.content || []).map((x) => x.text || '').join('')) : '';
  return { text: text || '', usage: j.usage };
}

/** Built-in AI through the Vid Vision gateway (no key on this PC). */
async function chatCloud(o) {
  const body = { model: o.model === 'vision' ? 'vv-vision' : 'vv-text', messages: oaMessages(o.system, o.messages), max_tokens: o.maxTokens || 4000 };
  if (o.temperature !== undefined) body.temperature = o.temperature;
  if (o.json) body.response_format = { type: 'json_object' };
  const init = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: o.signal });
  if (o.onToken) {
    body.stream = true;
    const res = await cloud.request('/v1/chat/completions', init(body), 'raw');
    let text = '';
    await readSSE(res, (d) => {
      const t = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
      if (t) { text += t; o.onToken(t, text); }
    }, o.signal);
    return { text };
  }
  const j = await cloud.request('/v1/chat/completions', init(body));
  const c = j.choices && j.choices[0];
  const text = c && c.message ? (typeof c.message.content === 'string' ? c.message.content : (c.message.content || []).map((x) => x.text || '').join('')) : '';
  if (!text && c && c.finish_reason === 'content_filter') throw new Error('The AI declined this request. Try rewording it.');
  return { text: text || '', usage: j.usage };
}

async function chatAnthropic(o) {
  const key = keyFor('anthropic');
  const msgs = o.messages.map((m) => {
    if (m.images && m.images.length) {
      return { role: m.role, content: m.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime || 'image/jpeg', data: im.data } })).concat([{ type: 'text', text: m.content || '' }]) };
    }
    return { role: m.role, content: m.content || '' };
  });
  const system = o.json ? `${o.system || ''}\n\nRespond with valid JSON only. No prose, no code fences.`.trim() : o.system;
  const body = { model: o.model, max_tokens: o.maxTokens || 8000, messages: msgs };
  if (system) body.system = system;
  if (o.temperature !== undefined) body.temperature = o.temperature;
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (o.onToken) {
    body.stream = true;
    const res = await postStream('https://api.anthropic.com/v1/messages', headers, body, o.signal, 'Claude');
    let text = '';
    await readSSE(res, (d) => {
      if (d.type === 'content_block_delta' && d.delta && d.delta.text) { text += d.delta.text; o.onToken(d.delta.text, text); }
    }, o.signal);
    return { text };
  }
  const j = await net.json('https://api.anthropic.com/v1/messages', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: o.signal, label: 'Claude' });
  return { text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''), usage: j.usage };
}

function geminiContents(messages) {
  return messages.map((m) => {
    const parts = [];
    for (const im of m.images || []) parts.push({ inline_data: { mime_type: im.mime || 'image/jpeg', data: im.data } });
    for (const f of m.files || []) parts.push({ file_data: { mime_type: f.mime, file_uri: f.uri } });
    for (const a of m.audio || []) parts.push({ inline_data: { mime_type: a.mime || 'audio/mpeg', data: a.data } });
    parts.push({ text: m.content || '' });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
}

async function chatGemini(o) {
  const key = keyFor('gemini');
  const body = { contents: geminiContents(o.messages), generationConfig: { maxOutputTokens: o.maxTokens || 8192 } };
  if (o.temperature !== undefined) body.generationConfig.temperature = o.temperature;
  if (o.json) body.generationConfig.responseMimeType = 'application/json';
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}`;
  const headers = { 'x-goog-api-key': key };
  if (o.onToken) {
    const res = await postStream(base + ':streamGenerateContent?alt=sse', headers, body, o.signal, 'Gemini');
    let text = '';
    await readSSE(res, (d) => {
      const parts = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
      const t = parts ? parts.map((p) => p.text || '').join('') : '';
      if (t) { text += t; o.onToken(t, text); }
    }, o.signal);
    return { text };
  }
  const j = await net.json(base + ':generateContent', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: o.signal, label: 'Gemini' });
  const cand = j.candidates && j.candidates[0];
  if (!cand || !cand.content) {
    const reason = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || 'no content';
    throw new Error('Gemini returned no text (' + reason + ').');
  }
  return { text: (cand.content.parts || []).map((p) => p.text || '').join(''), usage: j.usageMetadata };
}

/**
 * Chat completion.
 * @param {{purpose?:'text'|'vision', provider?:string, model?:string, system?:string, messages:Array, json?:boolean, maxTokens?:number, temperature?:number, onToken?:Function, signal?:AbortSignal}} o
 */
async function chat(o) {
  const sel = pick(o.purpose || ((o.messages || []).some((m) => m.images && m.images.length) ? 'vision' : 'text'), o);
  const opts = Object.assign({}, o, sel);
  if (sel.provider === 'builtin') return Object.assign(await chatCloud(opts), sel);
  if (sel.provider === 'anthropic') return Object.assign(await chatAnthropic(opts), sel);
  if (sel.provider === 'gemini') return Object.assign(await chatGemini(opts), sel);
  return Object.assign(await chatOpenAICompat(sel.provider, opts), sel);
}

/** Extract JSON from model output (handles code fences / leading prose). */
function parseJSON(text) {
  let t = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (_) { /* fallthrough */ }
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  const start = firstArr >= 0 && (firstArr < firstObj || firstObj < 0) ? firstArr : firstObj;
  if (start < 0) throw new Error('The AI did not return JSON.');
  const open = t[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return JSON.parse(t.slice(start, i + 1)); }
  }
  throw new Error('The AI returned incomplete JSON. Try again or use a larger model.');
}

/** Chat that must return JSON; retries once with a stricter instruction. */
async function chatJSON(o) {
  const sys = `${o.system || ''}\n\nReturn ONLY valid JSON (no markdown, no commentary).`.trim();
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await chat(Object.assign({}, o, { system: attempt ? sys + ' Your previous reply was not valid JSON.' : sys, json: true, onToken: undefined }));
    try { return Object.assign({ data: parseJSON(r.text) }, r); } catch (e) { last = e; }
  }
  throw last;
}

async function listModels(provider) {
  const p = PROVIDERS[provider];
  if (!p) return [];
  if (provider === 'builtin') return ['standard', 'vision'];
  if (provider === 'anthropic') {
    const j = await net.json('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': keyFor('anthropic'), 'anthropic-version': '2023-06-01' }, label: 'Claude' });
    return (j.data || []).map((m) => m.id);
  }
  if (provider === 'gemini') {
    const j = await net.json('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': keyFor('gemini') }, label: 'Gemini' });
    return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  }
  if (provider === 'ollama') {
    const j = await net.json(store.getSettings().ai.ollamaUrl.replace(/\/+$/, '') + '/api/tags', { label: 'Ollama', timeout: 5000 });
    return (j.models || []).map((m) => m.name);
  }
  const key = keyFor(provider);
  const headers = {};
  if (key && key !== 'local') headers.Authorization = 'Bearer ' + key;
  const j = await net.json(p.base() + '/models', { headers, label: p.label, timeout: 15000 });
  let ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
  if (provider === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search)/.test(id));
  return ids.sort();
}

/** Pull a model into Ollama with progress. */
async function ollamaPull(name, ctx) {
  const url = store.getSettings().ai.ollamaUrl.replace(/\/+$/, '') + '/api/pull';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, stream: true }), signal: ctx.signal });
  if (!res.ok) throw new Error('Ollama: could not start download (' + res.status + '). Is Ollama running?');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const d = JSON.parse(line);
        if (d.error) throw new Error('Ollama: ' + d.error);
        const pct = d.total ? (d.completed || 0) / d.total * 100 : 0;
        ctx.progress(pct, `${d.status || 'Downloading'}${d.total ? ` ${((d.completed || 0) / 1e9).toFixed(2)} / ${(d.total / 1e9).toFixed(2)} GB` : ''}`);
      } catch (e) { if (/Ollama:/.test(e.message)) throw e; }
    }
  }
  return { ok: true };
}

async function ollamaDelete(name) {
  const url = store.getSettings().ai.ollamaUrl.replace(/\/+$/, '') + '/api/delete';
  const r = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }) });
  if (!r.ok) throw new Error('Ollama could not delete ' + name);
  return { ok: true };
}

const OLLAMA_CATALOG = [
  { name: 'qwen2.5vl:3b', label: 'Qwen 2.5 VL 3B', kind: 'vision', gb: 3.2, note: 'Vision + text, runs on 4 GB GPUs' },
  { name: 'qwen2.5vl:7b', label: 'Qwen 2.5 VL 7B', kind: 'vision', gb: 6.0, note: 'Best local video analysis quality' },
  { name: 'gemma3:4b', label: 'Gemma 3 4B', kind: 'vision', gb: 3.3, note: 'Vision + text, fast' },
  { name: 'gemma3:12b', label: 'Gemma 3 12B', kind: 'vision', gb: 8.1, note: 'Vision + text, needs 12 GB+' },
  { name: 'llava:7b', label: 'LLaVA 7B', kind: 'vision', gb: 4.7, note: 'Classic vision model' },
  { name: 'qwen3:4b', label: 'Qwen 3 4B', kind: 'text', gb: 2.5, note: 'Fast writing + JSON' },
  { name: 'qwen3:8b', label: 'Qwen 3 8B', kind: 'text', gb: 5.2, note: 'Better writing quality' },
  { name: 'llama3.2:3b', label: 'Llama 3.2 3B', kind: 'text', gb: 2.0, note: 'Lightweight' },
  { name: 'gemma3:1b', label: 'Gemma 3 1B', kind: 'text', gb: 0.8, note: 'Tiny, for older PCs' },
  { name: 'mistral:7b', label: 'Mistral 7B', kind: 'text', gb: 4.1, note: 'Good general writer' },
];

// ---------- Gemini Files API (for "Watch with Gemini")
async function geminiUpload(file, mime, ctx) {
  const key = keyFor('gemini');
  const size = fs.statSync(file).size;
  const start = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { display_name: require('path').basename(file) } }),
    signal: ctx.signal,
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw new Error('Gemini: could not start the upload (' + start.status + ').');
  let sent = 0;
  const rs = fs.createReadStream(file);
  rs.on('data', (c) => { sent += c.length; ctx.progress((sent / size) * 60, `Uploading video to Google… ${(sent / 1e6).toFixed(0)} / ${(size / 1e6).toFixed(0)} MB`); });
  const up = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Length': String(size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: Readable.toWeb(rs), duplex: 'half', signal: ctx.signal });
  const j = await up.json();
  if (!up.ok || !j.file) throw new Error('Gemini upload failed: ' + net.errorMessage(j, up.status));
  let f = j.file;
  while (f.state === 'PROCESSING') {
    ctx.check();
    ctx.progress(65, 'Google is processing the video…');
    await new Promise((r) => setTimeout(r, 4000));
    f = await net.json(`https://generativelanguage.googleapis.com/v1beta/${f.name}`, { headers: { 'x-goog-api-key': key }, label: 'Gemini' });
  }
  if (f.state !== 'ACTIVE') throw new Error('Gemini could not process this video (' + f.state + ').');
  return { uri: f.uri, mime: f.mimeType || mime, name: f.name };
}

/** True when a provider can be used right now without asking the user for anything. */
function ready(provider) {
  const p = PROVIDERS[provider];
  if (!p) return false;
  if (p.local) return true;
  if (p.cloud) return cloud.enabled();
  return provider === 'custom' ? Boolean(store.getSettings().ai.customBaseUrl) : Boolean(store.getSecret(provider));
}

module.exports = { PROVIDERS, OLLAMA_CATALOG, ready, chat, chatJSON, parseJSON, listModels, ollamaPull, ollamaDelete, pick, geminiUpload, keyFor };
