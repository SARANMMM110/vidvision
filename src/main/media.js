'use strict';
// ffmpeg-based media operations: probe, audio conversion, key frames, clips, audio editing.
const fs = require('fs');
const path = require('path');
const bins = require('./bins');
const P = require('./paths');
const proc = require('./util/proc');

const AUDIO_FORMATS = {
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  wav: ['-c:a', 'pcm_s16le'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
  m4a: ['-c:a', 'aac', '-b:a', '192k'],
};

async function probe(file, ctx) {
  const ffprobe = await bins.ffprobe(ctx);
  const r = await proc.runOk(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { signal: ctx && ctx.signal });
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  let fps = 0;
  if (v && v.avg_frame_rate && v.avg_frame_rate.includes('/')) {
    const [n, d] = v.avg_frame_rate.split('/').map(Number);
    fps = d ? n / d : 0;
  }
  const duration = Number((j.format && j.format.duration) || (v && v.duration) || (a && a.duration) || 0);
  return {
    duration,
    size: Number((j.format && j.format.size) || 0),
    format: j.format && j.format.format_name,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    rotation: v && v.tags && v.tags.rotate ? Number(v.tags.rotate) : 0,
    fps,
    title: (j.format && j.format.tags && (j.format.tags.title || j.format.tags.TITLE)) || '',
  };
}

/** Run ffmpeg reporting progress against a known duration (seconds). */
async function ffrun(args, { ctx, duration, label, cwd } = {}) {
  const ffmpeg = await bins.ffmpeg(ctx);
  const full = ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats'].concat(args);
  return proc.runOk(ffmpeg, full, {
    cwd,
    signal: ctx && ctx.signal,
    onStdout: (line) => {
      if (!ctx || !duration) return;
      const m = /^out_time_(?:ms|us)=(\d+)/.exec(line);
      if (m) ctx.progress(Math.min(99, (Number(m[1]) / 1e6 / duration) * 100), label);
    },
  });
}

async function toWav16k(input, out, ctx, duration) {
  await ffrun(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], { ctx, duration, label: 'Preparing audio…' });
  return out;
}

async function toMp3(input, out, { bitrate = '64k', mono = true, start, end, rate = 22050 } = {}, ctx) {
  const args = [];
  if (start) args.push('-ss', String(start));
  args.push('-i', input);
  if (end) args.push('-t', String(end - (start || 0)));
  args.push('-vn');
  if (mono) args.push('-ac', '1');
  args.push('-ar', String(rate), '-c:a', 'libmp3lame', '-b:a', bitrate, out);
  await ffrun(args, { ctx });
  return out;
}

/** Split audio into ≤chunkSec mp3 chunks (for cloud APIs with size limits). */
async function chunkAudio(input, duration, chunkSec, ctx) {
  const dir = P.tempDir('chunks');
  const chunks = [];
  const n = Math.max(1, Math.ceil(duration / chunkSec));
  for (let i = 0; i < n; i++) {
    ctx && ctx.check();
    const start = i * chunkSec;
    const out = path.join(dir, `c${String(i).padStart(3, '0')}.mp3`);
    await toMp3(input, out, { start, end: Math.min(duration, start + chunkSec) }, null);
    chunks.push({ file: out, offset: start });
    ctx && ctx.progress(((i + 1) / n) * 100, `Preparing audio chunk ${i + 1}/${n}`);
  }
  return { dir, chunks };
}

async function frameAt(input, t, out, { width = 0 } = {}, ctx) {
  const args = ['-ss', Math.max(0, t).toFixed(3), '-i', input, '-frames:v', '1'];
  if (width) args.push('-vf', `scale=${width}:-2`);
  args.push('-q:v', '3', out);
  await ffrun(args, { ctx });
  return out;
}

/**
 * Key frames by scene change, with gap filling so no stretch is longer than maxGap seconds.
 * @returns {Promise<Array<{t:number,file:string}>>}
 */
async function keyFrames(input, outDir, { duration, threshold = 0.32, maxGap = 20, width = 768, maxFrames = 400 } = {}, ctx) {
  fs.mkdirSync(outDir, { recursive: true });
  const ffmpeg = await bins.ffmpeg(ctx);
  const times = [];
  ctx && ctx.progress(0, 'Detecting scene changes…');
  // Pass 1: scene detection on a downscaled stream, timestamps from showinfo.
  await proc.run(ffmpeg, ['-hide_banner', '-nostdin', '-skip_frame', 'nokey', '-i', input, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], {
    signal: ctx && ctx.signal,
    onStderr: (line) => {
      const m = /pts_time:([\d.]+)/.exec(line);
      if (m) times.push(Number(m[1]));
      const tm = /time=(\d+):(\d+):([\d.]+)/.exec(line);
      if (tm && duration && ctx) ctx.progress(Math.min(45, ((+tm[1] * 3600 + +tm[2] * 60 + +tm[3]) / duration) * 45), 'Detecting scene changes…');
    },
  });
  // Always include an opening frame; fill gaps.
  let list = [0.5].concat(times.filter((t) => t > 1)).sort((a, b) => a - b);
  const filled = [];
  for (let i = 0; i < list.length; i++) {
    filled.push(list[i]);
    const next = i + 1 < list.length ? list[i + 1] : duration || list[i];
    for (let t = list[i] + maxGap; t < next - 2; t += maxGap) filled.push(t);
  }
  // De-duplicate frames closer than 1.5s and cap.
  list = [];
  for (const t of filled) if (!list.length || t - list[list.length - 1] >= 1.5) list.push(t);
  if (duration) list = list.filter((t) => t < duration - 0.2);
  if (list.length > maxFrames) {
    const step = list.length / maxFrames;
    list = Array.from({ length: maxFrames }, (_, i) => list[Math.floor(i * step)]);
  }
  const frames = [];
  for (let i = 0; i < list.length; i++) {
    ctx && ctx.check();
    const t = list[i];
    const file = path.join(outDir, `f_${String(Math.round(t * 1000)).padStart(9, '0')}.jpg`);
    if (!fs.existsSync(file)) await frameAt(input, t, file, { width }, null);
    if (fs.existsSync(file)) frames.push({ t: Math.round(t * 100) / 100, file });
    ctx && ctx.progress(45 + ((i + 1) / list.length) * 55, `Extracting frames ${i + 1}/${list.length}`);
  }
  return frames;
}

// ---------- audio editing
async function convertAudio(input, out, format, ctx) {
  const fmt = AUDIO_FORMATS[format] ? format : 'mp3';
  await ffrun(['-i', input, '-vn'].concat(AUDIO_FORMATS[fmt], [out]), { ctx });
  return out;
}

async function trim(input, out, start, end, ctx) {
  const args = ['-ss', String(Math.max(0, start || 0)), '-i', input];
  if (end && end > (start || 0)) args.push('-t', String(end - (start || 0)));
  const ext = path.extname(out).slice(1).toLowerCase();
  args.push('-vn');
  args.push(...(AUDIO_FORMATS[ext] || AUDIO_FORMATS.mp3), out);
  await ffrun(args, { ctx });
  return out;
}

/** Speed change keeping pitch (atempo supports 0.5–2 per stage). */
function atempoChain(f) {
  const parts = [];
  let x = f;
  while (x > 2) { parts.push('atempo=2.0'); x /= 2; }
  while (x < 0.5) { parts.push('atempo=0.5'); x /= 0.5; }
  parts.push(`atempo=${x.toFixed(4)}`);
  return parts.join(',');
}

async function speed(input, out, factor, ctx) {
  if (!factor || Math.abs(factor - 1) < 0.01) { fs.copyFileSync(input, out); return out; }
  await ffrun(['-i', input, '-filter:a', atempoChain(factor), out], { ctx });
  return out;
}

/** Normalise loudness to a target (EBU R128 single pass). */
async function normalize(input, out, lufs = -16, ctx) {
  await ffrun(['-i', input, '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=11`, '-ar', '44100', out], { ctx });
  return out;
}

/** Concatenate audio files with optional silence gaps → wav/mp3 by extension. */
async function concat(files, out, { gapMs = 250, ctx } = {}) {
  if (!files.length) throw new Error('Nothing to join.');
  const inputs = [];
  const filters = [];
  let idx = 0;
  const labels = [];
  for (let i = 0; i < files.length; i++) {
    inputs.push('-i', files[i]);
    filters.push(`[${idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    labels.push(`[a${i}]`);
    idx++;
    const gap = Array.isArray(gapMs) ? gapMs[i] : gapMs;
    if (gap > 0 && i < files.length - 1) {
      filters.push(`aevalsrc=0:d=${(gap / 1000).toFixed(3)}:s=44100:c=stereo,aformat=sample_fmts=fltp[g${i}]`);
      labels.push(`[g${i}]`);
    }
  }
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`);
  const listFile = P.tempFile('.txt');
  fs.writeFileSync(listFile, filters.join(';\n'));
  const ext = path.extname(out).slice(1).toLowerCase();
  try {
    await ffrun(inputs.concat(['-filter_complex_script', listFile, '-map', '[out]'], AUDIO_FORMATS[ext] || AUDIO_FORMATS.mp3, [out]), { ctx });
  } finally {
    try { fs.unlinkSync(listFile); } catch (_) { /* ignore */ }
  }
  return out;
}

/**
 * Mix a voice track with a music bed (looped, faded, optional ducking) and optional timed sound effects.
 * @param {{bed?:string, bedVolume?:number, duck?:boolean, sfx?:Array<{file:string, at:number, volume?:number}>, fadeOut?:number}} o
 */
async function mix(voice, out, o = {}, ctx) {
  const d = (await probe(voice)).duration;
  const inputs = ['-i', voice];
  const parts = ['[0:a]aresample=44100,aformat=channel_layouts=stereo[v]'];
  const mixLabels = ['[v]'];
  let n = 1;
  if (o.bed) {
    inputs.push('-stream_loop', '-1', '-i', o.bed);
    const vol = o.bedVolume === undefined ? 0.15 : o.bedVolume;
    const fade = o.fadeOut === undefined ? 3 : o.fadeOut;
    parts.push(`[${n}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${(d + 1).toFixed(2)},volume=${vol},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, d + 1 - fade).toFixed(2)}:d=${fade}[bed]`);
    if (o.duck) {
      parts[0] = '[0:a]aresample=44100,aformat=channel_layouts=stereo,asplit=2[v][sc]';
      parts.push('[bed][sc]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400[bedd]');
      mixLabels.push('[bedd]');
    } else {
      mixLabels.push('[bed]');
    }
    n++;
  }
  for (const s of o.sfx || []) {
    inputs.push('-i', s.file);
    const ms = Math.round((s.at || 0) * 1000);
    parts.push(`[${n}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${s.volume === undefined ? 0.8 : s.volume},adelay=${ms}|${ms}[s${n}]`);
    mixLabels.push(`[s${n}]`);
    n++;
  }
  if (mixLabels.length === 1) { fs.copyFileSync(voice, out); return out; }
  parts.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0[out]`);
  const ext = path.extname(out).slice(1).toLowerCase();
  const script = P.tempFile('.txt');
  fs.writeFileSync(script, parts.join(';\n'));
  try {
    await ffrun(inputs.concat(['-filter_complex_script', script, '-map', '[out]'], AUDIO_FORMATS[ext] || AUDIO_FORMATS.mp3, [out]), { ctx, duration: d, label: 'Mixing…' });
  } finally {
    try { fs.unlinkSync(script); } catch (_) { /* ignore */ }
  }
  return out;
}

/** Write a WAV from mono float32 PCM. */
function writeWavFloat(samples, sampleRate, out) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  fs.writeFileSync(out, buf);
  return out;
}

/** Write a WAV from raw s16le PCM. */
function writeWavPcm16(pcm, sampleRate, channels, out) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(out, Buffer.concat([h, pcm]));
  return out;
}

async function duration(file) {
  try { return (await probe(file)).duration; } catch (_) { return 0; }
}

module.exports = { probe, ffrun, toWav16k, toMp3, chunkAudio, frameAt, keyFrames, convertAudio, trim, speed, normalize, concat, mix, writeWavFloat, writeWavPcm16, duration, atempoChain, AUDIO_FORMATS };
