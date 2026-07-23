const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore, calculateResumeCompletion } = require('../electron/store.cjs');
const { classifyRecruitingMail, looksLikeRecruitingMail } = require('../electron/recruiting.cjs');
const { AgentServer } = require('../electron/agent-server.cjs');

test('JsonStore 首次启动生成本地状态并能持久化收藏', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-store-'));
  const store = new JsonStore(directory);
  const seed = store.init();
  assert.ok(seed.jobs.length >= 6);
  assert.ok(seed.settings.apiToken.length >= 20);
  const id = seed.jobs[0].id;
  store.update((state) => {
    state.jobs.find((job) => job.id === id).favorite = false;
    return state;
  });
  const reloaded = new JsonStore(directory);
  assert.equal(reloaded.init().jobs.find((job) => job.id === id).favorite, false);
});

test('简历完整度只按已填写关键字段计算', () => {
  const resume = {
    basic: { name: '张三', phone: '13800000000', email: '', city: '' },
    intention: { roles: '', cities: '' },
    education: [{}], experience: [{}], projects: [{}],
    skills: { keywords: '' }, extras: { summary: '' }
  };
  assert.equal(calculateResumeCompletion(resume), 13);
});

test('招聘邮件分类识别面试、Offer 与普通邮件', () => {
  assert.equal(classifyRecruitingMail('面试邀请', '请选择面试时间'), '面试');
  assert.equal(classifyRecruitingMail('Offer 通知', '录用意向书'), 'Offer');
  assert.equal(looksLikeRecruitingMail('周末促销', '商城', '全场五折'), false);
  assert.equal(looksLikeRecruitingMail('在线测评提醒', '腾讯招聘', '请完成'), true);
});

test('Agent API 要求 Token 并返回岗位', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-api-'));
  const store = new JsonStore(directory);
  const state = store.init();
  const server = new AgentServer({ store, onCommand: async () => ({ ok: true }) });
  const port = await server.start(0);
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/v1/jobs`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`http://127.0.0.1:${port}/v1/jobs`, {
      headers: { Authorization: `Bearer ${state.settings.apiToken}` }
    });
    assert.equal(allowed.status, 200);
    const data = await allowed.json();
    assert.ok(data.jobs.length >= 6);
  } finally {
    await server.stop();
  }
});
