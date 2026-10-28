#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');

function configFromEnvironmentOrFile(argv = process.argv.slice(2), env = process.env) {
  const index = argv.indexOf('--config');
  const config = index < 0 ? { baseUrl: env.YJTD_BASE_URL, token: env.YJTD_TOKEN } : JSON.parse(fs.readFileSync(argv[index + 1], 'utf8').replace(/^\uFEFF/, ''));
  const url = new URL(config.baseUrl || 'http://127.0.0.1:53147');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error('local-api-base-url-required');
  if (typeof config.token !== 'string' || !config.token || /[\r\n]/.test(config.token)) throw Error('explicit-runtime-token-required');
  // Never infer a token from APPDATA/state.json: launch contexts can expose
  // different storage views. Use the running app's connection page instead.
  return { baseUrl: url.origin, token: config.token };
}
function get(config, pathname) {
  return new Promise((resolve, reject) => {
    const q = http.get(new URL(pathname, config.baseUrl), { headers: { Authorization: `Bearer ${config.token}` } }, r => {
      const parts = []; let size = 0;
      r.on('data', b => { size += b.length; if (size > 128 * 1024) q.destroy(Error('diagnostic-response-too-large')); else parts.push(b); });
      r.on('end', () => { try { resolve({ http: r.statusCode, data: JSON.parse(Buffer.concat(parts).toString('utf8')) }); } catch { reject(Error('invalid-api-response')); } });
      r.on('error', () => reject(Error('api-response-interrupted')));
    });
    q.setTimeout(5000, () => q.destroy(Error('api-timeout')));
    q.on('error', () => reject(Error('api-unreachable-or-timeout')));
  });
}
async function probe(config) {
  const status = await get(config, '/v1/status');
  if (status.http !== 200) return { ok: false, http: status.http, reason: status.http === 401 ? 'runtime-token-rejected' : 'api-status-rejected' };
  const storage = await get(config, '/v1/diagnostics/storage');
  if (storage.http !== 200) return { ok: false, version: status.data.version, http: storage.http, reason: 'storage-diagnostics-unavailable' };
  const s = storage.data.storage;
  return { ok: status.data.ok === true && s?.readable === true && s?.tokenMatchesMemory === true && s?.resumeMatchesMemory === true, version: status.data.version, http: 200,
    storage: { supported: s?.supported === true, readable: s?.readable === true, reason: s?.reason, bytes: s?.bytes, tokenMatchesMemory: s?.tokenMatchesMemory, resumeMatchesMemory: s?.resumeMatchesMemory, jobs: s?.jobs } };
}
if (require.main === module) {
  (async () => { const result = await probe(configFromEnvironmentOrFile()); console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; })().catch(() => { console.error('AGENT_PROBE_FAILED; check local API and private runtime-token configuration'); process.exitCode = 1; });
}
module.exports = { configFromEnvironmentOrFile, probe };
