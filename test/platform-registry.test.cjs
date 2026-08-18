const test = require('node:test');
const assert = require('node:assert/strict');

const { getAdapter, capabilityMatrix } = require('../electron/adapters/registry.cjs');
const {
  PLATFORM_MANIFESTS,
  normalizeTrack,
  resolvePlatformUrl,
  verifyObservedValue
} = require('../electron/platform-manifests.cjs');

test('腾讯、字节、阿里注册简历更新入口', () => {
  for (const id of ['tencent', 'bytedance', 'alibaba']) {
    const adapter = getAdapter(id);
    assert.ok(adapter, `${id} 必须进入 registry`);
    assert.equal(typeof adapter.listJobs, 'function', `${id} 必须有职位抓取入口`);
    assert.equal(typeof adapter.fillResume, 'function', `${id} 必须有简历更新入口`);
    assert.ok(PLATFORM_MANIFESTS[id], `${id} 必须有平台 manifest`);
  }
});

test('BOSS 仅保留官方深链，不暴露内嵌简历更新能力', () => {
  const boss = getAdapter('boss');
  assert.ok(boss);
  assert.equal(typeof boss.listJobs, 'function');
  assert.equal(boss.fillResume, null);
  assert.equal(boss.prepareApplication, null);
  assert.ok(PLATFORM_MANIFESTS.boss);
});

test('“全部都要”不是单一简历轨道，禁止静默降级成社招', () => {
  assert.throws(() => normalizeTrack('all'), /拆分为社招和校招/);
});

test('未通过真实保存校验的平台不得标成 verified', () => {
  const caps = Object.fromEntries(capabilityMatrix().map((item) => [item.id, item]));
  assert.notEqual(caps.alibaba.resume, 'verified');
  assert.notEqual(caps.boss.resume, 'verified');
});

test('平台 URL 只允许 manifest 声明的 https 招聘域名', () => {
  assert.match(resolvePlatformUrl('alibaba', 'social', 'resume'), /^https:\/\/talent\.alibaba\.com\//);
  assert.match(resolvePlatformUrl('boss', 'social', 'jobs'), /^https:\/\/www\.zhipin\.com\//);
  assert.throws(() => resolvePlatformUrl('boss', 'social', 'submit'), /未声明/);
});

test('逐字段回读必须严格相等，数组忽略顺序但不忽略缺项', () => {
  assert.equal(verifyObservedValue('张三', '张三'), true);
  assert.equal(verifyObservedValue('张三', '张三丰'), false);
  assert.equal(verifyObservedValue(['北京', '上海'], ['上海', '北京']), true);
  assert.equal(verifyObservedValue(['北京', '上海'], ['北京']), false);
});

test('所有平台 manifest 明确禁止自动点击投递提交', () => {
  for (const manifest of Object.values(PLATFORM_MANIFESTS)) {
    assert.equal(manifest.safety?.autoSubmitApplication, false, manifest.id);
  }
});

test('投递适配器源码不得执行 click 或 submit', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../electron/adapters/tencent-apply.cjs'), 'utf8');
  assert.doesNotMatch(source, /\.click\s*\(/);
  assert.doesNotMatch(source, /\.submit\s*\(/);
});

test('登录探测不能因登录页有手机号输入框就当成简历表单', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../electron/form-inspection.cjs'), 'utf8');
  assert.match(source, /one-time-code|验证码/);
  assert.doesNotMatch(source, /Boolean\(loginControl\) && inputCount === 0/);
});

test('BOSS manifest 明确禁止未经授权的第三方自动化', () => {
  assert.equal(PLATFORM_MANIFESTS.boss.safety.thirdPartyAutomationAllowed, false);
  assert.match(PLATFORM_MANIFESTS.boss.safety.restriction, /协议/);
});
