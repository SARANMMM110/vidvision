'use strict';
// Bundles the UI with esbuild and copies static assets + local-AI runtimes into dist/renderer.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'renderer');
const out = path.join(root, 'dist', 'renderer');

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function findUp(rel) {
  const candidates = [path.join(root, 'node_modules', rel), path.join(root, 'vendor', rel)];
  return candidates.find((p) => fs.existsSync(p));
}

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(src, 'app.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome120'],
    outfile: path.join(out, 'app.js'),
    minify: process.env.AME_DEV ? false : true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  for (const f of ['index.html', 'engine.html', 'engine.js', 'styles.css']) copy(path.join(src, f), path.join(out, f));

  // Fonts
  const fontDir = path.join(root, 'node_modules', '@fontsource', 'ibm-plex-sans', 'files');
  for (const w of ['400', '500', '600', '700']) {
    const f = path.join(fontDir, `ibm-plex-sans-latin-${w}-normal.woff2`);
    if (fs.existsSync(f)) copy(f, path.join(out, 'fonts', path.basename(f)));
  }

  // Local AI runtimes (Kokoro bundle, transformers.js 3.5.1 web build, ONNX Runtime wasm).
  const vendor = path.join(root, 'vendor', 'engine');
  const kokoro = fs.existsSync(path.join(vendor, 'kokoro.web.js')) ? path.join(vendor, 'kokoro.web.js') : findUp('kokoro-js/dist/kokoro.web.js');
  if (kokoro) copy(kokoro, path.join(out, 'vendor', 'kokoro.web.js'));
  for (const f of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
    const p = path.join(vendor, f);
    if (!fs.existsSync(p)) { console.warn('missing vendor/engine/' + f + ' — local Kokoro/NLLB will not work'); continue; }
    copy(p, path.join(out, 'vendor', f.startsWith('ort-') ? path.join('ort', f) : f));
  }
  const mm = findUp('mermaid/dist/mermaid.min.js');
  if (mm) copy(mm, path.join(out, 'vendor', 'mermaid.min.js')); else console.warn('mermaid not installed — document diagrams will not work');
  console.log('renderer built →', path.relative(root, out));
})().catch((e) => { console.error(e); process.exit(1); });
