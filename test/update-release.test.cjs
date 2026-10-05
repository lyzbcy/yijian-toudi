const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, summarizeRelease } = require('../electron/update-release.cjs');

const base = 'https://github.com/lyzbcy/yijian-toudi';
const asset = (name, size = 42) => ({ name, browser_download_url: `${base}/releases/download/v0.5.0/${name}`, size });
const win = asset('yijian-toudi-setup-0.5.0.exe');
const winSha = asset('yijian-toudi-setup-0.5.0.sha256', 100);
const mac = asset('yijian-toudi-0.5.0-arm64.zip', 43);
const macSha = asset('yijian-toudi-0.5.0-arm64.sha256', 100);
const release = { tag_name: 'v0.5.0', html_url: `${base}/releases/tag/v0.5.0`, body: 'notes', assets: [mac, win, winSha, macSha] };

test('semantic version comparison does not mistake an older release for an update', () => {
  assert.equal(compareVersions('0.3.1', '0.5.0'), -1);
  assert.equal(compareVersions('0.5.0', '0.5.0'), 0);
  assert.equal(compareVersions('0.5.1', '0.5.0'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('unknown', '0.5.0'), null);
  assert.equal(summarizeRelease({ ...release, tag_name: 'v0.3.1' }, '0.5.0', 'win32', 'x64').updateAvailable, false);
});

test('untrusted, incomplete, duplicate and prerelease updates are never offered', () => {
  const summarize = patch => summarizeRelease({ ...release, ...patch }, '0.3.1', 'win32', 'x64');
  assert.equal(summarize({ prerelease: true }).updateAvailable, false);
  assert.equal(summarize({ draft: true }).updateAvailable, false);
  assert.equal(summarize({ html_url: 'https://example.test/release' }).updateAvailable, false);
  assert.equal(summarize({ assets: [win] }).reason, 'checksum-missing');
  assert.equal(summarize({ assets: [win, win, winSha] }).reason, 'ambiguous-package');
  assert.equal(summarize({ assets: [{ ...win, browser_download_url: 'https://example.test/win.exe' }, winSha] }).reason, 'invalid-package');
  assert.equal(summarize({ assets: [{ ...win, size: 0 }, winSha] }).updateAvailable, false);
  assert.equal(summarizeRelease(release, '0.3.1', 'win32', 'arm64').updateAvailable, false);
});

test('Windows update uses the NSIS asset and matching checksum', () => {
  const result = summarizeRelease(release, '0.3.1', 'win32', 'x64');
  assert.equal(result.updateAvailable, true);
  assert.equal(result.download.name, win.name);
  assert.equal(result.sha256.name, winSha.name);
});

test('a release without a matching platform asset is not offered as an app update', () => {
  const result = summarizeRelease({ ...release, assets: [mac] }, '0.3.1', 'win32', 'x64');
  assert.equal(result.updateAvailable, false);
  assert.equal(result.download, null);
  assert.equal(summarizeRelease(release, '0.3.1', 'darwin', 'arm64').download.name, mac.name);
});
