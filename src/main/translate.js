'use strict';
// Translation that preserves timestamps/structure. Engines: AI model (any provider) or offline NLLB-200 (local, free).
const llm = require('./llm');
const engines = require('./engines');
const NLLB = require('../shared/nllb-languages');

const NAMES = new Map(NLLB);
const ISO_TO_NLLB = { en: 'eng_Latn', es: 'spa_Latn', fr: 'fra_Latn', de: 'deu_Latn', it: 'ita_Latn', pt: 'por_Latn', nl: 'nld_Latn', ru: 'rus_Cyrl', zh: 'zho_Hans', ja: 'jpn_Jpan', ko: 'kor_Hang', ar: 'arb_Arab', hi: 'hin_Deva', tr: 'tur_Latn', pl: 'pol_Latn', uk: 'ukr_Cyrl', vi: 'vie_Latn', id: 'ind_Latn', th: 'tha_Thai', sv: 'swe_Latn', da: 'dan_Latn', no: 'nob_Latn', fi: 'fin_Latn', el: 'ell_Grek', cs: 'ces_Latn', ro: 'ron_Latn', hu: 'hun_Latn', he: 'heb_Hebr', fa: 'pes_Arab', bn: 'ben_Beng', ur: 'urd_Arab', ta: 'tam_Taml', te: 'tel_Telu', mr: 'mar_Deva', gu: 'guj_Gujr', kn: 'kan_Knda', ml: 'mal_Mlym', pa: 'pan_Guru', ne: 'npi_Deva', si: 'sin_Sinh', ms: 'zsm_Latn', tl: 'tgl_Latn', sw: 'swh_Latn', af: 'afr_Latn', sq: 'als_Latn', am: 'amh_Ethi', hy: 'hye_Armn', az: 'azj_Latn', eu: 'eus_Latn', be: 'bel_Cyrl', bs: 'bos_Latn', bg: 'bul_Cyrl', ca: 'cat_Latn', hr: 'hrv_Latn', et: 'est_Latn', gl: 'glg_Latn', ka: 'kat_Geor', ha: 'hau_Latn', is: 'isl_Latn', jw: 'jav_Latn', kk: 'kaz_Cyrl', km: 'khm_Khmr', lo: 'lao_Laoo', lv: 'lvs_Latn', lt: 'lit_Latn', lb: 'ltz_Latn', mk: 'mkd_Cyrl', mt: 'mlt_Latn', mi: 'mri_Latn', mn: 'khk_Cyrl', my: 'mya_Mymr', ps: 'pbt_Arab', sr: 'srp_Cyrl', sn: 'sna_Latn', sd: 'snd_Arab', sk: 'slk_Latn', sl: 'slv_Latn', so: 'som_Latn', su: 'sun_Latn', tg: 'tgk_Cyrl', tt: 'tat_Cyrl', bo: 'bod_Tibt', tk: 'tuk_Latn', uz: 'uzn_Latn', cy: 'cym_Latn', yi: 'ydd_Hebr', yo: 'yor_Latn', yue: 'yue_Hant', ht: 'hat_Latn', ln: 'lin_Latn', oc: 'oci_Latn', ba: 'bak_Cyrl', fo: 'fao_Latn' };

function toNllb(code) {
  if (!code) return '';
  if (NAMES.has(code)) return code;
  return ISO_TO_NLLB[String(code).toLowerCase().split(/[-_]/)[0]] || '';
}

function name(code) { return NAMES.get(toNllb(code)) || code; }

function fileSuffix(code) {
  const c = toNllb(code) || code;
  const iso = Object.keys(ISO_TO_NLLB).find((k) => ISO_TO_NLLB[k] === c);
  return iso || c;
}

async function aiBatch(lines, target, source, ctx) {
  const tName = name(target);
  const r = await llm.chatJSON({
    purpose: 'text',
    system: `You are a professional subtitle translator. Translate each line into ${tName}${source ? ' from ' + name(source) : ''}. Keep meaning, tone and names. Keep the SAME number of lines in the SAME order — never merge or split lines. Return JSON: {"lines": ["..."]}.`,
    messages: [{ role: 'user', content: JSON.stringify({ lines }) }],
    maxTokens: 8000,
    signal: ctx && ctx.signal,
  });
  const out = r.data && Array.isArray(r.data.lines) ? r.data.lines : (Array.isArray(r.data) ? r.data : null);
  if (!out || out.length !== lines.length) return null;
  return out.map(String);
}

async function translateLines(lines, target, { engine = 'ai', source = '' } = {}, ctx) {
  if (!lines.length) return [];
  const st = require('./store').getSettings();
  if (st.privateMode && engine !== 'local') {
    // Private mode: a local AI model if one is running, otherwise the offline NLLB translator.
    const ol = await require('./bins').ollamaStatus(st.ai.ollamaUrl);
    if (!ol.running || !ol.models.length) engine = 'local';
  }
  if (engine === 'local') {
    const tgt = toNllb(target);
    const src = toNllb(source) || 'eng_Latn';
    if (!tgt) throw new Error('This language is not available offline: ' + target);
    const out = [];
    const B = 16;
    for (let i = 0; i < lines.length; i += B) {
      ctx && ctx.check && ctx.check();
      const res = await engines.run('translate', { texts: lines.slice(i, i + B), src, tgt }, ctx);
      out.push(...res.texts);
      ctx && ctx.progress && ctx.progress(((i + B) / lines.length) * 100, `Translating offline to ${name(tgt)}… ${Math.min(lines.length, i + B)}/${lines.length}`);
    }
    return out;
  }
  const out = [];
  const B = 50;
  for (let i = 0; i < lines.length; i += B) {
    ctx && ctx.check && ctx.check();
    const chunk = lines.slice(i, i + B);
    let tr = await aiBatch(chunk, target, source, ctx);
    if (!tr) tr = await aiBatch(chunk, target, source, ctx);
    if (!tr) {
      tr = [];
      for (const l of chunk) {
        const r = await llm.chat({ purpose: 'text', system: `Translate into ${name(target)}. Output only the translation.`, messages: [{ role: 'user', content: l }], signal: ctx && ctx.signal });
        tr.push(r.text.trim());
      }
    }
    out.push(...tr);
    ctx && ctx.progress && ctx.progress(Math.min(100, ((i + B) / lines.length) * 100), `Translating to ${name(target)}… ${Math.min(lines.length, i + B)}/${lines.length}`);
  }
  return out;
}

/** Translate timed segments, preserving timestamps. */
async function segments(segs, target, opts, ctx) {
  const t = await translateLines(segs.map((s) => s.text), target, opts, ctx);
  return segs.map((s, i) => Object.assign({}, s, { text: t[i] || s.text }));
}

/** Translate free text paragraph by paragraph. */
async function text(str, target, opts, ctx) {
  const paras = String(str).split(/\n/);
  const idx = [];
  const lines = [];
  paras.forEach((p, i) => { if (p.trim()) { idx.push(i); lines.push(p); } });
  const t = await translateLines(lines, target, opts, ctx);
  idx.forEach((pi, k) => { paras[pi] = t[k] || paras[pi]; });
  return paras.join('\n');
}

/** Translate a markdown document with the AI model (keeps formatting and image markers). */
async function markdown(md, target, ctx) {
  const parts = String(md).split(/\n(?=#{1,3} )/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    ctx && ctx.check && ctx.check();
    const r = await llm.chat({ purpose: 'text', system: `Translate this Markdown into ${name(target)}. Keep ALL Markdown syntax, image tags like ![..](frame:12.3), links and numbers exactly. Output only the translated Markdown.`, messages: [{ role: 'user', content: parts[i] }], maxTokens: 8000, signal: ctx && ctx.signal });
    out.push(r.text.trim());
    ctx && ctx.progress && ctx.progress(((i + 1) / parts.length) * 100, `Translating document to ${name(target)}…`);
  }
  return out.join('\n\n');
}

module.exports = { LANGUAGES: NLLB, toNllb, name, fileSuffix, translateLines, segments, text, markdown };
