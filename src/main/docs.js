'use strict';
// Document rendering: Markdown (with ![caption](frame:SECONDS) image markers) → designed HTML, PDF, DOCX, MD, TXT.
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function mimeOf(f) { return /\.png$/i.test(f) ? 'image/png' : 'image/jpeg'; }

/** Replace frame:T image sources using resolve(t) → file path. */
/** frame:SECONDS → nearest key frame; asset:NAME → a diagram/infographic saved in the project; anything else is a path. */
function fileOf(src, resolve) {
  if (src.startsWith('frame:')) return resolve ? resolve(Number(src.slice(6))) : '';
  if (src.startsWith('asset:')) return resolve && resolve.asset ? resolve.asset(src.slice(6)) : '';
  return src;
}

function mapImages(md, resolve, toSrc) {
  return md.replace(/!\[([^\]]*)\]\((frame:[\d.]+|asset:[\w.-]+|[^)\s]+)\)/g, (all, cap, src) => {
    const file = fileOf(src, resolve);
    if (!file || !fs.existsSync(file)) return '';
    return `![${cap}](${toSrc(file)})`;
  });
}

function css(theme) {
  const p = theme.primary || '#6d5efc';
  const a = theme.accent || '#22d3ee';
  return `
  @page { size: ${theme.pageSize || 'A4'}; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; color: #1b1e2e; font-size: 11.5pt; line-height: 1.6; margin: 0; }
  .cover { min-height: 92vh; display: flex; flex-direction: column; justify-content: flex-end; padding: 48px; color: #fff; border-radius: 18px;
    background: radial-gradient(900px 500px at 0% 0%, ${p} 0%, #0d1024 70%); page-break-after: always; }
  .cover .kicker { text-transform: uppercase; letter-spacing: .14em; font-size: 10pt; opacity: .8; margin-bottom: 14px; }
  .cover h1 { font-size: 34pt; line-height: 1.1; margin: 0 0 14px; border: 0; color: #fff; }
  .cover .sub { font-size: 14pt; opacity: .9; max-width: 80%; }
  .cover .meta { margin-top: 40px; font-size: 10pt; opacity: .75; border-top: 1px solid rgba(255,255,255,.25); padding-top: 14px; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 8px 4px; }
  .toc { page-break-after: always; }
  .toc h2 { border: 0; }
  .toc ol { padding-left: 18px; } .toc li { margin: 6px 0; }
  h1 { font-size: 22pt; color: #0d1024; border-bottom: 3px solid ${p}; padding-bottom: 6px; margin-top: 28px; }
  h2 { font-size: 16pt; color: #0d1024; margin-top: 26px; padding-left: 12px; border-left: 4px solid ${p}; page-break-after: avoid; }
  h3 { font-size: 13pt; color: ${p}; margin-top: 18px; page-break-after: avoid; }
  p { margin: 8px 0 10px; }
  a { color: ${p}; }
  img { max-width: 100%; border-radius: 10px; border: 1px solid #e3e5ef; display: block; margin: 10px auto 4px; page-break-inside: avoid; }
  img + em, p > img + em { display: block; text-align: center; color: #6b7090; font-size: 9.5pt; margin-bottom: 12px; }
  blockquote { margin: 14px 0; padding: 12px 16px; border-radius: 10px; background: color-mix(in srgb, ${a} 12%, #fff); border: 1px solid color-mix(in srgb, ${a} 35%, #fff); page-break-inside: avoid; }
  blockquote p { margin: 4px 0; }
  code { background: #f2f3f8; padding: 1px 5px; border-radius: 4px; font-size: 10pt; }
  pre { background: #0f1222; color: #e6e8ff; padding: 12px 14px; border-radius: 10px; overflow: auto; font-size: 9.5pt; }
  pre code { background: none; color: inherit; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; page-break-inside: avoid; }
  th { background: ${p}; color: #fff; text-align: left; padding: 7px 9px; }
  td { border-bottom: 1px solid #e6e8f0; padding: 7px 9px; vertical-align: top; }
  ul, ol { padding-left: 22px; } li { margin: 4px 0; }
  li input[type=checkbox] { margin-right: 6px; }
  hr { border: 0; border-top: 1px dashed #d8dbe8; margin: 22px 0; }
  .footer { margin-top: 40px; font-size: 9pt; color: #8a8fa8; text-align: center; }
  ${designCss(theme.design, p, a)}`;
}

/** Three document designs: modern (default), classic (editorial serif), bold (high-contrast blocks). */
const DESIGNS = { modern: 'Modern', classic: 'Classic', bold: 'Bold' };
function designCss(design, p, a) {
  if (design === 'classic') {
    return `
  body { font-family: Georgia, "Times New Roman", serif; font-size: 11.5pt; line-height: 1.7; color: #222; }
  .cover { background: #fff; color: #111; border: 0; border-radius: 0; justify-content: center; padding: 64px 40px; border-top: 6px double ${p}; border-bottom: 6px double ${p}; }
  .cover h1 { color: #111; font-size: 36pt; font-weight: normal; letter-spacing: -.01em; }
  .cover .kicker { color: ${p}; opacity: 1; }
  .cover .sub { color: #444; font-style: italic; }
  .cover .meta { color: #666; border-top: 1px solid #ccc; opacity: 1; }
  h1 { border-bottom: 1px solid #222; font-weight: normal; }
  h2 { border-left: 0; padding-left: 0; font-variant: small-caps; letter-spacing: .03em; font-weight: normal; font-size: 17pt; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { color: #222; font-style: italic; font-weight: normal; }
  img { border-radius: 2px; }
  blockquote { background: #faf8f3; border: 0; border-left: 3px solid ${p}; border-radius: 0; font-style: italic; }
  th { background: #222; }`;
  }
  if (design === 'bold') {
    return `
  body { font-family: "Segoe UI", Arial, sans-serif; }
  .cover { background: ${p}; border-radius: 0; justify-content: space-between; }
  .cover h1 { font-size: 44pt; font-weight: 900; text-transform: none; }
  .cover .kicker { background: #fff; color: ${p}; display: inline-block; padding: 4px 10px; border-radius: 4px; opacity: 1; align-self: flex-start; }
  h1 { border: 0; background: #0d1024; color: #fff; padding: 10px 14px; border-radius: 6px; }
  h2 { border: 0; padding: 8px 12px; background: color-mix(in srgb, ${p} 14%, #fff); border-radius: 6px; font-weight: 800; }
  h3 { font-weight: 800; text-transform: uppercase; letter-spacing: .04em; font-size: 11.5pt; }
  blockquote { background: ${a}; color: #0d1024; border: 0; font-weight: 600; }
  img { border: 3px solid #0d1024; border-radius: 8px; }`;
  }
  return '';
}

/** Build a self-contained HTML document. */
function html(doc, { resolve, theme = {}, inlineImages = true, imageSrc } = {}) {
  const md = mapImages(doc.markdown || '', resolve, (f) => (imageSrc ? imageSrc(f) : inlineImages ? `data:${mimeOf(f)};base64,${fs.readFileSync(f).toString('base64')}` : 'file:///' + f.replace(/\\/g, '/')));
  const body = marked.parse(md, { gfm: true, breaks: false });
  const h2 = [];
  const withIds = body.replace(/<h2>(.*?)<\/h2>/g, (m, t) => { const id = 's' + (h2.length + 1); h2.push(t.replace(/<[^>]+>/g, '')); return `<h2 id="${id}">${t}</h2>`; });
  const toc = doc.toc !== false && h2.length > 3 ? `<section class="toc wrap"><h2>Contents</h2><ol>${h2.map((t, i) => `<li><a href="#s${i + 1}">${esc(t)}</a></li>`).join('')}</ol></section>` : '';
  const cover = doc.cover === false ? '' : `<section class="cover"><div class="kicker">${esc(doc.kicker || '')}</div><h1>${esc(doc.title || 'Untitled')}</h1>${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ''}<div class="meta">${esc(doc.author || theme.brand || '')}${doc.date ? ' · ' + esc(doc.date) : ''}</div></section>`;
  return `<!doctype html><html lang="${esc(doc.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(doc.title || 'Document')}</title><style>${css(theme)}</style></head><body>${cover}${toc}<main class="wrap">${withIds}</main>${theme.footer ? `<div class="footer">${esc(theme.footer)}</div>` : ''}</body></html>`;
}

/** Markdown with images copied next to it. */
function markdownExport(doc, outFile, resolve) {
  const dir = path.join(path.dirname(outFile), path.basename(outFile, path.extname(outFile)) + '_images');
  let n = 0;
  const md = mapImages(doc.markdown || '', resolve, (f) => {
    fs.mkdirSync(dir, { recursive: true });
    const name = `img_${++n}${path.extname(f)}`;
    fs.copyFileSync(f, path.join(dir, name));
    return `${path.basename(dir)}/${name}`;
  });
  fs.writeFileSync(outFile, `# ${doc.title || 'Document'}\n\n${doc.subtitle ? '_' + doc.subtitle + '_\n\n' : ''}${md}\n`);
  return outFile;
}

function plainText(doc) {
  const md = (doc.markdown || '').replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '');
  const tokens = marked.lexer(md);
  const out = [(doc.title || '').toUpperCase(), doc.subtitle || '', ''];
  const inline = (t) => String(t || '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  for (const t of tokens) {
    if (t.type === 'heading') out.push('', t.depth <= 2 ? inline(t.text).toUpperCase() : inline(t.text), '');
    else if (t.type === 'paragraph') out.push(inline(t.text), '');
    else if (t.type === 'list') { t.items.forEach((it, i) => out.push(`${t.ordered ? (i + 1) + '.' : '•'} ${inline(it.text)}`)); out.push(''); } else if (t.type === 'blockquote') out.push(inline(t.text).split('\n').map((l) => '  | ' + l).join('\n'), '');
    else if (t.type === 'code') out.push(t.text, '');
    else if (t.type === 'table') { out.push(t.header.map((h) => inline(h.text)).join(' | ')); t.rows.forEach((r) => out.push(r.map((c) => inline(c.text)).join(' | '))); out.push(''); } else if (t.type === 'hr') out.push('----------', '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpg' };
    i += 2 + len;
  }
  return { w: 800, h: 450, type: 'jpg' };
}

/** DOCX via the docx library. */
async function docx(doc, outFile, { resolve, theme = {} } = {}) {
  const D = require('docx');
  const tokens = marked.lexer(doc.markdown || '');
  const children = [];
  const color = (theme.primary || '#6d5efc').replace('#', '');
  let listInstance = 0;

  const runs = (inlineTokens, base = {}) => {
    const out = [];
    for (const t of inlineTokens || []) {
      if (t.type === 'strong') out.push(...runs(t.tokens, Object.assign({}, base, { bold: true })));
      else if (t.type === 'em') out.push(...runs(t.tokens, Object.assign({}, base, { italics: true })));
      else if (t.type === 'codespan') out.push(new D.TextRun(Object.assign({}, base, { text: t.text, font: 'Consolas' })));
      else if (t.type === 'link') out.push(new D.ExternalHyperlink({ link: t.href, children: [new D.TextRun(Object.assign({}, base, { text: t.text, style: 'Hyperlink' }))] }));
      else if (t.type === 'br') out.push(new D.TextRun({ break: 1 }));
      else if (t.type === 'image') continue;
      else if (t.tokens) out.push(...runs(t.tokens, base));
      else out.push(new D.TextRun(Object.assign({}, base, { text: (t.text || t.raw || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') })));
    }
    return out;
  };

  const imagePara = (src, caption) => {
    const file = fileOf(src, resolve);
    if (!file || !fs.existsSync(file)) return [];
    const buf = fs.readFileSync(file);
    const sz = imageSize(buf);
    const w = Math.min(560, sz.w);
    const h = Math.round((w / sz.w) * sz.h);
    const out = [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.ImageRun({ type: sz.type, data: buf, transformation: { width: w, height: h } })] })];
    if (caption) out.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: caption, italics: true, color: '6B7090', size: 18 })] }));
    return out;
  };

  const walk = (tokensList, depth = 0) => {
    for (const t of tokensList) {
      if (t.type === 'heading') {
        const lv = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4][Math.min(3, t.depth - 1)];
        children.push(new D.Paragraph({ heading: lv, children: runs(t.tokens) }));
      } else if (t.type === 'paragraph') {
        const imgs = (t.tokens || []).filter((x) => x.type === 'image');
        if (imgs.length) { for (const im of imgs) children.push(...imagePara(im.href, im.text)); const rest = (t.tokens || []).filter((x) => x.type !== 'image' && !(x.type === 'text' && !x.text.trim())); if (rest.length) children.push(new D.Paragraph({ children: runs(rest) })); } else children.push(new D.Paragraph({ children: runs(t.tokens), spacing: { after: 120 } }));
      } else if (t.type === 'list') {
        listInstance++;
        for (const it of t.items) {
          const first = (it.tokens || []).find((x) => x.type === 'text' || x.type === 'paragraph');
          const prefix = it.task ? (it.checked ? '☑ ' : '☐ ') : '';
          const para = { children: [new D.TextRun(prefix)].concat(runs(first ? (first.tokens || [{ type: 'text', text: first.text }]) : [])) };
          if (t.ordered) para.numbering = { reference: 'ame-num', level: Math.min(depth, 2), instance: listInstance };
          else para.bullet = { level: Math.min(depth, 2) };
          children.push(new D.Paragraph(para));
          const nested = (it.tokens || []).filter((x) => x.type === 'list');
          if (nested.length) walk(nested, depth + 1);
        }
      } else if (t.type === 'blockquote') {
        for (const b of t.tokens || []) {
          if (b.type === 'paragraph') children.push(new D.Paragraph({ children: runs(b.tokens), shading: { type: D.ShadingType.CLEAR, fill: 'EEF7FB', color: 'auto' }, border: { left: { style: D.BorderStyle.SINGLE, size: 18, color } }, indent: { left: 240 }, spacing: { before: 80, after: 80 } }));
        }
      } else if (t.type === 'code') {
        for (const line of t.text.split('\n')) children.push(new D.Paragraph({ children: [new D.TextRun({ text: line, font: 'Consolas', size: 18 })], shading: { type: D.ShadingType.CLEAR, fill: 'F2F3F8', color: 'auto' } }));
      } else if (t.type === 'table') {
        const cell = (c, head) => new D.TableCell({ children: [new D.Paragraph({ children: runs(c.tokens, head ? { bold: true, color: 'FFFFFF' } : {}) })], shading: head ? { type: D.ShadingType.CLEAR, fill: color, color: 'auto' } : undefined });
        children.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: [new D.TableRow({ tableHeader: true, children: t.header.map((h) => cell(h, true)) })].concat(t.rows.map((r) => new D.TableRow({ children: r.map((c) => cell(c, false)) }))) }));
        children.push(new D.Paragraph(''));
      } else if (t.type === 'hr') {
        children.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'D8DBE8' } } }));
      }
    }
  };
  walk(tokens);

  const cover = [
    new D.Paragraph({ spacing: { before: 2400 }, children: [new D.TextRun({ text: (doc.kicker || '').toUpperCase(), color, bold: true, size: 20 })] }),
    new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun({ text: doc.title || 'Document' })] }),
  ];
  if (doc.subtitle) cover.push(new D.Paragraph({ children: [new D.TextRun({ text: doc.subtitle, size: 28, color: '555B78' })] }));
  cover.push(new D.Paragraph({ spacing: { before: 600 }, children: [new D.TextRun({ text: [doc.author || theme.brand || '', doc.date || ''].filter(Boolean).join(' · '), color: '8A8FA8' })] }));
  cover.push(new D.Paragraph({ children: [new D.PageBreak()] }));

  const document = new D.Document({
    creator: theme.brand || 'Vid Vision',
    title: doc.title,
    styles: {
      default: { document: { run: { font: theme.design === 'classic' ? 'Georgia' : theme.design === 'bold' ? 'Arial' : 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: theme.design !== 'classic', color: '0D1024', font: theme.design === 'bold' ? 'Arial Black' : undefined }, paragraph: { spacing: { before: 360, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: theme.design !== 'classic', smallCaps: theme.design === 'classic', color: theme.design === 'bold' ? color : '0D1024', font: theme.design === 'bold' ? 'Arial Black' : undefined }, paragraph: { spacing: { before: 300, after: 120 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: theme.design !== 'classic', italics: theme.design === 'classic', color } },
      ],
    },
    numbering: { config: [{ reference: 'ame-num', levels: [0, 1, 2].map((l) => ({ level: l, format: D.LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } })) }] },
    sections: [{ properties: {}, children: cover.concat(children) }],
  });
  fs.writeFileSync(outFile, await D.Packer.toBuffer(document));
  return outFile;
}

/** PDF via a hidden Electron window. */
async function pdf(doc, outFile, opts = {}) {
  const { BrowserWindow } = require('electron');
  const tmp = outFile + '.tmp.html';
  fs.writeFileSync(tmp, html(doc, opts));
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    const buf = await win.webContents.printToPDF({ printBackground: true, pageSize: (opts.theme && opts.theme.pageSize) || 'A4', margins: { marginType: 'default' } });
    fs.writeFileSync(outFile, buf);
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
  return outFile;
}

/**
 * Export a document in one of: pdf, docx, html, md, txt.
 */
async function exportDoc(doc, format, outFile, opts = {}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  switch (format) {
    case 'pdf': return pdf(doc, outFile, opts);
    case 'docx': return docx(doc, outFile, opts);
    case 'html': fs.writeFileSync(outFile, html(doc, opts)); return outFile;
    case 'md': return markdownExport(doc, outFile, opts.resolve);
    default: fs.writeFileSync(outFile, plainText(doc)); return outFile;
  }
}

module.exports = { DESIGNS, fileOf, html, exportDoc, plainText, markdownExport, docx, imageSize, mapImages };
