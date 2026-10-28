#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const skillVersion = require('../version.json').version;

function dayInShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const field = (type) => parts.find((part) => part.type === type).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function confirmsStart(result, accountId, target, dryRun) {
  return Boolean(result && !Array.isArray(result) && result.started === true && result.accountId === accountId && result.target === target && result.dryRun === dryRun && typeof result.runId === 'string' && result.runId && result.runId.trim() === result.runId && result.runId.length <= 128 && !/[\x00-\x1f\x7f]/.test(result.runId));
}

async function run({ env = process.env, request = fetch, now = new Date() } = {}) {
  const token = env.YJTD_API_TOKEN;
  if (!token) throw new Error('YJTD_API_TOKEN is required');
  const base = new URL(env.YJTD_BASE_URL || 'http://127.0.0.1:53147');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.pathname !== '/' || base.username || base.password || base.search || base.hash) {
    throw new Error('YJTD_BASE_URL must be a loopback HTTP origin');
  }
  const accountId = env.YJTD_ACCOUNT_ID || 'default';
  const target = Number(env.YJTD_TARGET || '100');
  if (!Number.isInteger(target) || target < 1) throw new Error('YJTD_TARGET must be a positive integer');
  if (![undefined, '', '0', '1'].includes(env.YJTD_DRY_RUN)) throw new Error('YJTD_DRY_RUN must be 1 (preview), 0, or unset (live)');
  const dryRun = env.YJTD_DRY_RUN === '1';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function api(route, body) {
    const response = await request(new URL(route, base), { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(`${route}: ${data.error || response.status}`);
    return data;
  }
  const status = await api('/v1/status');
  if (status.version !== skillVersion) throw new Error(`version mismatch: app=${status.version} skill=${skillVersion}`);
  const accounts = await api('/v1/boss/accounts');
  if (!accounts.accounts?.some((account) => account.id === accountId)) throw new Error(`account not found: ${accountId}`);
  const cap = accountId === 'default' ? 120 : 50;
  if (target > cap) throw new Error(`target ${target} exceeds account cap ${cap}`);
  const stateDir = env.YJTD_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'yijian-toudi-skill');
  const marker = path.join(stateDir, `${dayInShanghai(now)}-${encodeURIComponent(accountId)}.json`);
  const lockName = `launch-${encodeURIComponent(accountId)}.lock`;
  const lock = path.join(stateDir, lockName), ownerToken = randomUUID();
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(lock, JSON.stringify({ ownerToken, pid: process.pid, at: now.toISOString(), accountId }) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') return { skipped: 'start-locked', marker: lockName }; throw error; }
  // Reserve the account across all dates BEFORE inspecting its records. A
  // second process must not act on a scan taken before an unknown POST exists.
  try {
  const batch = await api('/v1/boss/batch/status');
  if (['running', 'stopping', 'requiresReview'].some(key => typeof batch[key] !== 'boolean')) throw new Error('batch status response is incomplete; check the app before starting');
  if (batch.requiresReview) return { skipped: 'requires-review' };
  if (batch.stopping) return { skipped: 'already-stopping' };
  if (batch.running) return { skipped: 'already-running' };
  if (batch.pending != null) return { skipped: 'requires-review' };
  // An unconfirmed POST remains unknown after midnight. Only the selected
  // account's dated records participate; another customer's pause is separate.
  let records = [];
  try { records = fs.readdirSync(stateDir); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const suffix = `-${encodeURIComponent(accountId)}.json`;
  for (const name of records.sort()) {
    if (!/^\d{4}-\d{2}-\d{2}-/.test(name) || name.slice(10) !== suffix) continue;
    let previous;
    try { previous = JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8')); }
    catch { return { skipped: 'unconfirmed-start', marker: name }; }
    if (previous?.accountId !== accountId || previous.state !== 'started' || !Number.isInteger(previous.target) || previous.target < 1 || previous.target > cap || !confirmsStart(previous.result, accountId, previous.target, false)) return { skipped: 'unconfirmed-start', marker: name };
  }
  if (!dryRun) {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(marker, JSON.stringify({ at: now.toISOString(), accountId, target, state: 'starting' }) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') return { skipped: 'already-triggered-today' }; throw error; }
  }
  try {
    const result = await api('/v1/boss/batch/start', { accountId, target, dryRun });
    if (!confirmsStart(result, accountId, target, dryRun)) {
      throw new Error('batch start response did not confirm the requested account, target, mode and runId');
    }
    if (!dryRun) fs.writeFileSync(marker, JSON.stringify({ at: now.toISOString(), accountId, target, state: 'started', result }) + '\n', { mode: 0o600 });
    return { started: true, dryRun, accountId, target, result };
  } catch (error) {
    // A failed POST may still have reached the app. Keep marker until a person checks status.
    throw error;
  }
  } finally {
    // Never unlink another invocation's lock or break one by elapsed time.
    if (JSON.parse(fs.readFileSync(lock, 'utf8')).ownerToken !== ownerToken) throw new Error('start lock ownership changed; review the account state');
    fs.unlinkSync(lock);
  }
}

if (require.main === module) {
  run().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { run, dayInShanghai };
