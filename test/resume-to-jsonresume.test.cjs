const test = require('node:test');
const assert = require('node:assert/strict');
const { createJsonResume, toHighlights, splitKeywords } = require('../electron/resume-to-jsonresume.cjs');

const sample = {
  basic: { name: '张三', email: 'z@t.com', phone: '13800000000', city: '苏州市', province: '江苏省', github: 'https://github.com/zs', website: 'https://zs.dev' },
  intention: { roles: '前端开发' },
  education: [{ school: '江南大学', major: '人工智能', degree: '本科', start: '2023-09', end: '2027-06', courses: '深度学习，操作系统' }],
  experience: [{ company: '某公司', role: '实习生', start: '2026-04', end: '', description: '负责官网开发。修复线上问题；沉淀方法。' }],
  projects: [{ name: '一键投递', description: '批量投递工具', contribution: '独立开发', techStack: 'Electron, 浏览器自动化', start: '2026-07', end: '2026-08', outcome: '开源' }],
  skills: { keywords: 'JavaScript, Python', proficiency: '熟练', languages: '英语 CET-6', certificates: '', interests: '摄影' },
  extras: { summary: '全栈开发', awards: '蓝桥杯二等奖；奖学金' }
};

test('转换为 JSON Resume 标准结构：basics 顶层无 sections（Reactive Resume 识别为 json-resume-json）', () => {
  const jr = createJsonResume(sample);
  assert.ok('basics' in jr);
  assert.ok(!('sections' in jr) && !('metadata' in jr));
  assert.equal(jr.basics.name, '张三');
  assert.equal(jr.basics.location.city, '苏州市');
  assert.equal(jr.basics.profiles[0].network, 'GitHub');
});

test('工作经历：至今用 startDate 无 endDate，描述切分为要点', () => {
  const jr = createJsonResume(sample);
  assert.equal(jr.work[0].company, '某公司');
  assert.equal(jr.work[0].startDate, '2026-04');
  assert.equal(jr.work[0].endDate, undefined);
  assert.ok(Array.isArray(jr.work[0].highlights) && jr.work[0].highlights.length >= 2);
});

test('教育与项目字段映射：日期补零、技术栈转 keywords', () => {
  const jr = createJsonResume(sample);
  assert.equal(jr.education[0].startDate, '2023-09');
  assert.deepEqual(jr.education[0].courses, ['深度学习', '操作系统']);
  assert.equal(jr.projects[0].name, '一键投递');
  assert.deepEqual(jr.projects[0].keywords, ['Electron', '浏览器自动化']);
  assert.equal(jr.projects[0].endDate, '2026-08');
});

test('技能分组与奖项拆分', () => {
  const jr = createJsonResume(sample);
  assert.equal(jr.skills[0].name, '技术栈');
  assert.deepEqual(jr.skills[0].keywords, ['JavaScript', 'Python']);
  assert.equal(jr.skills.filter((g) => g.name === '语言能力').length, 1);
  assert.equal(jr.awards.length, 2);
});

test('空字段安全：keywords 中英文逗号、顿号、分号都支持', () => {
  assert.deepEqual(splitKeywords('a, b，c、d；e'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(toHighlights('一句。两句；三句'), ['一句', '两句', '三句']);
});

test('空简历不会抛错', () => {
  const jr = createJsonResume({});
  assert.equal(jr.basics.name, '');
  assert.deepEqual(jr.work, []);
});

test('Reactive Resume v5 导入兼容：同时输出 name/url/score 双键', () => {
  const jr = createJsonResume(sample);
  assert.equal(jr.work[0].name, '某公司');
  assert.equal(jr.work[0].company, '某公司');
  assert.equal(jr.basics.url, 'https://zs.dev');
  assert.ok('score' in jr.education[0]);
  // ISO 日期格式符合 RR 导入器的 iso8601 正则（YYYY / YYYY-MM / YYYY-MM-DD）
  assert.match(jr.work[0].startDate, /^([1-2][0-9]{3}(-[0-1][0-9](-[0-3][0-9])?)?)$/);
});
