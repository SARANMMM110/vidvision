'use strict';
// Child process helpers with cancellation (tree kill on Windows) and line callbacks.
const { spawn, execFile } = require('child_process');

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch (_) { /* ignore */ }
  } else {
    try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
  }
}

/**
 * Run a command.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?:string, signal?:AbortSignal, onStdout?:(line:string)=>void, onStderr?:(line:string)=>void, input?:string|Buffer, env?:object, maxBuffer?:number}} opts
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    if (opts.signal && opts.signal.aborted) return reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' }));
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: Object.assign({}, process.env, opts.env || {}),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const max = opts.maxBuffer || 64 * 1024 * 1024;
    let out = '';
    let err = '';
    let bufO = '';
    let bufE = '';
    const onAbort = () => killTree(child);
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    const lines = (chunk, which) => {
      const s = chunk.toString('utf8');
      if (which === 'o') { if (out.length < max) out += s; bufO += s; } else { if (err.length < max) err += s; else err = err.slice(-max / 2) + s; bufE += s; }
      const cb = which === 'o' ? opts.onStdout : opts.onStderr;
      if (!cb) { if (which === 'o') bufO = ''; else bufE = ''; return; }
      let b = which === 'o' ? bufO : bufE;
      const parts = b.split(/\r\n|\n|\r/);
      b = parts.pop();
      if (which === 'o') bufO = b; else bufE = b;
      for (const p of parts) if (p) { try { cb(p); } catch (_) { /* ignore */ } }
    };
    child.stdout.on('data', (c) => lines(c, 'o'));
    child.stderr.on('data', (c) => lines(c, 'e'));
    child.on('error', (e) => {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      reject(Object.assign(new Error(`Could not start ${require('path').basename(cmd)}: ${e.message}`), { code: 'spawn' }));
    });
    child.on('close', (code) => {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      if (opts.onStdout && bufO) opts.onStdout(bufO);
      if (opts.onStderr && bufE) opts.onStderr(bufE);
      if (opts.signal && opts.signal.aborted) return reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' }));
      resolve({ code, stdout: out, stderr: err });
    });
    if (opts.input !== undefined) { child.stdin.write(opts.input); }
    child.stdin.end();
  });
}

/** Run and throw with the tail of stderr on non-zero exit. */
async function runOk(cmd, args, opts = {}) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(-6).join('\n');
    throw Object.assign(new Error(`${require('path').basename(cmd)} failed (exit ${r.code}): ${tail}`), { code: 'proc', stderr: r.stderr });
  }
  return r;
}

module.exports = { run, runOk, killTree };
