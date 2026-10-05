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
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
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

// Per-workspace, short-lived OAuth callbacks. Never store code/state/query data.
// A provider link reached from a trusted page may nominate a first-party callback,
// but that does not grant access to the rest of the callback host.
function createWorkspaceNavigationPolicy(companyId, { now = Date.now } = {}) {
  const callbacks = new Map();
  const manifest = PLATFORM_MANIFESTS[companyId] || {};
  const roots = manifest.oauthCallbackRoots || [];
  function parse(raw) {
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null;
    } catch { return null; }
  }
  function key(u) { return u.origin + u.pathname; }
  const observedCallbackPaths = new Set([...(manifest.trustedAuthPaths || []), ...(manifest.trustedAuthCallbackPaths || [])]
    .map(parse).filter(Boolean).map(key));
  function allows(raw) {
    const u = parse(raw); if (!u) return false;
    if (isAllowedWorkspaceUrl(companyId, raw)) return true;
    if (observedCallbackPaths.has(key(u))) return true;
    const expires = callbacks.get(key(u));
    if (expires && expires > now()) return true;
    callbacks.delete(key(u)); return false;
  }
  function observe(from, target) {
    const u = parse(target);
    if (!u || !allows(from) || !isAllowedWorkspaceUrl(companyId, target)) return;
    for (const parameter of ['redirect_uri', 'redirect_url', 'redirectUrl']) {
      const callback = parse(u.searchParams.get(parameter));
      if (!callback || !roots.some(root => callback.hostname === root || callback.hostname.endsWith(`.${root}`))) continue;
      if (callbacks.size >= 16 && !callbacks.has(key(callback))) callbacks.delete(callbacks.keys().next().value);
      callbacks.set(key(callback), now() + 10 * 60 * 1000);
    }
  }
  return { allows, observe };
}

function isRecoverableNavigationAbort(error, companyId, currentUrl, policy) {
  const aborted = error?.code === 'ERR_ABORTED'
    || error?.errno === -3
    || /ERR_ABORTED\s*\(-3\)/.test(error?.message || '');
  return Boolean(aborted && (policy ? policy.allows(currentUrl) : isAllowedWorkspaceUrl(companyId, currentUrl)));
}

module.exports = {
  allowedHosts,
  isAllowedWorkspaceUrl,
  assertAllowedWorkspaceUrl,
  createWorkspaceNavigationPolicy,
  isRecoverableNavigationAbort
};
