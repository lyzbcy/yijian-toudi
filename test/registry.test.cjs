const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../electron/adapters/registry.cjs');
const { fillTencentResume } = require('../electron/adapters/tencent-fill.cjs');
const { applyTencentJob } = require('../electron/adapters/tencent-apply.cjs');

test('registry 注册了 8 家公司，6 家可自动抓岗位，阿里/BOSS 仅官方入口', () => {
  const ids = registry.REGISTRY.map((a) => a.id);
  assert.deepEqual(ids.sort(), ['alibaba', 'baidu', 'boss', 'bytedance', 'jd', 'meituan', 'tencent', 'xiaomi']);
  assert.equal(registry.listJobAdapters().length, 6);
  assert.equal(registry.getAdapter('boss').capabilities.jobs, 'manual');
});

test('registry 的 listJobAdapters 每个都有 listJobs 函数', () => {
  for (const adapter of registry.listJobAdapters()) {
    assert.equal(typeof adapter.listJobs, 'function', `${adapter.id} 缺 listJobs`);
    assert.ok(adapter.idPrefix, `${adapter.id} 缺 idPrefix`);
  }
});

test('腾讯 entry 的 fillResume/prepareApplication 是函数且五维能力正确', () => {
  const tencent = registry.getAdapter('tencent');
  assert.ok(tencent);
  assert.equal(typeof tencent.fillResume, 'function');
  assert.equal(typeof tencent.prepareApplication, 'function');
  // 底层函数仍可直接 require（向后兼容 test-apply.cjs 等）
  assert.equal(typeof fillTencentResume, 'function');
  assert.equal(typeof applyTencentJob, 'function');
  // 腾讯五维能力
  assert.equal(tencent.capabilities.resume, 'degraded');
  assert.equal(tencent.capabilities.apply, 'manual');
});

test('非腾讯且获允许内嵌操作的公司均有安全接管能力', () => {
  // 六家全部走通用自动填写引擎（inspect→匹配→写入→延迟回读，保存永远留给用户）
  const expectedResume = { baidu: 'degraded', bytedance: 'degraded', xiaomi: 'degraded', jd: 'degraded', meituan: 'degraded', alibaba: 'degraded' };
  for (const id of Object.keys(expectedResume)) {
    const adapter = registry.getAdapter(id);
    assert.equal(typeof adapter.fillResume, 'function', `${id}.fillResume 应为填写函数`);
    assert.equal(typeof adapter.prepareApplication, 'function', `${id}.prepareApplication 应为 manual 骨架函数`);
    assert.equal(adapter.capabilities.resume, expectedResume[id]);
    assert.equal(adapter.capabilities.apply, 'manual');
    assert.equal(adapter.capabilities.status, 'unsupported');
  }
});

test('capabilityMatrix 返回扁平五维结构，供前端/介绍页消费', () => {
  const matrix = registry.capabilityMatrix();
  assert.equal(matrix.length, 8);
  const tencent = matrix.find((m) => m.id === 'tencent');
  assert.equal(tencent.jobs, 'verified');
  assert.equal(tencent.resume, 'degraded');
  assert.ok(tencent.name);
});

test('getAdapter 不存在的公司返回 undefined', () => {
  assert.equal(registry.getAdapter('nope'), undefined);
});

test('BOSS 协议限制必须阻止应用内嵌登录、简历和投递操作', () => {
  const boss = registry.getAdapter('boss');
  assert.equal(boss.capabilities.login, 'unsupported');
  assert.equal(boss.capabilities.resume, 'unsupported');
  assert.equal(boss.capabilities.apply, 'unsupported');
  assert.equal(boss.fillResume, null);
  assert.equal(boss.prepareApplication, null);
});
