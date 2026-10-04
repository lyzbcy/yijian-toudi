#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skillVersion = require('../version.json').version;

function dayInShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const field = (type) => parts.find((part) => part.type === type).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

async function run({ env = process.env, request = fetch, now = new Date() } = {}) {
  const token = env.YJTD_API_TOKEN;
  if (!token) throw new Error('YJTD_API_TOKEN is required');
  const base = new URL(env.YJTD_BASE_URL || 'http://127.0.0.1:53147');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.pathname !== '/') {
    throw new Error('YJTD_BASE_URL must be a loopback HTTP origin');
  }
  const accountId = env.YJTD_ACCOUNT_ID || 'default';
  const target = Number(env.YJTD_TARGET || '100');
  if (!Number.isInteger(target) || target < 1) throw new Error('YJTD_TARGET must be a positive integer');
  const dryRun = env.YJTD_DRY_RUN === '1';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function api(route, body) {
    const response = await request(new URL(route, base), { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
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
  const batch = await api('/v1/boss/batch/status');
  if (batch.running) return { skipped: 'already-running' };
  if (batch.requiresReview) return { skipped: 'requires-review' };

  const stateDir = env.YJTD_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'yijian-toudi-skill');
  const marker = path.join(stateDir, `${dayInShanghai(now)}-${encodeURIComponent(accountId)}.json`);
  if (!dryRun) {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(marker, JSON.stringify({ at: now.toISOString(), accountId, target, state: 'starting' }) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') return { skipped: 'already-triggered-today' }; throw error; }
  }
  try {
    const result = await api('/v1/boss/batch/start', { accountId, target, dryRun });
    if (result.started !== true || result.accountId !== accountId || result.target !== target) {
      throw new Error('batch start response did not confirm the requested account and target');
    }
    if (!dryRun) fs.writeFileSync(marker, JSON.stringify({ at: now.toISOString(), accountId, target, state: 'started', result }) + '\n', { mode: 0o600 });
    return { started: true, dryRun, accountId, target, result };
  } catch (error) {
    // A failed POST may still have reached the app. Keep marker until a person checks status.
    throw error;
  }
}

if (require.main === module) {
  run().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { run, dayInShanghai };
