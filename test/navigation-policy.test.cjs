const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertAllowedWorkspaceUrl,
  isAllowedWorkspaceUrl,
  isRecoverableNavigationAbort
} = require('../electron/navigation-policy.cjs');

test('内嵌工作区只允许当前平台官网域名及其子域名', () => {
  assert.equal(isAllowedWorkspaceUrl('tencent', 'https://careers.tencent.com/resume.html'), true);
  assert.equal(isAllowedWorkspaceUrl('tencent', 'https://join.qq.com/login.html'), true);
  assert.equal(isAllowedWorkspaceUrl('tencent', 'https://evil.example/phish'), false);
  assert.equal(isAllowedWorkspaceUrl('tencent', 'javascript:alert(1)'), false);
});

test('首次 loadURL 前就拒绝跨域地址，不能只依赖后续导航事件', () => {
  assert.throws(
    () => assertAllowedWorkspaceUrl('tencent', 'https://evil.example/phish'),
    /不属于腾讯招聘官网/
  );
  assert.doesNotThrow(() => assertAllowedWorkspaceUrl('tencent', 'https://careers.tencent.com/resume.html'));
});

test('各平台显式受信 SSO 域可留在内嵌会话完成登录，未知域仍拒绝', () => {
  assert.equal(isAllowedWorkspaceUrl('tencent', 'https://open.weixin.qq.com/connect/qrconnect'), true);
  assert.equal(isAllowedWorkspaceUrl('tencent', 'https://smartproxy.tencent.com/login/wx_callback'), true);
  assert.equal(isAllowedWorkspaceUrl('jd', 'https://passport.jd.com/new/login.aspx'), true);
  assert.equal(isAllowedWorkspaceUrl('alibaba', 'https://login.taobao.com/member/login.jhtml'), true);
  assert.equal(isAllowedWorkspaceUrl('bytedance', 'https://sso.bytedance.com/login'), true);
  assert.equal(isAllowedWorkspaceUrl('bytedance', 'https://phish.example/login'), false);
});

test('内嵌工作区对导航和重定向使用同一策略', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../electron/login-manager.cjs'), 'utf8');
  assert.match(source, /will-navigate/);
  assert.match(source, /will-redirect/);
  assert.doesNotMatch(source, /enforceNavigationPolicy[\s\S]{0,280}shell\.openExternal/);
});

test('登录中心从 manifest 的受信登录入口打开，不直接使用可变 portal', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../electron/login-manager.cjs'), 'utf8');
  assert.match(source, /resolvePlatformUrl\(company\.id, 'social', 'login'\)/);
  assert.doesNotMatch(source, /url:\s*company\.portal/);
});

test('只有已跳到当前平台白名单内时，才把 Electron 重定向 ERR_ABORTED 当作可恢复', () => {
  const aborted = Object.assign(new Error("ERR_ABORTED (-3) loading 'https://join.qq.com/login.html'"), { code: 'ERR_ABORTED' });
  assert.equal(isRecoverableNavigationAbort(aborted, 'tencent', 'https://join.qq.com/login.html?state=resume'), true);
  assert.equal(isRecoverableNavigationAbort(aborted, 'tencent', 'https://evil.example/phish'), false);
  assert.equal(isRecoverableNavigationAbort(new Error('ERR_CONNECTION_REFUSED'), 'tencent', 'https://join.qq.com/login.html'), false);
  assert.equal(isRecoverableNavigationAbort(aborted, 'unknown', 'https://join.qq.com/login.html'), false);
});
