'use strict';
// Isolated archive-runtime verification. The notification transport and proxy
// client addresses are fixtures; no real webhook or production state is used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { readArchive, verifyArchive } = require('../scripts/package-feedback.cjs');

const [archive, checksum, version, output] = process.argv.slice(2);
if (!archive || !checksum || !version || !output) throw Error('Usage: ARCHIVE CHECKSUM VERSION REPORT');
const root = path.resolve(__dirname, '..');
const base = fs.mkdtempSync(path.join(root, '.local-data', 'feedback-backup-load-'));
const report = {
  ok: false, version, platform: process.platform, at: new Date().toISOString(),
  scope: 'Actual sealed archive module, loopback HTTP, fixture notification transport and trusted-proxy client addresses',
  realWecom: false, productionLoadProven: false, productionBackupProven: false,
  productBugRateBelowOnePercentProven: false, checks: [],
};
let server;
const close = async () => {
  if (!server) return;
  const current = server;
  server = null;
  await new Promise((resolve, reject) => current.close(error => error ? reject(error) : resolve()));
};
const inventory = directory => {
  const files = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative + '/');
      else {
        assert(entry.isFile(), 'Only regular fixture files may be backed up');
        const bytes = fs.readFileSync(path.join(dir, entry.name));
        files.push({ name: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
      }
    }
  };
  walk(directory);
  return files.sort((a, b) => a.name.localeCompare(b.name));
};

(async () => {
  report.archive = verifyArchive(archive, checksum, version);
  const unpacked = path.join(base, 'archive');
  for (const [name, bytes] of readArchive(fs.readFileSync(archive), version)) {
    const file = path.join(unpacked, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { flag: 'wx' });
  }
  const { createFeedbackServer } = require(path.join(unpacked, 'support', 'feedback-server.cjs'));
  let now = Date.now(), notified = 0;
  const notify = async text => {
    notified++;
    await new Promise(resolve => setTimeout(resolve, 20));
    if (text.includes('unknown-fixture')) throw Error('fixture-transport-unknown');
    return { sent: !text.includes('failed-fixture') };
  };
  const start = async dataDir => {
    server = createFeedbackServer({
      dataDir, publicBaseUrl: 'https://feedback.invalid/', trustProxy: true,
      notify, clock: () => now, cleanupIntervalMs: 0,
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const request = async (url, suffix, client, payload) => {
    const started = performance.now();
    const response = await fetch(url + suffix, {
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
      ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json(), ms: performance.now() - started };
  };
  const source = path.join(base, 'source');
  const data = path.join(source, 'data');
  const url = await start(data);
  // Private configuration is deliberately a dummy file and stays ignored.
  fs.writeFileSync(path.join(source, 'feedback.env'), 'YJT_FEEDBACK_PUBLIC_URL=https://feedback.invalid/\n# fixture only; no credential\n', { mode: 0o600 });
  const samples = Array.from({ length: 200 }, (_, index) => ({
    client: '192.0.2.' + (Math.floor(index / 10) + 1),
    expected: index < 180 ? 'sent' : index < 190 ? 'failed' : 'unknown',
    payload: {
      requestId: crypto.randomUUID(), version, kind: 'bug', category: '',
      message: '备份负载验收样本 ' + (index < 180 ? 'sent-fixture' : index < 190 ? 'failed-fixture' : 'unknown-fixture'),
      logs: { platform: process.platform, entries: [{ level: 'info', msg: 'refresh', meta: { count: index } }] },
    },
  }));
  const started = performance.now();
  const results = await Promise.all(samples.map(sample => request(url, '/v1/feedback', sample.client, sample.payload)));
  results.forEach((result, index) => {
    assert.equal(result.status, samples[index].expected === 'sent' ? 200 : 503);
    assert.equal(result.body.status, samples[index].expected);
    assert.equal(result.body.requestId, samples[index].payload.requestId);
  });
  assert.equal(notified, 200);
  const latencies = results.map(result => result.ms).sort((a, b) => a - b);
  report.load = {
    concurrentRequests: 200, fixtureProxyClients: 20, defaultRequestsPerClientPerMinute: 10,
    durationMs: Math.round(performance.now() - started), p50Ms: Math.round(latencies[99]),
    p95Ms: Math.round(latencies[189]), maxMs: Math.round(latencies[199]),
    expectedSent: 180, injectedFailed: 10, injectedUnknown: 10,
  };
  const extra = await Promise.all(samples.filter((_, index) => index % 10 === 0).map(sample =>
    request(url, '/v1/feedback', sample.client, { ...sample.payload, requestId: crypto.randomUUID() })));
  extra.forEach(result => assert.equal(result.status, 429));
  assert.equal(notified, 200);
  const health = await request(url, '/healthz', samples[0].client);
  assert.equal(health.status, 200);
  assert.equal(health.body.version, version);
  report.checks.push('200 concurrent real HTTP requests persist 180 sent, 10 failed and 10 unknown fixture outcomes; each of 20 proxy-client limits rejects request 11, health remains available');

  await close();
  const before = inventory(source);
  assert.equal(before.length, 401); // 200 receipts, 200 logs, fixture environment.
  const backup = path.join(base, 'backup');
  fs.cpSync(source, backup, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(inventory(backup), before);
  // Recovery uses a new empty root. It cannot accidentally read original state.
  fs.renameSync(source, path.join(base, 'offline-original'));
  const restored = path.join(base, 'restored');
  fs.cpSync(backup, restored, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(inventory(restored), before);
  report.backup = { stoppedBeforeCopy: true, restoredToFreshRoot: true, files: before.length, byteHashMatched: true };
  report.checks.push('Stopped service backup includes all receipts, logs and dummy private config; fresh-root restore matches every file byte/hash with original root moved offline');

  now += 60001;
  const restoredUrl = await start(path.join(restored, 'data'));
  const receipts = await Promise.all(samples.map(sample => request(restoredUrl, '/v1/feedback/' + sample.payload.requestId, sample.client)));
  receipts.forEach((result, index) => {
    assert.equal(result.status, 200);
    assert.equal(result.body.status, samples[index].expected);
    assert.equal(result.body.ok, samples[index].expected === 'sent');
    if (samples[index].expected !== 'sent') assert.equal(result.body.logUrl, null);
  });
  now += 60001;
  const replay = await Promise.all(samples.map(sample => request(restoredUrl, '/v1/feedback', sample.client, sample.payload)));
  replay.forEach((result, index) => {
    assert.equal(result.status, samples[index].expected === 'sent' ? 200 : 409);
    assert.equal(result.body.status, samples[index].expected);
  });
  assert.equal(notified, 200, 'Restoration and replay must never re-notify');
  report.checks.push('Fresh restored server returns all 200 original outcomes and rejects re-sending failed/unknown receipts; concurrent replay makes zero new notification calls');
  now += 60001;
  const conflict = await request(restoredUrl, '/v1/feedback', samples[0].client, { ...samples[0].payload, message: 'different fixture content' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'id-conflict');
  const logPath = new URL(receipts[0].body.logUrl).pathname;
  const log = await fetch(restoredUrl + logPath, { signal: AbortSignal.timeout(15000) });
  assert.equal(log.status, 200);
  assert.match(log.headers.get('content-type'), /^text\/plain/);
  assert.equal(log.headers.get('cache-control'), 'no-store');
  assert.equal(log.headers.get('x-content-type-options'), 'nosniff');
  assert.match(log.headers.get('x-robots-tag'), /noindex/);
  assert.equal(JSON.parse(await log.text()).entries[0].meta.count, 0);
  assert.equal(notified, 200);
  await close();
  assert.deepEqual(inventory(restored), before);
  report.checks.push('Restored same-ID/different-content conflict is rejected, original diagnostic content and protective headers remain valid, all stored bytes stay unchanged');
  report.notificationCalls = { initialFixture: notified, afterRestoreAndReplay: 0, realExternal: 0 };
  report.ok = true;
})().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(async () => {
  await close();
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, report: output, error: report.error }));
});
