'use strict';
// Publish to WordPress sites through the REST API with Application Passwords (no plugin needed).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const net = require('./util/net');

function sites() {
  return (store.getSettings().wordpress || []).map((s) => Object.assign({}, s, { hasPassword: Boolean(store.getSecret('wp:' + s.id)) }));
}

function site(id) {
  const s = (store.getSettings().wordpress || []).find((x) => x.id === id);
  if (!s) throw new Error('WordPress site not found. Add it in Settings → WordPress.');
  return s;
}

function auth(s) {
  const pass = store.getSecret('wp:' + s.id);
  if (!pass) throw new Error(`Add the Application Password for ${s.name} in Settings → WordPress.`);
  return 'Basic ' + Buffer.from(`${s.username}:${pass.replace(/\s+/g, '')}`).toString('base64');
}

function api(s, route) { return s.url.replace(/\/+$/, '') + '/wp-json/wp/v2/' + route; }

async function saveSite({ id, name, url, username, appPassword }) {
  const list = (store.getSettings().wordpress || []).slice();
  const clean = { id: id || crypto.randomUUID(), name: (name || url || '').trim(), url: String(url || '').trim().replace(/\/+$/, ''), username: String(username || '').trim() };
  if (!/^https?:\/\//.test(clean.url)) throw new Error('Enter the full site address, e.g. https://myblog.com');
  if (!clean.username) throw new Error('Enter the WordPress username.');
  const i = list.findIndex((x) => x.id === clean.id);
  if (i >= 0) list[i] = clean; else list.push(clean);
  store.setSettings({ wordpress: list });
  if (appPassword) store.setSecret('wp:' + clean.id, appPassword);
  return sites();
}

function removeSite(id) {
  store.setSettings({ wordpress: (store.getSettings().wordpress || []).filter((x) => x.id !== id) });
  store.setSecret('wp:' + id, '');
  return sites();
}

async function test(id) {
  const s = site(id);
  const me = await net.json(api(s, 'users/me?context=edit'), { headers: { Authorization: auth(s) }, label: s.name, timeout: 20000 });
  return { ok: true, user: me.name, roles: me.roles || [] };
}

async function categories(id) {
  const s = site(id);
  const list = await net.json(api(s, 'categories?per_page=100&_fields=id,name'), { headers: { Authorization: auth(s) }, label: s.name });
  return list.map((c) => ({ id: c.id, name: c.name }));
}

async function tagIds(s, names) {
  const ids = [];
  for (const n of names.slice(0, 20)) {
    const name = String(n).trim();
    if (!name) continue;
    try {
      const found = await net.json(api(s, 'tags?search=' + encodeURIComponent(name) + '&_fields=id,name'), { headers: { Authorization: auth(s) }, label: s.name });
      const hit = found.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (hit) { ids.push(hit.id); continue; }
      const created = await net.json(api(s, 'tags'), { method: 'POST', headers: { Authorization: auth(s), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), label: s.name });
      ids.push(created.id);
    } catch (_) { /* skip tag */ }
  }
  return ids;
}

async function uploadMedia(s, file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return net.json(api(s, 'media'), { method: 'POST', headers: { Authorization: auth(s), 'Content-Type': type, 'Content-Disposition': `attachment; filename="${path.basename(file).replace(/"/g, '')}"` }, body: buf, label: s.name });
}

/**
 * Create a post.
 * @param {string} id site id
 * @param {{title:string, html:string, status:'draft'|'publish'|'future', date?:string, excerpt?:string, slug?:string, categories?:number[], tags?:string[], featuredImage?:string, inlineImages?:Array<{file:string, placeholder:string}>}} p
 */
async function publish(id, p, ctx) {
  const s = site(id);
  let html = p.html;
  ctx && ctx.progress(10, 'Uploading images…');
  for (const im of p.inlineImages || []) {
    try {
      const m = await uploadMedia(s, im.file);
      html = html.split(im.placeholder).join(m.source_url);
    } catch (_) { /* leave placeholder out */ html = html.split(im.placeholder).join(''); }
  }
  let featured = 0;
  if (p.featuredImage) {
    try { featured = (await uploadMedia(s, p.featuredImage)).id; } catch (_) { featured = 0; }
  }
  ctx && ctx.progress(60, 'Creating post…');
  const body = { title: p.title, content: html, status: p.status || 'draft' };
  if (p.excerpt) body.excerpt = p.excerpt;
  if (p.slug) body.slug = p.slug;
  if (p.status === 'future' && p.date) body.date = p.date;
  if (p.categories && p.categories.length) body.categories = p.categories;
  if (p.tags && p.tags.length) body.tags = await tagIds(s, p.tags);
  if (featured) body.featured_media = featured;
  const post = await net.json(api(s, 'posts'), { method: 'POST', headers: { Authorization: auth(s), 'Content-Type': 'application/json' }, body: JSON.stringify(body), label: s.name });
  return { id: post.id, link: post.link, status: post.status };
}

module.exports = { sites, saveSite, removeSite, test, categories, publish };
