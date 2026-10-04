'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { createDesktopUpdater, checksumFor, shanghaiDay, finalResponseUrl, API } = require('../electron/desktop-updater.cjs');
const { validateStagedUpdate, confirmUpdateRestart } = require('../electron/windows-update.cjs');
const version = '0.5.35', name = `yijian-toudi-setup-${version}.exe`;
const prefix = `https://github.com/lyzbcy/yijian-toudi/releases/download/v${version}/`;
const body = Buffer.from('local-update-fixture-not-an-executable');
const digest = crypto.createHash('sha256').update(body).digest('hex');
const release = { tag_name: `v${version}`, html_url: `https://github.com/lyzbcy/yijian-toudi/releases/tag/v${version}`, assets: [{ name, size: body.length, browser_download_url: prefix + name }, { name: name.replace('.exe', '.sha256'), size: 100, browser_download_url: prefix + name.replace('.exe', '.sha256') }] };
async function fixture(t, fetchOverride) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yjt-updater-boundary-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let state = { meta: {} }, clock = new Date('2026-10-03T16:00:00Z');
  const store = { get: () => structuredClone(state), update: fn => { state = fn(structuredClone(state)); return state; } };
  const requests = [], progress = [];
  const fetchFn = async (url, options) => {
    requests.push(url);
    if (fetchOverride) return fetchOverride(url, options);
    const data = url === API ? JSON.stringify(release) : url.endsWith('.sha256') ? `${digest}  ${name}\n` : body;
    return new Response(data, { status: 200 });
  };
  return { directory, store, requests, progress, setClock: value => { clock = new Date(value); }, updater: createDesktopUpdater({ directory, store, fetchFn, current: '0.5.34', platform: 'win32', arch: 'x64', now: () => clock, onProgress: p => progress.push(p) }) };
}
test('checksum binds exact filename and rejects duplicated or unrelated checksums', () => {
  assert.equal(checksumFor(`${digest}  ${name}`, name, name + '.sha256'), digest);
  assert.throws(() => checksumFor(`${digest}  other.exe`, name, name + '.sha256'), /missing/);
  assert.throws(() => checksumFor(`${digest}  ${name}\n${digest}  ${name}`, name, name + '.sha256'), /ambiguous/);
  assert.throws(() => checksumFor(digest, name, 'SHA256SUMS'), /missing/);
  assert.equal(checksumFor(digest, name, name.replace('.exe', '.sha256')), digest);
});
test('update dates use Shanghai midnight and response origins reject arbitrary redirects', () => {
  assert.equal(shanghaiDay(new Date('2026-10-03T15:59:59Z')), '2026-10-03');
  assert.equal(shanghaiDay(new Date('2026-10-03T16:00:00Z')), '2026-10-04');
  assert.equal(finalResponseUrl('https://release-assets.githubusercontent.com/file'), true);
  for (const url of ['http://github.com/file', 'https://github.com:444/file', 'https://evil.test/file', 'https://user@github.com/file']) assert.equal(finalResponseUrl(url), false);
});
test('failed automatic check is durable and daily retry requires next Shanghai day or manual action', async t => {
  const f = await fixture(t, async () => { throw Error('offline-fixture'); });
  await assert.rejects(f.updater.check({ manual: false }), /offline-fixture/);
  assert.equal(f.store.get().meta.desktopUpdate.attemptDay, '2026-10-04');
  assert.equal(f.store.get().meta.desktopUpdate.successDay, undefined);
  const cached = await f.updater.check({ manual: false });
  assert.equal(cached.updateAvailable, false); assert.equal(cached.skipped, true); assert.equal(f.requests.length, 1);
  await assert.rejects(f.updater.check({ manual: true }), /offline-fixture/); assert.equal(f.requests.length, 2);
  f.setClock('2026-10-04T16:00:00Z'); await assert.rejects(f.updater.check({ manual: false }), /offline-fixture/); assert.equal(f.requests.length, 3);
});
test('concurrent checks use one actual network operation', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.updater.check(), f.updater.check()]);
  assert.equal(f.requests.length, 1); assert.equal(results[0].latest, version); assert.equal(results[1].updateAvailable, true);
});
test('verified download writes bytes and progress without claiming installation', async t => {
  const f = await fixture(t), result = await f.updater.download({ version });
  assert.equal(result.installed, false); assert.equal(result.staged, true); assert.equal(result.sha256, digest);
  assert.deepEqual(await fs.readFile(result.file), body);
  assert.equal(f.progress.at(-1).phase, 'verified'); assert.equal(f.progress.at(-1).percent, 100);
  assert.equal(await validateStagedUpdate(result, { directory: f.directory, current: '0.5.34' }), result);
  await fs.writeFile(result.file, Buffer.alloc(body.length, 1));
  await assert.rejects(validateStagedUpdate(result, { directory: f.directory, current: '0.5.34' }), /staged-update-changed/);
});
test('renderer cannot substitute update URL or unknown request parameters', async t => {
  const f = await fixture(t);
  await assert.rejects(f.updater.download({ version, downloadUrl: 'https://evil.test/package.exe' }), /release-target-mismatch/);
  await assert.rejects(f.updater.download({ version, execute: true }), /invalid-download-request/);
  assert.ok(f.requests.every(url => url === API));
  assert.deepEqual(await fs.readdir(f.directory), []);
});
test('corrupted download deletes incomplete payload and retains a previous verified package', async t => {
  const f = await fixture(t, async url => new Response(url === API ? JSON.stringify(release) : url.endsWith('.sha256') ? `${'0'.repeat(64)}  ${name}` : body));
  const previous = path.join(f.directory, 'previous-verified.bin'); await fs.writeFile(previous, 'keep-old');
  await assert.rejects(f.updater.download({ version }), /package-sha256-mismatch/);
  assert.equal(await fs.readFile(previous, 'utf8'), 'keep-old'); assert.equal(f.progress.at(-1).phase, 'failed');
  for (const directory of (await fs.readdir(f.directory)).filter(n => n.startsWith('download-'))) assert.deepEqual(await fs.readdir(path.join(f.directory, directory)), []);
});
test('truncated response and untrusted final download origins are rejected', async t => {
  for (const mode of ['truncated', 'origin']) {
    const f = await fixture(t, async url => {
      if (url === API) return new Response(JSON.stringify(release));
      if (url.endsWith('.sha256')) return new Response(`${digest}  ${name}`);
      const response = new Response(mode === 'truncated' ? body.subarray(0, -1) : body, { headers: { 'content-length': String(body.length) } });
      if (mode === 'origin') Object.defineProperty(response, 'url', { value: 'https://evil.test/payload' });
      return response;
    });
    await assert.rejects(f.updater.download({ version }), mode === 'origin' ? /untrusted-response-origin/ : /truncated-response/);
  }
});
test('restart confirmation requires visible matching new version, nonce, executable and registry', async t => {
  const f = await fixture(t), executable = path.join(f.directory, 'installed', '一键投递.exe');
  const pending = { nonce: 'fixture-nonce', version, exe: executable };
  const result = { status: 'installed', version, nonce: pending.nonce, exe: executable };
  await fs.writeFile(path.join(f.directory, 'install-pending.json'), JSON.stringify(pending));
  const resultFile = path.join(f.directory, 'install-result.json'); await fs.writeFile(resultFile, JSON.stringify(result));
  const input = { version, executable, visible: true, readInstallationFn: async () => ({ version, root: path.dirname(executable) }) };
  assert.equal(await confirmUpdateRestart(f.directory, { ...input, visible: false }), null);
  assert.equal(await confirmUpdateRestart(f.directory, { ...input, version: '0.5.34' }), null);
  await fs.writeFile(resultFile, JSON.stringify({ ...result, nonce: 'unrelated' })); assert.equal(await confirmUpdateRestart(f.directory, input), null);
  await fs.writeFile(resultFile, JSON.stringify(result));
  await assert.rejects(confirmUpdateRestart(f.directory, { ...input, readInstallationFn: async () => ({ version: '0.5.34', root: path.dirname(executable) }) }), /restart-installation-mismatch/);
  const confirmed = await confirmUpdateRestart(f.directory, input);
  assert.equal(confirmed.status, 'restarted'); assert.equal(confirmed.runningVersion, version); assert.equal(confirmed.runningExe, executable);
});
