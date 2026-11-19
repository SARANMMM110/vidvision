'use strict';
// Image generation: built-in AI (default, no keys, plan credits) or — in advanced mode — OpenAI, Google Gemini,
// OpenRouter, fal.ai with your own keys.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const net = require('./util/net');
const cloud = require('./cloud');

const PROVIDERS = { builtin: 'Built-in AI', openai: 'OpenAI', gemini: 'Google Gemini', openrouter: 'OpenRouter', fal: 'fal.ai' };

function need(key, label) {
  const k = store.getSecret(key);
  if (!k) throw new Error(`Add your ${label} API key in Settings → AI keys.`);
  return k;
}

function aspectOf(size) {
  const [w, h] = String(size || '1024x1024').split('x').map(Number);
  if (!w || !h) return '1:1';
  const r = w / h;
  if (r > 1.6) return '16:9';
  if (r > 1.2) return '3:2';
  if (r < 0.62) return '9:16';
  if (r < 0.8) return '2:3';
  return '1:1';
}

async function openai(prompt, o, ctx) {
  const key = need('openai', 'OpenAI');
  const j = await net.json('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: o.model, prompt, size: o.size || '1024x1024', quality: o.quality || 'high', n: 1 }),
    signal: ctx && ctx.signal,
    label: 'OpenAI Images',
  });
  const d = j.data && j.data[0];
  if (d && d.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d && d.url) return net.buffer(d.url);
  throw new Error('OpenAI returned no image.');
}

async function gemini(prompt, o, ctx) {
  const key = need('gemini', 'Google Gemini');
  const body = { contents: [{ parts: [{ text: `${prompt}\n\nAspect ratio: ${aspectOf(o.size)}.` }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
  const j = await net.json(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctx && ctx.signal, label: 'Gemini Images' });
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const img = parts.find((p) => p.inlineData || p.inline_data);
  if (!img) throw new Error('Gemini returned no image (it may have refused the prompt).');
  return Buffer.from((img.inlineData || img.inline_data).data, 'base64');
}

async function openrouter(prompt, o, ctx) {
  const key = need('openrouter', 'OpenRouter');
  const j = await net.json('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Vid Vision' },
    body: JSON.stringify({ model: o.model, modalities: ['image', 'text'], messages: [{ role: 'user', content: `${prompt}\n\nAspect ratio: ${aspectOf(o.size)}.` }] }),
    signal: ctx && ctx.signal,
    label: 'OpenRouter Images',
  });
  const msg = j.choices && j.choices[0] && j.choices[0].message;
  const url = msg && msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url;
  if (!url) throw new Error('OpenRouter returned no image. Pick an image-capable model.');
  if (url.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
  return net.buffer(url);
}

async function fal(prompt, o, ctx) {
  const key = need('fal', 'fal.ai');
  const map = { '1:1': 'square_hd', '16:9': 'landscape_16_9', '3:2': 'landscape_4_3', '9:16': 'portrait_16_9', '2:3': 'portrait_4_3' };
  const j = await net.json(`https://fal.run/${o.model}`, { method: 'POST', headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, image_size: map[aspectOf(o.size)] || 'square_hd', num_images: 1 }), signal: ctx && ctx.signal, label: 'fal.ai' });
  const url = j.images && j.images[0] && j.images[0].url;
  if (!url) throw new Error('fal.ai returned no image.');
  return url.startsWith('data:') ? Buffer.from(url.split(',')[1], 'base64') : net.buffer(url);
}

async function builtin(prompt, o, ctx) {
  const j = await cloud.request('/v1/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ prompt, size: o.size || '1024x1024' }, o.style ? { style: o.style } : {})), signal: ctx && ctx.signal });
  const d = j.data && j.data[0];
  if (!d || !d.b64_json) throw new Error('The AI returned no image (it may have declined the prompt). Try rewording it.');
  return Buffer.from(d.b64_json, 'base64');
}

const FN = { builtin, openai, gemini, openrouter, fal };

/**
 * Generate an image and save it to outDir.
 * @returns {Promise<string>} file path
 */
async function generate(prompt, o, outDir, ctx) {
  const s = store.getSettings().images;
  const provider = o.provider || s.provider || 'builtin';
  if (!FN[provider]) throw new Error('Unknown image provider ' + provider);
  const model = o.model || (s.models && s.models[provider]);
  ctx && ctx.progress(20, provider === 'builtin' ? 'Generating image…' : `Generating image with ${PROVIDERS[provider]}…`);
  const buf = await FN[provider](prompt, Object.assign({}, o, { model }), ctx);
  fs.mkdirSync(outDir, { recursive: true });
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  const file = path.join(outDir, `image_${Date.now()}.${isJpg ? 'jpg' : 'png'}`);
  fs.writeFileSync(file, buf);
  return file;
}

module.exports = { PROVIDERS, generate, aspectOf };
