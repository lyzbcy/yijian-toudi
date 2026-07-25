const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../electron/adapters/registry.cjs');
const { fillTencentResume } = require('../electron/adapters/tencent-fill.cjs');
const { applyTencentJob } = require('../electron/adapters/tencent-apply.cjs');

test('registry 注册了 6 家公司且都能抓岗位', () => {
  const ids = registry.REGISTRY.map((a) => a.id);
  assert.deepEqual(ids.sort(), ['baidu', 'bytedance', 'jd', 'meituan', 'tencent', 'xiaomi']);
  assert.equal(registry.listJobAdapters().length, 6); // 全部 jobs !== unsupported
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
  assert.equal(tencent.capabilities.resume, 'verified');
  assert.equal(tencent.capabilities.apply, 'verified');
});

test('非腾讯公司的 fillResume 为 null，prepareApplication 为 manual 骨架（T2 阶段）', () => {
  for (const id of ['baidu', 'bytedance', 'xiaomi', 'jd', 'meituan']) {
    const adapter = registry.getAdapter(id);
    assert.equal(adapter.fillResume, null, `${id}.fillResume 应为 null`);
    assert.equal(typeof adapter.prepareApplication, 'function', `${id}.prepareApplication 应为 manual 骨架函数`);
    assert.equal(adapter.capabilities.resume, 'unsupported');
    assert.equal(adapter.capabilities.apply, 'manual'); // 升级：能打开官网手动投
    assert.equal(adapter.capabilities.status, 'unsupported');
  }
});

test('capabilityMatrix 返回扁平五维结构，供前端/介绍页消费', () => {
  const matrix = registry.capabilityMatrix();
  assert.equal(matrix.length, 6);
  const tencent = matrix.find((m) => m.id === 'tencent');
  assert.equal(tencent.jobs, 'verified');
  assert.equal(tencent.resume, 'verified');
  assert.ok(tencent.name);
});

test('getAdapter 不存在的公司返回 undefined', () => {
  assert.equal(registry.getAdapter('nope'), undefined);
});
