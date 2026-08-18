const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTencentResumePlan,
  createUniversalResumePlan,
  summarizeFillReport
} = require('../electron/resume-plan.cjs');

test('跨平台通用计划保留全部结构化字段，不套用腾讯社招裁剪规则', () => {
  const plan = createUniversalResumePlan({
    basic: { name: '张三' },
    education: [{ school: '某大学', rank: '前10%' }],
    projects: [{ name: '项目A', description: '项目说明' }]
  });
  assert.ok(plan.some((item) => item.key === 'education.0.rank'));
  assert.ok(plan.some((item) => item.key === 'projects.0.name'));
});

test('生成有稳定键且不包含空值的腾讯简历计划', () => {
  const plan = createTencentResumePlan({
    basic: { name: '张三', phone: '', email: 'z@example.com' },
    intention: { roles: '前端工程师' },
    education: [{ school: '示例大学', major: '计算机' }]
  }, { recruitType: 'campus' });

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
  }, { recruitType: 'campus' });
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
  }, { recruitType: 'campus' });
  const eduKeys = plan.filter((item) => item.group === 'education');
  assert.deepEqual(eduKeys.map((item) => item.key), ['education.0.school']);
});

test('工作经历与项目经历的多段展开独立', () => {
  const plan = createTencentResumePlan({
    experience: [{ company: '公司 A', role: '工程师' }, { company: '公司 B', role: '主管' }],
    projects: [{ name: '项目 1' }]
  }, { recruitType: 'campus' });
  const expKeys = plan.filter((item) => item.group === 'experience');
  const projKeys = plan.filter((item) => item.group === 'projects');
  assert.equal(expKeys.length, 4);
  assert.equal(projKeys.length, 1);
  assert.equal(expKeys[2].segmentNumber, 2);
});

// 2026-07-26 六厂考古新增字段：校招核心字段（GPA/QQ/工作年限/开发语言等）必须能进入 plan。
// 守护 doc/specs/简历字段缺口-2026-07-26.md 第一、二梯队的字段映射完整性。
test('六厂考古新增字段进入填写计划', () => {
  const plan = createTencentResumePlan({
    basic: { qq: '123456', idType: '身份证', idNumber: '320xxx', avatarUrl: 'https://x/p.png', emergencyContact: '张三 152xxxx' },
    intention: { workYears: '3年', interviewCity: '深圳', businessGroup: '微信', salaryUnit: '月薪', acceptAdjustment: true, acceptCityDeployment: false, willingness: { travel: true, relocate: false, overtime: true, nightShift: false } },
    skills: { devLanguages: 'Python,Go', englishLevel: 'CET-6', englishScore: '492' },
    extras: { certifier: '李老师 137xxxx' },
    compliance: { previouslyInterviewed: true, previouslyEmployed: false, hasRelativeAtCompany: true, relativeDetail: '张三 兄弟 微信部门', criminalRecord: false },
    education: [{ gpa: '3.8', gpaBase: '4.0', department: '计算机学院', laboratory: 'AI Lab', is211: '是' }],
    experience: [{ isOutsource: 'false', reportTo: '总监', teamSize: '8' }]
  }, { recruitType: 'campus' });
  const keys = plan.map((item) => item.key);
  // 校招核心（腾讯/京东实锤要）
  ['basic.qq', 'basic.idType', 'basic.idNumber', 'basic.avatarUrl', 'basic.emergencyContact',
   'intention.workYears', 'intention.interviewCity', 'intention.businessGroup', 'intention.salaryUnit',
   'intention.acceptAdjustment', 'intention.acceptCityDeployment',
   'intention.willingness.travel', 'intention.willingness.relocate', 'intention.willingness.overtime', 'intention.willingness.nightShift',
   'skills.devLanguages', 'skills.englishLevel', 'skills.englishScore', 'extras.certifier',
   'compliance.previouslyInterviewed', 'compliance.previouslyEmployed', 'compliance.hasRelativeAtCompany', 'compliance.relativeDetail', 'compliance.criminalRecord',
   'education.0.gpa', 'education.0.gpaBase', 'education.0.department', 'education.0.laboratory', 'education.0.is211',
   'experience.0.isOutsource', 'experience.0.reportTo', 'experience.0.teamSize'
  ].forEach((key) => {
    assert.ok(keys.includes(key), `新增字段 ${key} 应进入 plan，实际 plan keys: ${JSON.stringify(keys)}`);
  });
});

// 三态字段必须区分“未回答”和明确的“否”；UI select 会保存字符串 true/false。
test('三态字段类型契约：true/false 字符串转 是/否，空值不进', () => {
  // isFullTime='true'（字符串，UI select 形态）原样进 plan（campus 全量才含此字段）
  const p1 = createTencentResumePlan({ education: [{ school: 'A', isFullTime: 'true' }] }, { recruitType: 'campus' });
  assert.ok(p1.some((i) => i.key === 'education.0.isFullTime' && i.value === '是'));
  // isFullTime='' 空不进 plan
  const p2 = createTencentResumePlan({ education: [{ school: 'A', isFullTime: '' }] }, { recruitType: 'campus' });
  assert.ok(!p2.some((i) => i.key === 'education.0.isFullTime'));
  // 布尔 true（compliance/willingness/acceptAdjustment 的 checkbox 形态）→ '是' 进 plan
  const p3 = createTencentResumePlan({ intention: { acceptAdjustment: true } }, { recruitType: 'campus' });
  assert.ok(p3.some((i) => i.key === 'intention.acceptAdjustment' && i.value === '是'));
  // 布尔 false → '否' 进 plan（否定值有意义）
  const p4 = createTencentResumePlan({ intention: { acceptCityDeployment: 'false' } }, { recruitType: 'campus' });
  assert.ok(p4.some((i) => i.key === 'intention.acceptCityDeployment' && i.value === '否'));
  // 嵌套路径 willingness.travel=true → '是'
  const p5 = createTencentResumePlan({ intention: { willingness: { travel: true } } }, { recruitType: 'campus' });
  assert.ok(p5.some((i) => i.key === 'intention.willingness.travel' && i.value === '是'));
});

// 守护 idCard/idNumber 不冲突（复查 #3）：同号填写时 idCard 的 keywords 不应含「证件号码」
test('idCard 与 idNumber 映射不冲突（证件号码专属 idNumber）', () => {
  const plan = createTencentResumePlan({ basic: { idCard: '320xxx', idNumber: '320xxx' } }, { recruitType: 'campus' });
  const idCardRule = plan.find((i) => i.key === 'basic.idCard');
  const idNumberRule = plan.find((i) => i.key === 'basic.idNumber');
  assert.ok(idCardRule, 'idCard 应进 plan');
  assert.ok(idNumberRule, 'idNumber 应进 plan');
  assert.ok(!idCardRule.keywords.includes('证件号码'), 'idCard keywords 不应含「证件号码」（避免与 idNumber 冲突）');
  assert.ok(idNumberRule.keywords.includes('证件号码'), 'idNumber keywords 应含「证件号码」');
});

// 社招过滤：腾讯社招页无项目经历区/籍贯/民族/政治面貌，这些字段不应进社招 plan（避免 manual 噪音）。
// 守护 doc/specs 的社招白名单。校招保留全量。
test('社招 plan 过滤掉 projects/nativePlace/ethnicity，校招保留', () => {
  const resume = {
    basic: { name: '张三', nativePlace: '江苏', ethnicity: '汉', politicalStatus: '党员' },
    education: [{ school: 'A 大学', advisor: '李老师' }],
    experience: [{ company: '公司', level: 'P6' }],
    projects: [{ name: '项目1' }]
  };
  const socialPlan = createTencentResumePlan(resume, { recruitType: 'social' });
  const campusPlan = createTencentResumePlan(resume, { recruitType: 'campus' });
  const socialKeys = socialPlan.map((i) => i.key);
  const campusKeys = campusPlan.map((i) => i.key);
  // 社招过滤：projects 全砍、nativePlace/ethnicity/politicalStatus 砍、education 的 advisor（社招只要 school/major/degree/start/end）砍、experience 的 level 砍
  assert.ok(!socialKeys.some((k) => k.startsWith('projects.')), '社招不应含 projects');
  assert.ok(!socialKeys.includes('basic.nativePlace'), '社招不应含 nativePlace');
  assert.ok(!socialKeys.includes('basic.ethnicity'), '社招不应含 ethnicity');
  assert.ok(!socialKeys.includes('basic.politicalStatus'), '社招不应含 politicalStatus');
  assert.ok(!socialKeys.includes('education.0.advisor'), '社招教育不应含 advisor');
  assert.ok(!socialKeys.includes('experience.0.level'), '社招工作不应含 level');
  // 校招全保留
  assert.ok(campusKeys.some((k) => k.startsWith('projects.')), '校招应含 projects');
  assert.ok(campusKeys.includes('basic.nativePlace'), '校招应含 nativePlace');
  assert.ok(campusKeys.includes('education.0.advisor'), '校招教育应含 advisor');
});
