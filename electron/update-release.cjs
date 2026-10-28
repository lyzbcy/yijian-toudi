function compareVersions(left, right) {
  const parse = value => {
    const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value||''));
    const parts=m?.slice(1).map(Number);return parts?.every(Number.isSafeInteger)?parts:null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

const UPDATE_REPO='lyzbcy/yijian-toudi';
function trustedAssetUrl(raw,version,name,repo=UPDATE_REPO) {
  try {const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='github.com'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&decodeURIComponent(u.pathname)===`/${repo}/releases/download/v${version}/${name}`;}catch{return false;}
}
function selectUpdateAssets(assets, platform, arch, version, repo=UPDATE_REPO) {
  const files = Array.isArray(assets) ? assets : [];
  if(compareVersions(version,version)!==0)return {download:null,sha256:null,reason:'invalid-version'};
  const names=platform==='win32'&&arch==='x64'?[`yijian-toudi-setup-${version}.exe`]:platform==='darwin'&&['arm64','x64'].includes(arch)?[`一键投递-${version}-${arch}.zip`,`yijian-toudi-${version}-${arch}.zip`]:[];
  const downloads=files.filter(a=>names.includes(a.name));
  if(downloads.length!==1)return {download:null,sha256:null,reason:downloads.length?'ambiguous-package':'package-missing'};
  const download=downloads[0];
  if(!trustedAssetUrl(download.browser_download_url,version,download.name,repo)||!Number.isSafeInteger(download.size)||download.size<=0||download.size>600*1024*1024)return {download:null,sha256:null,reason:'invalid-package'};
  const sidecar=download.name.replace(/\.(exe|zip)$/i,'.sha256'),allowed=[sidecar,download.name+'.sha256',`一键投递-${version}-SHA256.txt`,'SHA256SUMS'];
  const hashes=files.filter(a=>allowed.includes(a.name));
  if(hashes.length!==1)return {download,sha256:null,reason:hashes.length?'ambiguous-checksum':'checksum-missing'};
  const sha256=hashes[0];
  if(!trustedAssetUrl(sha256.browser_download_url,version,sha256.name,repo))return {download,sha256:null,reason:'invalid-checksum'};
  return {download,sha256,reason:null};
}

function summarizeRelease(release, current, platform, arch) {
  const latest = String(release.tag_name || '').replace(/^v/, '');
  const valid=compareVersions(latest,latest)===0&&!release.draft&&!release.prerelease&&release.html_url===`https://github.com/${UPDATE_REPO}/releases/tag/v${latest}`;
  const selected = valid?selectUpdateAssets(release.assets,platform,arch,latest):{download:null,sha256:null,reason:'not-trusted-stable-release'};
  const convert = (asset) => asset ? { url: asset.browser_download_url, name: asset.name, size: asset.size } : null;
  return {
    configured: true,
    current,
    latest,
    updateAvailable: valid&&compareVersions(latest, current)===1&&Boolean(selected.download&&selected.sha256),
    latestNewer: valid&&compareVersions(latest,current)===1,
    reason: selected.reason,
    url: `https://github.com/${UPDATE_REPO}/releases`,
    releaseNotes: release.body || '',
    download: convert(selected.download),
    sha256: convert(selected.sha256)
  };
}

module.exports = { compareVersions, selectUpdateAssets, summarizeRelease, trustedAssetUrl, UPDATE_REPO };
