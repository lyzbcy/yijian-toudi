const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateJobMatch, applyJobMatches, splitKeywords } = require('../electron/match.cjs');

test('splitKeywords 按多种分隔符拆词，过滤短词', () => {
  assert.deepEqual(splitKeywords('React, Python、产品规划 后端/Go'), ['React', 'Python', '产品规划', '后端', 'Go']);
  assert.deepEqual(splitKeywords(''), []);
  assert.deepEqual(splitKeywords(null), []);
  assert.deepEqual(splitKeywords('a b'), []); // 长度 <2 过滤
});

test('calculateJobMatch 完全无简历关键词返回 0', () => {
  const job = { title: '前端工程师', tags: ['React'], summary: '负责前端开发' };
  assert.equal(calculateJobMatch(job, { intention: {}, skills: {} }), 0);
});

test('calculateJobMatch 角色命中权重高于技能', () => {
  const resume = { intention: { roles: '前端' }, skills: { keywords: 'Java' } };
  const jobFrontend = { title: '前端工程师', tags: [], summary: '' };
  const jobBackend = { title: 'Java 后端', tags: [], summary: '' };
  const frontScore = calculateJobMatch(jobFrontend, resume);
  const backScore = calculateJobMatch(jobBackend, resume);
  // 前端命中了 role(权重3)，后端命中了 skill(权重2)，前端分应更高
  assert.ok(frontScore > backScore, `前端匹配 ${frontScore} 应高于后端 ${backScore}`);
});

test('calculateJobMatch 全命中返回 100', () => {
  const resume = { intention: { roles: '前端' }, skills: { keywords: 'React' } };
  const job = { title: '前端 React 工程师', tags: ['React'], summary: '用 React 做前端' };
  assert.equal(calculateJobMatch(job, resume), 100);
});

test('calculateJobMatch 大小写不敏感', () => {
  const resume = { intention: { roles: '' }, skills: { keywords: 'react' } };
  const job = { title: 'REACT ENGINEER', tags: [], summary: '' };
  assert.ok(calculateJobMatch(job, resume) > 0);
});

test('applyJobMatches 原地修改 job.match', () => {
  const resume = { intention: { roles: '前端' }, skills: {} };
  const jobs = [
    { id: '1', title: '前端 A', tags: [], summary: '' },
    { id: '2', title: '后端 B', tags: [], summary: '' }
  ];
  applyJobMatches(jobs, resume);
  assert.ok(jobs[0].match > 0);
  assert.equal(jobs[1].match, 0);
});
