import { html, useStore, call, go, ago, mediaUrl, openUrl } from '../lib.js';
import { Icon, Button, useAsync } from '../ui.js';
import { brandName } from '../brand.js';

const MODS = [
  { m: 'vision', title: 'Vision Engine', icon: 'eye', start: 'vision.projects', actions: [['vision.discover', 'Find videos'], ['vision.projects', 'Analyze a video'], ['vision.clips', 'Make clips']] },
  { m: 'voice', title: 'Voice Engine', icon: 'mic', start: 'voice.tts', actions: [['voice.tts', 'Text to speech'], ['voice.studio', 'Multi-speaker studio'], ['voice.books', 'Audiobook']] },
  { m: 'scribe', title: 'Scribe Engine', icon: 'pen', start: 'scribe.single', actions: [['scribe.single', 'Transcribe a file'], ['scribe.bulk', 'Bulk transcribe'], ['scribe.translate', 'Translate']] },
];

export function Home() {
  const auth = useStore((s) => s.auth);
  const mods = auth.modules || [];
  const products = (auth.config && auth.config.products) || {};
  const setup = useAsync(async () => {
    const s = await call('settings.get');
    const recent = [];
    if (mods.includes('vision')) (await call('vision.projects').catch(() => [])).slice(0, 4).forEach((p) => recent.push({ kind: 'vision', title: p.name, sub: `${p.videos} video${p.videos === 1 ? '' : 's'}`, at: p.updated, thumb: p.thumb, go: () => go('vision.projects', { open: p.id }) }));
    if (mods.includes('scribe')) (await call('scribe.projects').catch(() => [])).slice(0, 3).forEach((p) => recent.push({ kind: 'scribe', title: p.name, sub: `${p.done}/${p.rows} transcribed`, at: p.updated, go: () => go('scribe.bulk', { id: p.id }) }));
    if (mods.includes('voice')) (await call('voice.audio').catch(() => [])).slice(0, 3).forEach((a) => recent.push({ kind: 'voice', title: a.title, sub: a.engine || 'audio', at: a.created, go: () => go('voice.audio') }));
    recent.sort((a, b) => b.at - a.at);
    return { keys: s.keys, settings: s.settings, recent: recent.slice(0, 8) };
  }, []);
  const ai = useStore((s) => s.ai);
  const aiOn = Boolean(ai && ai.enabled);
  const left = aiOn && ai.usage ? Math.max(0, ai.usage.remaining || 0) : 0;
  const name = (auth.profile && auth.profile.user.name || '').split(' ')[0];

  return html`<div class="page home">
    <header class="home-head">
      <h1>${name ? `Hi ${name}.` : 'Welcome.'} What are we making today?</h1>
      <p class="muted">${brandName()} combines ${MODS.length} engines. Each one works on its own; together they turn any video or idea into content.</p>
    </header>

    <div class="home-mods">
      ${MODS.map((x) => {
        const owned = mods.includes(x.m);
        const p = products[x.m] || {};
        return html`<section class=${'home-mod mod-' + x.m + (owned ? '' : ' locked')}>
          <div class="home-mod-top"><span class="home-mod-icon"><${Icon} name=${x.icon} size=${22} /></span><h2>${p.name || x.title}</h2>${owned ? null : html`<span class="badge">Not owned</span>`}</div>
          <p class="muted">${p.desc || ''}</p>
          ${owned ? html`<div class="home-actions">${x.actions.map((a) => html`<button class="home-action" onClick=${() => go(a[0])}>${a[1]}<${Icon} name="chevron" size=${14} /></button>`)}</div>`
            : html`<div class="row gap"><${Button} kind="primary" size="sm" onClick=${() => p.sales_url && openUrl(p.sales_url)}>Unlock ${p.name || x.title}</${Button}><${Button} size="sm" onClick=${() => go(x.start)}>See what it does</${Button}></div>`}
        </section>`;
      })}
    </div>

    <div class="home-grid">
      <section class="panel">
        <h3>Recent work</h3>
        ${setup.data && setup.data.recent.length ? html`<ul class="recent">${setup.data.recent.map((r) => html`<li><button onClick=${r.go}>
          <span class=${'recent-thumb mod-' + r.kind}>${r.thumb ? html`<img src=${mediaUrl(r.thumb)} alt="" />` : html`<${Icon} name=${r.kind === 'vision' ? 'eye' : r.kind === 'voice' ? 'wave' : 'pen'} />`}</span>
          <span class="recent-text"><b>${r.title}</b><small>${r.sub} — ${ago(r.at)}</small></span></button></li>`)}</ul>`
          : html`<p class="muted">Nothing yet. Pick an engine above to start.</p>`}
      </section>
      <section class="panel">
        <h3>Set up</h3>
        <ul class="checklist">
          <li class=${aiOn ? 'done' : ''}><${Icon} name=${aiOn ? 'check' : 'sparkle'} /><div><b>AI is built in</b><span>${aiOn ? `Ready — ${left.toLocaleString()} AI credits left this month. No API keys needed.` : 'Checking your AI plan… Offline engines work without it.'}</span></div><${Button} size="sm" onClick=${() => go('settings', { tab: 'builtin' })}>${aiOn ? 'Credits' : 'Open'}</${Button}></li>
          <li><${Icon} name="cpu" /><div><b>Free offline engines (optional)</b><span>Whisper for unlimited offline transcription, Kokoro/Piper voices and local AI models — no credits used.</span></div><${Button} size="sm" onClick=${() => go('settings', { tab: 'local' })}>Open</${Button}></li>
          <li><${Icon} name="folder" /><div><b>Folders</b><span>Choose where projects and exports are saved.</span></div><${Button} size="sm" onClick=${() => go('settings', { tab: 'folders' })}>Open</${Button}></li>
        </ul>
      </section>
    </div>
  </div>`;
}
