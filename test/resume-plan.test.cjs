const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTencentResumePlan,
  summarizeFillReport
} = require('../electron/resume-plan.cjs');

test('生成有稳定键且不包含空值的腾讯简历计划', () => {
  const plan = createTencentResumePlan({
    basic: { name: '张三', phone: '', email: 'z@example.com' },
    intention: { roles: '前端工程师' },
    education: [{ school: '示例大学', major: '计算机' }]
  });

  assert.deepEqual(plan.map((item) => item.key), [
    'basic.name',
    'basic.email',
    'intention.roles',
    'education.0.school',
    'education.0.major'
  ]);
  assert.equal(plan.some((item) => item.value === ''), false);
});

test('字段报告区分已填写和需手动处理', () => {
  const report = summarizeFillReport(
    [{ key: 'basic.name' }, { key: 'basic.email' }],
    [{ key: 'basic.name', matched: true }]
  );

  assert.deepEqual(report.filled, ['basic.name']);
  assert.deepEqual(report.manual, ['basic.email']);
});
