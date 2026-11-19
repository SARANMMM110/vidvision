// Hidden engine window: Kokoro TTS + NLLB-200 offline translation via ONNX Runtime Web (WebGPU when available, else WASM).
/* global engineHost */
import { KokoroTTS, env as kenv } from './vendor/kokoro.web.js';
import { pipeline, env } from './vendor/transformers.min.js';

const ORT = new URL('./vendor/ort/', location.href).href;
kenv.wasmPaths = ORT;
env.backends.onnx.wasm.wasmPaths = ORT;
env.allowLocalModels = false;
env.useBrowserCache = true;

let webgpu = false;
let kokoro = null;
let kokoroDevice = '';
let translator = null;

async function detectGpu() {
  try {
    if (!navigator.gpu) return false;
    const a = await navigator.gpu.requestAdapter();
    return Boolean(a);
  } catch (_) { return false; }
}

function progressFor(id, label) {
  const seen = {};
  return (p) => {
    if (p.status === 'progress' && p.total) {
      seen[p.file] = [p.loaded || 0, p.total];
      let got = 0;
      let tot = 0;
      for (const k of Object.keys(seen)) { got += seen[k][0]; tot += seen[k][1]; }
      engineHost.progress(id, tot ? (got / tot) * 100 : 0, `${label} ${(got / 1e6).toFixed(0)} / ${(tot / 1e6).toFixed(0)} MB (first use only)`);
    } else if (p.status === 'ready') {
      engineHost.progress(id, 100, `${label.replace('Downloading', 'Loaded')}`);
    }
  };
}

async function getKokoro(id) {
  if (kokoro) return kokoro;
  const device = webgpu ? 'webgpu' : 'wasm';
  kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: webgpu ? 'fp32' : 'q8', device, progress_callback: progressFor(id, 'Downloading Kokoro voices…') });
  kokoroDevice = device;
  return kokoro;
}

async function getTranslator(id) {
  if (translator) return translator;
  translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', { dtype: 'q8', progress_callback: progressFor(id, 'Downloading offline translator…') });
  return translator;
}

async function cachedCount() {
  try {
    const c = await caches.open('transformers-cache');
    return (await c.keys()).length;
  } catch (_) { return 0; }
}

const TASKS = {
  async kokoro(id, { text, voice, speed }) {
    const tts = await getKokoro(id);
    engineHost.progress(id, 50, `Speaking with Kokoro (${kokoroDevice === 'webgpu' ? 'GPU' : 'CPU'})…`);
    const audio = await tts.generate(text, { voice, speed: speed || 1 });
    return { audio: audio.audio, sampleRate: audio.sampling_rate };
  },
  async translate(id, { texts, src, tgt }) {
    const t = await getTranslator(id);
    const out = [];
    for (const s of texts) {
      if (!String(s || '').trim()) { out.push(s); continue; }
      const r = await t(s, { src_lang: src, tgt_lang: tgt, max_length: 512 });
      out.push(Array.isArray(r) ? r[0].translation_text : r.translation_text);
    }
    return { texts: out };
  },
  async status() {
    return { webgpu, cached: await cachedCount(), kokoroLoaded: Boolean(kokoro), translatorLoaded: Boolean(translator) };
  },
  async clear() {
    kokoro = null;
    translator = null;
    try { await caches.delete('transformers-cache'); } catch (_) { /* ignore */ }
    return { ok: true };
  },
  // Diagram (Mermaid) → PNG, fully offline. htmlLabels off so the SVG can be drawn on a canvas.
  async mermaid(id, { code, width = 1600, primary = '#6d5efc', accent = '#22d3ee' }) {
    if (!window.mermaid) {
      await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = new URL('./vendor/mermaid.min.js', location.href).href; s.onload = resolve; s.onerror = () => reject(new Error('Diagram engine missing.')); document.head.appendChild(s); });
    }
    // Calm, print-friendly palette built from the brand colours (mind maps, pies and timelines use the cScale).
    const mix = (hex, a) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * a)); return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); };
    const palette = [primary, accent, '#f2a541', '#35c9b5', '#e86fa4', '#8b7cf6', '#4f9cf9', '#7bc67e', '#f08a5d', '#b38bd9', '#5cc8c8', '#d9a441'];
    const vars = { fontFamily: 'Segoe UI, Arial, sans-serif', primaryColor: mix(primary, 0.86), primaryBorderColor: primary, primaryTextColor: '#1b1e2e', lineColor: '#5b6075', secondaryColor: mix(accent, 0.82), tertiaryColor: '#f6f7fb', noteBkgColor: '#fff8e6', noteBorderColor: '#f2b84b' };
    palette.forEach((c, i) => { vars['cScale' + i] = mix(c, 0.55); vars['cScaleLabel' + i] = '#1b1e2e'; vars['pie' + (i + 1)] = c; });
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: vars, htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: 'Segoe UI, Arial, sans-serif' });
    const { svg } = await window.mermaid.render('d' + id + Date.now(), String(code));
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const el = doc.documentElement;
    const vb = (el.getAttribute('viewBox') || '0 0 800 600').split(/[\s,]+/).map(Number);
    const scale = Math.min(4, width / (vb[2] || 800));
    const W = Math.round((vb[2] || 800) * scale);
    const H = Math.round((vb[3] || 600) * scale);
    el.setAttribute('width', W); el.setAttribute('height', H);
    const xml = new XMLSerializer().serializeToString(el);
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('The diagram could not be drawn.')); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml))); });
    const c = document.createElement('canvas');
    c.width = W + 80; c.height = H + 80;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 40, 40, W, H);
    // Some diagram kinds (mindmaps) embed HTML, which taints the canvas — then the app rasterises the SVG itself.
    let png = '';
    try { png = c.toDataURL('image/png').split(',')[1]; } catch (_) { /* tainted */ }
    return { png, svg: xml, width: c.width, height: c.height };
  },
};

(async () => {
  webgpu = await detectGpu();
  engineHost.onTask(async (id, task, payload) => {
    try {
      const fn = TASKS[task];
      if (!fn) throw new Error('Unknown engine task ' + task);
      engineHost.result(id, true, await fn(id, payload || {}));
    } catch (e) {
      // If WebGPU failed for Kokoro, retry once on CPU.
      if (task === 'kokoro' && kokoroDevice === 'webgpu') {
        try {
          kokoro = null; webgpu = false;
          engineHost.result(id, true, await TASKS.kokoro(id, payload));
          return;
        } catch (e2) { engineHost.result(id, false, { message: String(e2 && e2.message ? e2.message : e2) }); return; }
      }
      engineHost.result(id, false, { message: String(e && e.message ? e.message : e) });
    }
  });
  engineHost.ready();
})();
