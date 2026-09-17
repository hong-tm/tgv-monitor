'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PROJECT_DIR = path.join(__dirname, '..');

// The stub is written into require.cache BEFORE monitor.js is required, so monitor's
// `require('axios')` resolves to this object and no real HTTP client can ever be reached.
const ENTRY_GUARD_SCRIPT = `
const axiosPath = require.resolve('axios');
let calls = 0;
const stub = { post: async () => { calls += 1; return { data: { ok: true, result: [] } }; } };
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: stub };
require('./monitor.js');
console.log('STUB_CALLS=' + calls);
`;

const POLLING_SCRIPT = `
const axiosPath = require.resolve('axios');
let calls = 0;
const stub = { post: () => { calls += 1; return new Promise((resolve) => setTimeout(() => resolve(null), 1)); } };
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: stub };
const monitor = require('./monitor.js');
monitor.startTelegramPolling();
setTimeout(() => { console.log('STUB_CALLS=' + calls); process.exit(0); }, 1200);
`;

function runChild(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { cwd: PROJECT_DIR });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`child timed out after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test('requiring monitor.js does not start the bot or reach the network', async () => {
  const start = Date.now();
  const { code, stdout, stderr } = await runChild(ENTRY_GUARD_SCRIPT);
  const elapsed = Date.now() - start;

  assert.equal(code, 0, `child exited ${code}\nstderr:\n${stderr}`);
  assert.match(stdout, /STUB_CALLS=0/, `expected zero stub calls, got:\n${stdout}\n${stderr}`);
  assert.ok(elapsed < 5000, `require() should return promptly, took ${elapsed}ms`);
});

test('startTelegramPolling backs off when Telegram is unreachable (no busy-spin)', async () => {
  const { code, stdout, stderr } = await runChild(POLLING_SCRIPT);

  assert.equal(code, 0, `child exited ${code}\nstderr:\n${stderr}`);
  const match = stdout.match(/STUB_CALLS=(\d+)/);
  assert.ok(match, `missing STUB_CALLS marker in:\n${stdout}\n${stderr}`);

  const calls = Number(match[1]);
  assert.ok(calls >= 1, 'polling should attempt getUpdates at least once');
  assert.ok(
    calls <= 5,
    `expected <= 5 calls in ~1200ms when Telegram is unreachable, got ${calls} (busy-spin regression?)`
  );
});
