const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, summarizeRelease } = require('../electron/update-release.cjs');

const win = { name: 'yijian-toudi-setup-0.5.0.exe', browser_download_url: 'https://example.test/win.exe', size: 42 };
const winSha = { name: 'yijian-toudi-setup-0.5.0.sha256', browser_download_url: 'https://example.test/win.sha256' };
const mac = { name: 'yijian-toudi-0.5.0-arm64.zip', browser_download_url: 'https://example.test/mac.zip', size: 43 };
const release = { tag_name: 'v0.5.0', html_url: 'https://example.test/release', body: 'notes', assets: [mac, win, winSha] };

test('semantic version comparison does not mistake an older release for an update', () => {
  assert.equal(compareVersions('0.3.1', '0.5.0'), -1);
  assert.equal(compareVersions('0.5.0', '0.5.0'), 0);
  assert.equal(compareVersions('0.5.1', '0.5.0'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('unknown', '0.5.0'), null);
  assert.equal(summarizeRelease({ ...release, tag_name: 'v0.3.1' }, '0.5.0', 'win32', 'x64').updateAvailable, false);
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
