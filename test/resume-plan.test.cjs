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

test('多段经历展开为带段索引的计划条目，第一段 keywords 不带段序号', () => {
  const plan = createTencentResumePlan({
    education: [
      { school: 'A 大学', major: '计算机' },
      { school: 'B 大学', major: '金融' }
    ]
  });
  const eduKeys = plan.filter((item) => item.group === 'education');
  assert.deepEqual(eduKeys.map((item) => item.key), [
    'education.0.school',
    'education.0.major',
    'education.1.school',
    'education.1.major'
  ]);
  // 第一段 keywords 保持原文（适配官网第一行）
  assert.deepEqual(eduKeys[0].keywords, ['学校名称', '毕业院校', '学校', 'school']);
  // 第二段 keywords 带段序号（统一阿拉伯数字，便于 adapter 匹配）
  assert.ok(eduKeys[2].keywords.every((kw) => kw.includes('第2段')), `第二段 keywords 应带「第2段」，实际：${JSON.stringify(eduKeys[2].keywords)}`);
  assert.equal(eduKeys[2].segmentNumber, 2);
  assert.equal(eduKeys[2].segmentLabel, '教育经历 2');
});

test('空段经历（字段全空）不出现在计划里', () => {
  const plan = createTencentResumePlan({
    education: [{ school: 'A 大学' }, { school: '', major: '' }]
  });
  const eduKeys = plan.filter((item) => item.group === 'education');
  assert.deepEqual(eduKeys.map((item) => item.key), ['education.0.school']);
});

test('工作经历与项目经历的多段展开独立', () => {
  const plan = createTencentResumePlan({
    experience: [{ company: '公司 A', role: '工程师' }, { company: '公司 B', role: '主管' }],
    projects: [{ name: '项目 1' }]
  });
  const expKeys = plan.filter((item) => item.group === 'experience');
  const projKeys = plan.filter((item) => item.group === 'projects');
  assert.equal(expKeys.length, 4);
  assert.equal(projKeys.length, 1);
  assert.equal(expKeys[2].segmentNumber, 2);
});
