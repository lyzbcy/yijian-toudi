function compareVersions(left, right) {
  const parse = (value) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''))?.slice(1).map(Number);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function selectUpdateAssets(assets, platform, arch) {
  const files = Array.isArray(assets) ? assets : [];
  const download = platform === 'win32'
    ? files.find((item) => /setup.*\.exe$/i.test(item.name || ''))
    : platform === 'darwin'
      ? files.find((item) => new RegExp(`${arch}.*\\.zip$`, 'i').test(item.name || ''))
      : null;
  if (!download) return { download: null, sha256: null };
  const shaFiles = files.filter((item) => /sha256/i.test(item.name || ''));
  const sha256 = shaFiles.find((item) => platform === 'win32' ? /win|setup/i.test(item.name) : /mac|arm64|x64/i.test(item.name))
    || (shaFiles.length === 1 ? shaFiles[0] : null);
  return { download, sha256 };
}

function summarizeRelease(release, current, platform, arch) {
  const latest = String(release.tag_name || '').replace(/^v/, '');
  const selected = selectUpdateAssets(release.assets, platform, arch);
  const convert = (asset) => asset ? { url: asset.browser_download_url, name: asset.name, size: asset.size } : null;
  return {
    configured: true,
    current,
    latest,
    updateAvailable: compareVersions(latest, current) === 1 && Boolean(selected.download),
    url: release.html_url,
    releaseNotes: release.body || '',
    download: convert(selected.download),
    sha256: convert(selected.sha256)
  };
}

module.exports = { compareVersions, selectUpdateAssets, summarizeRelease };
