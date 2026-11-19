'use strict';
// English text → Kokoro phonemes (espeak-ng IPA via `phonemizer`, adjusted to Kokoro's conventions).
// Text normalisation and phoneme fix-ups are adapted from kokoro-js (Apache-2.0, © hexgrad / Xenova).
// Reading every word this way means no word is ever skipped (the bundled lexicon misses many words).

function splitNum(e) {
  if (e.includes('.')) return e;
  if (e.includes(':')) { const [a, t] = e.split(':').map(Number); return t === 0 ? `${a} o'clock` : t < 10 ? `${a} oh ${t}` : `${a} ${t}`; }
  const a = parseInt(e.slice(0, 4), 10);
  if (a < 1100 || a % 1000 < 10) return e;
  const t = e.slice(0, 2); const r = parseInt(e.slice(2, 4), 10); const n = e.endsWith('s') ? 's' : '';
  if (a % 1000 >= 100 && a % 1000 <= 999) { if (r === 0) return `${t} hundred${n}`; if (r < 10) return `${t} oh ${r}${n}`; }
  return `${t} ${r}${n}`;
}
function money(e) {
  const a = e[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${a}s`;
  if (!e.includes('.')) return `${e.slice(1)} ${a}${e.slice(1) === '1' ? '' : 's'}`;
  const [t, r] = e.slice(1).split('.'); const n = parseInt(r.padEnd(2, '0'), 10);
  return `${t} ${a}${t === '1' ? '' : 's'} and ${n} ${e[0] === '$' ? (n === 1 ? 'cent' : 'cents') : n === 1 ? 'penny' : 'pence'}`;
}
function point(e) { const [a, t] = e.split('.'); return `${a} point ${t.split('').join(' ')}`; }

function normalise(e) {
  return e.replace(/[‘’]/g, "'").replace(/«/g, '“').replace(/»/g, '”').replace(/[“”]/g, '"').replace(/\(/g, '«').replace(/\)/g, '»')
    .replace(/、/g, ', ').replace(/。/g, '. ').replace(/！/g, '! ').replace(/，/g, ', ').replace(/：/g, ': ').replace(/；/g, '; ').replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ').replace(/  +/, ' ').replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor').replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister').replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss').replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc').replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum).replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, money).replace(/\d*\.\d+/g, point)
    .replace(/(?<=\d)-(?=\d)/g, ' to ').replace(/(?<=\d)S/g, ' S').replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S").replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-')).replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-').trim();
}

const PUNCT = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g;
let ph = null;

/** English text → phoneme string for Kokoro. british = true for en-GB voices. */
async function phonemes(text, british) {
  if (!ph) ph = import('phonemizer').then((m) => m.phonemize);
  const fn = await ph;
  const t = normalise(String(text || ''));
  const parts = [];
  let last = 0;
  for (const m of t.matchAll(PUNCT)) { if (last < m.index) parts.push({ p: false, s: t.slice(last, m.index) }); if (m[0].length) parts.push({ p: true, s: m[0] }); last = m.index + m[0].length; }
  if (last < t.length) parts.push({ p: false, s: t.slice(last) });
  const lang = british ? 'en' : 'en-us';
  const out = (await Promise.all(parts.map(async ({ p, s }) => (p ? s : (await fn(s, lang)).join(' '))))).join('');
  let i = out.replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ').replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ').replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (!british) i = i.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return i.trim();
}

module.exports = { phonemes, normalise };
