'use strict';
// yt-dlp wrapper: metadata, downloads (video/audio), captions, playlist/channel/search listing.
const fs = require('fs');
const path = require('path');
const bins = require('./bins');
const store = require('./store');
const P = require('./paths');
const proc = require('./util/proc');

/** Netscape cookies written after "Sign in to Instagram/TikTok" (see social.js). Used only for those sites. */
function cookieFile() { return path.join(P.userData(), 'social-cookies.txt'); }

function baseArgs() {
  const s = store.getSettings();
  const a = ['--no-warnings', '--no-color', '--no-check-certificates'];
  if (s.network && s.network.proxy) a.push('--proxy', s.network.proxy);
  if (fs.existsSync(cookieFile())) a.push('--cookies', cookieFile());
  const ff = bins.ff('ffmpeg');
  if (ff) a.push('--ffmpeg-location', path.dirname(ff));
  return a;
}

function friendly(err) {
  const s = String((err && (err.stderr || err.message)) || err);
  if (/Unsupported URL/i.test(s)) return 'This link is not supported.';
  if (/Private video|Sign in to confirm|login required|age/i.test(s)) return 'This video needs a login or is private/age-restricted.';
  if (/HTTP Error 429|Too Many Requests/i.test(s)) return 'The site is rate-limiting downloads. Wait a few minutes or set a proxy in Settings → Network.';
  if (/not available in your country|geo/i.test(s)) return 'This video is blocked in your country. Set a proxy in Settings → Network.';
  const line = s.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop();
  return line ? line.replace(/^.*ERROR:\s*/, '') : s.split(/\r?\n/).slice(-1)[0];
}

async function ytJson(args, ctx) {
  const y = await bins.ytdlp(ctx);
  const r = await proc.run(y, baseArgs().concat(args), { signal: ctx && ctx.signal, maxBuffer: 256 * 1024 * 1024 });
  if (r.code !== 0 && !r.stdout.trim()) throw new Error(friendly({ stderr: r.stderr }));
  const out = r.stdout.trim();
  // -J prints one JSON doc; --dump-json prints one per line.
  try { return JSON.parse(out); } catch (_) {
    return out.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } }).filter(Boolean);
  }
}

/** Single video metadata. */
async function info(url, ctx) {
  const j = await ytJson(['-J', '--no-playlist', '--skip-download', url], ctx);
  return normalizeEntry(j);
}

function bestThumb(e) {
  if (e.thumbnail) return e.thumbnail;
  const t = (e.thumbnails || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return t ? t.url : '';
}

function normalizeEntry(e) {
  if (!e) return null;
  const url = e.webpage_url || e.original_url || e.url || (e.id && e.ie_key === 'Youtube' ? `https://www.youtube.com/watch?v=${e.id}` : '');
  let up = e.upload_date || '';
  if (!up && e.timestamp) up = new Date(e.timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  return {
    id: e.id,
    url: /^https?:/.test(url) ? url : (e.id ? `https://www.youtube.com/watch?v=${e.id}` : url),
    title: e.title || e.fulltitle || '',
    channel: e.channel || e.uploader || '',
    channelUrl: e.channel_url || e.uploader_url || '',
    followers: e.channel_follower_count || 0,
    duration: e.duration || 0,
    views: e.view_count || 0,
    likes: e.like_count || 0,
    comments: e.comment_count || 0,
    reposts: e.repost_count || 0,
    uploadDate: up,
    thumbnail: bestThumb(e),
    description: (e.description || '').slice(0, 2000),
    tags: e.tags || [],
    extractor: e.extractor_key || e.ie_key || '',
    license: e.license || '',
    isLive: Boolean(e.is_live),
  };
}

/** List entries of a playlist/channel/search URL without downloading. */
async function flat(url, limit, ctx) {
  const args = ['-J', '--flat-playlist', '--skip-download'];
  if (limit) args.push('--playlist-end', String(limit));
  args.push(url);
  const j = await ytJson(args, ctx);
  const entries = Array.isArray(j) ? j : (j.entries || [j]);
  return entries.map(normalizeEntry).filter((e) => e && e.url);
}

/** Enrich a list of entries with full metadata (views/likes/comments/date), limited concurrency. */
async function enrich(entries, ctx, concurrency = 4) {
  const out = entries.slice();
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < out.length) {
      const k = i++;
      if (ctx && ctx.signal.aborted) return;
      try {
        const full = await info(out[k].url, null);
        out[k] = Object.assign({}, out[k], full, { title: full.title || out[k].title });
      } catch (_) { /* keep flat data */ }
      done++;
      ctx && ctx.progress(30 + (done / out.length) * 70, `Reading stats ${done}/${out.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, out.length) }, worker));
  return out;
}

/**
 * Download media.
 * @param {string} url
 * @param {{dir?:string, audioOnly?:boolean, audioFormat?:string, maxHeight?:number, filename?:string}} o
 * @returns {Promise<string>} final file path
 */
async function fetchMedia(url, o, ctx) {
  const y = await bins.ytdlp(ctx);
  await bins.ffmpeg(ctx);
  const dir = o.dir || P.downloads();
  fs.mkdirSync(dir, { recursive: true });
  const tpl = path.join(dir, (o.filename || '%(title).120B [%(id)s]') + '.%(ext)s');
  const args = baseArgs().concat(['--no-playlist', '--newline', '--restrict-filenames', '-o', tpl, '--print', 'after_move:filepath']);
  if (o.audioOnly) {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', o.audioFormat || 'mp3', '--audio-quality', '0');
  } else {
    const h = o.maxHeight || 1080;
    args.push('-f', `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`, '--merge-output-format', 'mp4');
  }
  args.push(url);
  let finalPath = '';
  let phase = 0;
  const r = await proc.run(y, args, {
    signal: ctx && ctx.signal,
    onStdout: (line) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m && ctx) {
        const pct = Number(m[1]);
        if (pct < 1 && phase === 0) phase = 0;
        ctx.progress(Math.min(99, pct), `Downloading… ${pct.toFixed(0)}%`);
      } else if (/\[(Merger|ExtractAudio|VideoConvertor)\]/.test(line) && ctx) {
        ctx.progress(99, 'Finishing download…');
      } else if (!line.startsWith('[') && fs.existsSync(line.trim())) {
        finalPath = line.trim();
      }
    },
  });
  if (r.code !== 0 || !finalPath) throw new Error('Download failed: ' + friendly({ stderr: r.stderr }));
  return finalPath;
}

/** Download platform captions (manual or automatic) as VTT. Returns {file, lang} or null. */
async function captions(url, lang, ctx) {
  const y = await bins.ytdlp(ctx);
  const dir = P.tempDir('subs');
  const langs = lang && lang !== 'auto' ? `${lang}.*,${lang}` : 'en.*,en';
  const r = await proc.run(y, baseArgs().concat(['--no-playlist', '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', langs, '--sub-format', 'vtt/best', '--convert-subs', 'vtt', '-o', path.join(dir, 'cap.%(ext)s'), url]), { signal: ctx && ctx.signal });
  if (r.code !== 0) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.vtt'));
  if (!files.length) return null;
  // Prefer manual subs (no "-orig"/auto marker) — yt-dlp names both cap.<lang>.vtt; pick first.
  const f = files.sort((a, b) => a.length - b.length)[0];
  const m = /cap\.([^.]+)/.exec(f);
  return { file: path.join(dir, f), lang: m ? m[1].split('-')[0] : (lang || 'en') };
}

// ---------- Discover (YouTube search via result pages)
const SEARCH_FILTERS = {
  any: '',
  hour: 'EgIIAQ%3D%3D',
  today: 'EgIIAg%3D%3D',
  week: 'EgIIAw%3D%3D',
  month: 'EgIIBA%3D%3D',
  year: 'EgIIBQ%3D%3D',
  cc: 'EgIwAQ%3D%3D',
  short: 'EgIYAQ%3D%3D',
  long: 'EgIYAg%3D%3D',
  views: 'CAM%3D',
  newest: 'CAI%3D',
};

async function searchYouTube(query, { market = 'US', lang = 'en', filter = 'any', limit = 30, enrichTop = 20 } = {}, ctx) {
  const sp = SEARCH_FILTERS[filter] || '';
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${sp ? '&sp=' + sp : ''}&gl=${encodeURIComponent(market)}&hl=${encodeURIComponent(lang)}`;
  ctx && ctx.progress(5, 'Searching…');
  let list = await flat(url, limit, ctx);
  list = list.filter((e) => /youtube\.com\/(watch|shorts)|youtu\.be/.test(e.url));
  ctx && ctx.progress(30, `Found ${list.length} videos`);
  if (enrichTop) {
    const top = await enrich(list.slice(0, enrichTop), ctx);
    list = top.concat(list.slice(enrichTop));
  }
  return list;
}

const SOCIAL_AGE = { week: 7, month: 31, year: 366 };
function socialFilter(list, filter) {
  const now = Date.now();
  return list.filter((e) => {
    if (filter === 'short') return !e.duration || e.duration < 60;
    if (filter === 'long') return e.duration >= 180;
    if (SOCIAL_AGE[filter] && e.uploadDate && e.uploadDate.length === 8) {
      const d = Date.UTC(+e.uploadDate.slice(0, 4), +e.uploadDate.slice(4, 6) - 1, +e.uploadDate.slice(6, 8));
      return (now - d) / 86400000 <= SOCIAL_AGE[filter];
    }
    return true;
  });
}

/** TikTok: "#tag" / topic → hashtag page, "@user" → profile. */
function tiktokUrl(q) {
  const s = String(q || '').trim();
  if (/^https?:/i.test(s)) return s;
  if (s.startsWith('@')) return `https://www.tiktok.com/${s.split(/\s+/)[0]}`;
  const tag = s.replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');
  if (!tag) throw new Error('Type a hashtag, topic or @creator.');
  return `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`;
}

/** Instagram: "#tag" / topic → tag page, "@user" → account. Instagram usually needs "Sign in to Instagram". */
function instagramUrl(q) {
  const s = String(q || '').trim();
  if (/^https?:/i.test(s)) return s;
  if (s.startsWith('@')) return `https://www.instagram.com/${encodeURIComponent(s.slice(1).split(/\s+/)[0])}/`;
  const tag = s.replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');
  if (!tag) throw new Error('Type a hashtag or @account.');
  return `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
}

async function searchSocial(platform, query, { limit = 30, filter = 'any', enrichTop = 15 } = {}, ctx) {
  const url = platform === 'tiktok' ? tiktokUrl(query) : instagramUrl(query);
  ctx && ctx.progress(5, `Searching ${platform === 'tiktok' ? 'TikTok' : 'Instagram'}…`);
  let list;
  try {
    list = await flat(url, limit, ctx);
  } catch (e) {
    const msg = String(e.message || e);
    if (/login|log in|cookies|rate|429|empty|captcha|private/i.test(msg)) throw new Error(`${platform === 'tiktok' ? 'TikTok' : 'Instagram'} asked for a sign-in or a captcha. Click "Sign in to ${platform === 'tiktok' ? 'TikTok' : 'Instagram'}" above, then search again.`);
    throw e;
  }
  if (!list.length) throw new Error(`No public videos found for "${query}". Try another hashtag, or sign in to ${platform === 'tiktok' ? 'TikTok' : 'Instagram'}.`);
  ctx && ctx.progress(30, `Found ${list.length} videos`);
  if (enrichTop) {
    const top = await enrich(list.slice(0, enrichTop), ctx, 3);
    list = top.concat(list.slice(enrichTop));
  }
  return socialFilter(list, filter);
}

/** Score + sort Discover results by ranking mode. */
function rank(list, mode) {
  const now = Date.now();
  const age = (e) => {
    if (!e.uploadDate || e.uploadDate.length !== 8) return 365;
    const d = Date.UTC(+e.uploadDate.slice(0, 4), +e.uploadDate.slice(4, 6) - 1, +e.uploadDate.slice(6, 8));
    return Math.max(0.5, (now - d) / 86400000);
  };
  const f = {
    relevance: () => 0,
    standout: (e) => (e.followers ? e.views / e.followers : e.views / 10000),
    fastest: (e) => e.views / age(e),
    views: (e) => e.views,
    likes: (e) => e.likes,
    discussed: (e) => e.comments,
    engagement: (e) => (e.views ? (e.likes + e.comments * 2) / e.views : 0),
    newest: (e) => -age(e),
    gems: (e) => (e.followers && e.followers < 50000 ? e.views / Math.max(1, e.followers) : 0),
    rising: (e) => (age(e) <= 30 ? e.views / age(e) : 0),
    shared: (e) => e.reposts || (e.views ? e.comments / e.views : 0),
    following: (e) => e.followers || 0,
    longest: (e) => e.duration || 0,
  }[mode] || (() => 0);
  if (mode === 'channel') return list.slice().sort((a, b) => String(a.channel || '').localeCompare(String(b.channel || '')) || (b.views - a.views));
  const scored = list.map((e, i) => Object.assign({}, e, { score: f(e), _i: i }));
  if (mode === 'relevance' || !mode) return scored;
  return scored.sort((a, b) => (b.score - a.score) || (a._i - b._i));
}

module.exports = { info, flat, enrich, fetchMedia, captions, searchYouTube, searchSocial, tiktokUrl, instagramUrl, cookieFile, rank, normalizeEntry, friendly, SEARCH_FILTERS };
