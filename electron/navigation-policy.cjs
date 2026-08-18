const { PLATFORM_MANIFESTS } = require('./platform-manifests.cjs');

function allowedHosts(companyId) {
  const manifest = PLATFORM_MANIFESTS[companyId];
  const hosts = new Set();
  for (const track of Object.values(manifest?.tracks || {})) {
    for (const value of Object.values(track || {})) {
      try { hosts.add(new URL(value).hostname); } catch {}
    }
  }
  for (const host of manifest?.trustedAuthHosts || []) hosts.add(host);
  return hosts;
}

function isAllowedWorkspaceUrl(companyId, rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  const hosts = allowedHosts(companyId);
  return [...hosts].some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
}

function assertAllowedWorkspaceUrl(companyId, rawUrl) {
  if (isAllowedWorkspaceUrl(companyId, rawUrl)) return rawUrl;
  const manifest = PLATFORM_MANIFESTS[companyId];
  const name = {
    tencent: '腾讯', bytedance: '字节跳动', xiaomi: '小米', jd: '京东',
    meituan: '美团', baidu: '百度', alibaba: '阿里巴巴', boss: 'BOSS直聘'
  }[manifest?.id] || companyId;
  throw new Error(`目标网址不属于${name}招聘官网或受信登录域，已拒绝打开`);
}

function isRecoverableNavigationAbort(error, companyId, currentUrl) {
  const aborted = error?.code === 'ERR_ABORTED'
    || error?.errno === -3
    || /ERR_ABORTED\s*\(-3\)/.test(error?.message || '');
  return Boolean(aborted && isAllowedWorkspaceUrl(companyId, currentUrl));
}

module.exports = {
  allowedHosts,
  isAllowedWorkspaceUrl,
  assertAllowedWorkspaceUrl,
  isRecoverableNavigationAbort
};
