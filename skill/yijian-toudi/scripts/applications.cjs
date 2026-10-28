#!/usr/bin/env node
'use strict';
// No dependencies, no website credentials. JSON comes from a private file/stdin.
const fs = require('node:fs');
const version = require('../version.json').version;
async function run() {
  const base = new URL(process.env.YJTD_BASE_URL || 'http://127.0.0.1:53147');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw Error('loopback-base-required');
  const token = process.env.YJTD_API_TOKEN;
  if (!token) throw Error('YJTD_API_TOKEN-required');
  const headers = { Authorization: 'Bearer ' + token };
  async function request(route, options = {}) {
    const r = await fetch(new URL(route, base), { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    const result = await r.json();
    if (!r.ok) throw Error('HTTP ' + r.status + ': ' + (result.error || 'request-failed'));
    return result;
  }
  if ((await request('/v1/status')).version !== version) throw Error('app-skill-version-mismatch');
  const [mode, arg, extra] = process.argv.slice(2);
  let result;
  if (mode === 'list') {
    const q = new URLSearchParams({ accountId: arg || '', profileId: extra || '' });
    result = await request('/v1/applications?' + q);
  } else if (mode === 'write' && arg && extra) {
    const body = fs.readFileSync(arg === '-' ? 0 : arg, 'utf8');
    JSON.parse(body);
    result = await request('/v1/applications', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': extra }, body });
  } else if (['source-import', 'iguopin-inspect', 'zhilian-read', 'zhilian-import', 'zhilian-inspect'].includes(mode) && arg) {
    const body = fs.readFileSync(arg === '-' ? 0 : arg, 'utf8'); JSON.parse(body);
    result = await request(({'source-import':'/v1/job-sources/offerbiu/import','iguopin-inspect':'/v1/applications/iguopin/inspect','zhilian-read':'/v1/applications/zhilian-campus/read','zhilian-import':'/v1/job-sources/zhilian-campus/import','zhilian-inspect':'/v1/applications/zhilian-campus/inspect'})[mode],
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  } else throw Error('usage: applications.cjs list ACCOUNT PROFILE | write FILE STABLE_KEY | source-import FILE | iguopin-inspect FILE | zhilian-read FILE | zhilian-import FILE | zhilian-inspect FILE');
  console.log(JSON.stringify(result, null, 2));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
