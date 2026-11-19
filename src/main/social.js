'use strict';
// Optional sign-in for Discover on Instagram / TikTok. The user signs in inside a normal app window (their
// password goes only to the site); the session cookies are saved for the video downloader (yt-dlp --cookies).
const fs = require('fs');
const dl = require('./download');

const SITES = {
  instagram: { label: 'Instagram', url: 'https://www.instagram.com/accounts/login/', domains: ['instagram.com'], session: 'sessionid' },
  tiktok: { label: 'TikTok', url: 'https://www.tiktok.com/login', domains: ['tiktok.com'], session: 'sessionid' },
};
const PARTITION = 'persist:social-signin';

function electron() { try { const e = require('electron'); return e && e.BrowserWindow ? e : null; } catch (_) { return null; } }

/** Write every cookie of the sign-in session for our sites as a Netscape cookies.txt. */
async function exportCookies() {
  const e = electron();
  if (!e) return status();
  const ses = e.session.fromPartition(PARTITION);
  const lines = ['# Netscape HTTP Cookie File', '# Written by the app for the video downloader. Delete to sign out.'];
  for (const site of Object.values(SITES)) {
    for (const d of site.domains) {
      const list = await ses.cookies.get({ domain: d });
      for (const c of list) {
        const domain = c.hostOnly === false && !c.domain.startsWith('.') ? '.' + c.domain : c.domain;
        lines.push([domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', Math.floor(c.expirationDate || (Date.now() / 1000 + 86400 * 30)), c.name, c.value].join('\t'));
      }
    }
  }
  if (lines.length > 2) fs.writeFileSync(dl.cookieFile(), lines.join('\n') + '\n', { mode: 0o600 });
  else { try { fs.unlinkSync(dl.cookieFile()); } catch (_) { /* none */ } }
  return status();
}

function status() {
  let txt = '';
  try { txt = fs.readFileSync(dl.cookieFile(), 'utf8'); } catch (_) { txt = ''; }
  const out = {};
  for (const [k, s] of Object.entries(SITES)) out[k] = s.domains.some((d) => new RegExp(`\\t${s.session}\\t`).test(txt.split('\n').filter((l) => l.includes(d)).join('\n')));
  return out;
}

/** Open the site's login page; resolves when the user closes the window (or after a successful login). */
function signIn(site, parent) {
  const e = electron();
  const s = SITES[site];
  if (!s) throw new Error('Unknown site.');
  if (!e) throw new Error('Sign-in needs the desktop app.');
  return new Promise((resolve) => {
    const win = new e.BrowserWindow({ width: 480, height: 760, parent: parent || undefined, title: `Sign in to ${s.label}`, autoHideMenuBar: true, webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true } });
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(({ url }) => { win.loadURL(url); return { action: 'deny' }; });
    let done = false;
    const finish = async () => { if (done) return; done = true; resolve(await exportCookies()); };
    const ses = e.session.fromPartition(PARTITION);
    const onCookie = (_ev, cookie, cause, removed) => {
      if (!removed && cookie.name === s.session && s.domains.some((d) => cookie.domain.includes(d)) && cookie.value) setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 1500);
    };
    ses.cookies.on('changed', onCookie);
    win.on('closed', () => { ses.cookies.removeListener('changed', onCookie); finish(); });
    win.loadURL(s.url);
  });
}

async function signOut(site) {
  const e = electron();
  const s = SITES[site];
  if (e && s) {
    const ses = e.session.fromPartition(PARTITION);
    for (const d of s.domains) for (const c of await ses.cookies.get({ domain: d })) await ses.cookies.remove(`https://${c.domain.replace(/^\./, '')}${c.path || '/'}`, c.name);
  }
  return exportCookies();
}

module.exports = { SITES, signIn, signOut, status, exportCookies };
