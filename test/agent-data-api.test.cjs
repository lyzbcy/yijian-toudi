const test = require('node:test');
const assert = require('node:assert/strict');
const { patchResume, batchAddToCart, findJobs } = require('../electron/store.cjs');

test('patchResume 深合并 intention 字段', () => {
  const resume = {
    activeProfileId: 'default',
    intention: { roles: '前端', cities: '苏州' },
    profiles: [{ id: 'default', label: '默认', intention: { roles: '前端', cities: '苏州' }, education: [], experience: [], projects: [] }]
  };
  const result = patchResume(resume, { intention: { salary: '20k' } }, { merge: true });
  // 深合并：原有 roles/cities 保留，新加 salary
  assert.equal(result.profiles[0].intention.roles, '前端');
  assert.equal(result.profiles[0].intention.cities, '苏州');
  assert.equal(result.profiles[0].intention.salary, '20k');
  // 顶层兼容视图同步
  assert.equal(result.intention.salary, '20k');
});

test('patchResume 整体替换 education（merge=false）', () => {
  const resume = {
    activeProfileId: 'default',
    education: [{ school: '旧大学' }],
    profiles: [{ id: 'default', label: '默认', intention: {}, education: [{ school: '旧大学' }], experience: [], projects: [] }]
  };
  const result = patchResume(resume, { education: [{ school: '新大学', major: 'AI' }] }, { merge: false });
  assert.equal(result.profiles[0].education.length, 1);
  assert.equal(result.profiles[0].education[0].school, '新大学');
  assert.equal(result.profiles[0].education[0].major, 'AI');
});

test('patchResume 更新 basic（全局字段）', () => {
  const resume = {
    activeProfileId: 'default',
    basic: { name: '旧名', phone: '123' },
    profiles: [{ id: 'default', label: '默认', intention: {}, education: [], experience: [], projects: [], basic: { name: '旧名', phone: '123' } }]
  };
  const result = patchResume(resume, { basic: { name: '新名' } }, { merge: true });
  assert.equal(result.profiles[0].basic.name, '新名');
  assert.equal(result.profiles[0].basic.phone, '123'); // 合并保留
});

test('batchAddToCart 批量加岗位，跳过已存在和不存在', () => {
  const state = {
    jobs: [
      { id: 'j1', title: '前端 A' },
      { id: 'j2', title: '后端 B' },
      { id: 'j3', title: '算法 C' }
    ],
    cart: [{ id: 'j1', title: '前端 A' }] // j1 已在
  };
  const result = batchAddToCart(state, ['j1', 'j2', 'jX']);
  assert.equal(result.added, 1); // 只加了 j2，j1 已存在，jX 不存在
  assert.equal(result.total, 2);
  assert.equal(state.cart[1].id, 'j2');
});

test('findJobs 按关键词/城市/公司/标签筛选', () => {
  const jobs = [
    { id: '1', title: '前端工程师', city: '苏州', companyId: 'tencent', tags: ['AI公司'] },
    { id: '2', title: '后端工程师', city: '北京', companyId: 'baidu', tags: ['500强'] },
    { id: '3', title: '前端开发', city: '苏州', companyId: 'tencent', tags: ['AI公司'] }
  ];
  assert.equal(findJobs(jobs, { keyword: '前端' }).length, 2);
  assert.equal(findJobs(jobs, { city: '苏州' }).length, 2);
  assert.equal(findJobs(jobs, { companyId: 'tencent' }).length, 2);
  assert.equal(findJobs(jobs, { tag: '500强' }).length, 1);
  assert.equal(findJobs(jobs, { keyword: '前端', city: '苏州' }).length, 2);
  assert.equal(findJobs(jobs, { limit: 1 }).length, 1);
});

test('findJobs 空 jobs 返回空数组', () => {
  assert.deepEqual(findJobs(null, { keyword: 'x' }), []);
  assert.deepEqual(findJobs([], {}), []);
});
