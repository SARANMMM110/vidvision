'use strict';
// Background music (Jamendo, Creative Commons) and sound effects (Freesound) search + download.
// Searches go through the built-in AI service (no keys on this PC); advanced mode can use your own keys.
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const store = require('./store');
const net = require('./util/net');
const cloud = require('./cloud');

function cacheDir(kind) { return P.ensure(path.join(P.cache(), kind)); }

function own(key) { return cloud.advanced() && store.getSecret(key) ? store.getSecret(key) : ''; }

async function searchMusic(query, { limit = 24, tags = '' } = {}) {
  const id = own('jamendo');
  let j;
  if (id) {
    const params = new URLSearchParams({ client_id: id, format: 'json', limit: String(limit), include: 'musicinfo licenses', audioformat: 'mp32', order: 'popularity_total' });
    if (query) params.set('search', query);
    if (tags) params.set('fuzzytags', tags);
    j = await net.json('https://api.jamendo.com/v3.0/tracks/?' + params.toString(), { label: 'Jamendo' });
    if (j.headers && j.headers.status === 'failed') throw new Error('Jamendo: ' + (j.headers.error_message || 'request failed'));
  } else {
    j = await cloud.request('/v1/library/music?' + new URLSearchParams({ q: query || '', tags: tags || '', limit: String(limit) }), { method: 'GET' }).catch((e) => {
      if (e.status === 501) throw new Error('Music search is not available on your plan yet. You can still add your own music files.');
      throw e;
    });
  }
  return (j.results || []).map((t) => ({
    id: 'jamendo:' + t.id,
    title: t.name,
    artist: t.artist_name,
    duration: t.duration,
    url: t.audiodownload || t.audio,
    preview: t.audio,
    license: t.license_ccurl,
    tags: t.musicinfo && t.musicinfo.tags ? [].concat(t.musicinfo.tags.genres || [], t.musicinfo.tags.vartags || []) : [],
    source: 'Jamendo',
    credit: `"${t.name}" by ${t.artist_name} (Jamendo, ${t.license_ccurl || 'CC'})`,
  }));
}

async function searchSfx(query, { limit = 24, maxDuration = 30 } = {}) {
  const token = own('freesound');
  let j;
  if (token) {
    const params = new URLSearchParams({ query: query || 'whoosh', token, page_size: String(limit), fields: 'id,name,previews,duration,license,username,tags', filter: `duration:[0 TO ${maxDuration}]`, sort: 'score' });
    j = await net.json('https://freesound.org/apiv2/search/text/?' + params.toString(), { label: 'Freesound' });
  } else {
    j = await cloud.request('/v1/library/sounds?' + new URLSearchParams({ q: query || 'whoosh', limit: String(limit), max_duration: String(maxDuration) }), { method: 'GET' }).catch((e) => {
      if (e.status === 501) throw new Error('Sound effect search is not available on your plan yet. Try "Generate with AI" or add your own files.');
      throw e;
    });
  }
  return (j.results || []).map((s) => ({
    id: 'freesound:' + s.id,
    title: s.name,
    artist: s.username,
    duration: s.duration,
    url: s.previews && (s.previews['preview-hq-mp3'] || s.previews['preview-lq-mp3']),
    preview: s.previews && (s.previews['preview-lq-mp3'] || s.previews['preview-hq-mp3']),
    license: s.license,
    tags: s.tags || [],
    source: 'Freesound',
    credit: `"${s.name}" by ${s.username} (Freesound, ${s.license})`,
  }));
}

/** Download a track/effect into the cache and return the local path. */
async function fetchAsset(item, ctx) {
  const kind = String(item.id).startsWith('jamendo') ? 'music' : 'sfx';
  const file = path.join(cacheDir(kind), String(item.id).replace(/[^a-z0-9]+/gi, '_') + '.mp3');
  if (fs.existsSync(file)) return file;
  await net.download(item.url, file, { signal: ctx && ctx.signal });
  return file;
}

module.exports = { searchMusic, searchSfx, fetchAsset };
