import { html, useStore, state } from './lib.js';

export function brandName() {
  const b = state.auth && state.auth.brand;
  return (b && b.app_name) || (state.info && state.info.config.appName) || 'Vid Vision';
}

/** Brand mark: WL logo, or the three-engine glyph (one bar per engine). */
export function Mark({ small }) {
  const auth = useStore((s) => s.auth);
  const b = auth && auth.brand;
  if (b && b.logo_url) return html`<img class=${'brand-logo ' + (small ? 'sm' : '')} src=${b.logo_url} alt="" />`;
  return html`<span class=${'brand-glyph ' + (small ? 'sm' : '')} aria-hidden="true"><i class="g-v" /><i class="g-o" /><i class="g-s" /></span>`;
}
