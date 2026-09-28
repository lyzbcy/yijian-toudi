const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { JsonStore, applyResumeEdit, addProfile, calculateResumeCompletion } = require('../electron/store.cjs');
const { createSeed } = require('../electron/seed.cjs');
const { mergeJobSnapshot, singleFlight } = require('../electron/job-refresh.cjs');

test('保存失败时内存和磁盘仍保留上次已保存的数据', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-disk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new JsonStore(dir); store.init();
  const before = store.get();
  const disk = fs.readFileSync(store.file, 'utf8');
  const mock = t.mock.method(fs, 'renameSync', () => { throw new Error('disk unavailable'); });
  assert.throws(() => store.update((s) => { s.resume.basic.name = '不应保存'; }), /disk unavailable/);
  const replacement = structuredClone(before);
  replacement.resume.basic.name = '不应恢复';
  assert.throws(() => store.replace(replacement), /disk unavailable/);
  mock.mock.restore();
  assert.deepEqual(store.get(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), disk);
});

test('简历完整度按本次编辑计算，快速创建的简历 ID 不重复', (t) => {
  const resume = createSeed().resume;
  const incoming = structuredClone(resume);
  incoming.education = [{ school: '测试大学' }];
  const saved = applyResumeEdit(resume, incoming);
  assert.equal(saved.completion, calculateResumeCompletion(saved));
  assert.ok(saved.completion > calculateResumeCompletion(resume));
  t.mock.method(Date, 'now', () => 1000);
  const ids = Array.from({ length: 100 }, () => addProfile(resume, '测试'));
  assert.equal(new Set(ids).size, 100);
});

test('刷新去重并保留缺席的收藏，异常输入不修改已有岗位', () => {
  const old = [{ id: 'a-1', favorite: true }, { id: 'a-2' }, { id: 'b-1' }];
  assert.deepEqual(mergeJobSnapshot(old, [{ id: 'a-3' }, { id: 'a-3' }], 'a-').map(j => j.id), ['a-1', 'b-1', 'a-3']);
  assert.throws(() => mergeJobSnapshot(old, [{ id: 'b-2' }], 'a-'));
  assert.equal(old.length, 3);
});

test('并发刷新只执行一次，失败后可重新执行', async () => {
  let calls = 0;
  const run = singleFlight(async () => { calls++; throw new Error('offline'); });
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => run()));
  assert.equal(calls, 1);
  assert.ok(results.every(r => r.status === 'rejected'));
  await assert.rejects(run(), /offline/);
  assert.equal(calls, 2);
});

function mockResponses(t, replies) {
  let count = 0;
  const bodies = [];
  t.mock.method(https, 'request', (_url, _options, callback) => {
    const req = new EventEmitter();
    req.setTimeout = () => req; req.write = (body) => bodies.push(body); req.destroy = (e) => req.emit('error', e);
    req.end = () => process.nextTick(() => {
      const reply = replies[count++];
      if (!reply) return req.emit('error', new Error('unexpected request'));
      const res = new EventEmitter();
      res.statusCode = reply.status || 200;
      res.headers = { 'set-cookie': ['token=test'] };
      res.setEncoding = () => {}; res.resume = () => {};
      callback(res);
      res.emit('data', JSON.stringify(reply.json)); res.emit('end');
    });
    return req;
  });
  return Object.assign(() => count, { bodies });
}

for (const [name, fn] of [['bytedance', 'listBytedanceJobs'], ['xiaomi', 'listXiaomiJobs']]) {
  test(`${name} 的 405 令牌刷新成功后继续读取岗位`, async (t) => {
    const count = mockResponses(t, [
      { json: { data: { token: 'one' } } }, { status: 405, json: {} },
      { json: { data: { token: 'two' } } },
      { json: { data: { job_post_list: [{ id: '123', title: '测试岗位' }], count: 1 } } }
    ]);
    const jobs = await require(`../electron/adapters/${name}.cjs`)[fn]();
    assert.equal(jobs.length, 1); assert.equal(count(), 4);
  });
}

for (const [name, fn] of [['tencent', 'listTencentJobs'], ['jd', 'listJdJobs'], ['meituan', 'listMeituanJobs'], ['baidu', 'listBaiduJobs']]) {
  test(`${name} 接口异常不能冒充成功空列表`, async (t) => {
    mockResponses(t, [{ status: 503, json: {} }]);
    await assert.rejects(require(`../electron/adapters/${name}.cjs`)[fn]({ keywords: [''] }));
  });
}

test('腾讯发布日期保持官网日期，不因东八区转 UTC 少一天', () => {
  const { normalizePost } = require('../electron/adapters/tencent.cjs');
  assert.equal(normalizePost({ PostId: '1', LastUpdateTime: '2026年09月09日' }).postedAt, '2026-09-09');
});

for (const [name, fn] of [['bytedance', 'listBytedanceJobs'], ['xiaomi', 'listXiaomiJobs']]) {
  test(`${name} 旧岗位页后仍继续查找新岗位`, async (t) => {
    mockResponses(t, [
      { json: { data: { token: 'one' } } },
      { json: { data: { job_post_list: [{ id: 'old', publish_time: 1000 }], count: 2 } } },
      { json: { data: { job_post_list: [{ id: 'new', publish_time: Date.now() }], count: 2 } } }
    ]);
    const jobs = await require(`../electron/adapters/${name}.cjs`)[fn]({ pageSize: 1 });
    assert.deepEqual(jobs.map(j => j.id), [`${name}-new`]);
  });
}

test('美团分页参数嵌套在 page 中，并在重复页时终止', async (t) => {
  const reply = { json: { data: { list: [{ jobUnionId: 'same', name: '岗位' }], page: { totalCount: 2 } } } };
  const calls = mockResponses(t, [reply, reply]);
  await assert.rejects(require('../electron/adapters/meituan.cjs').listMeituanJobs({ pageSize: 1 }), /重复页/);
  assert.deepEqual(calls.bodies.map(b => JSON.parse(b).page.pageNo), [1, 2]);
});

test('京东分页使用官网表单 pageIndex，优先展示公开岗位名', async (t) => {
  const calls = mockResponses(t, [{ json: [{ positionId: '1' }] }, { json: { count: 1 } }]);
  const adapter = require('../electron/adapters/jd.cjs');
  await adapter.listJdJobs();
  assert.equal(new URLSearchParams(calls.bodies[0]).get('pageIndex'), '1');
  assert.equal(adapter.normalizeJob({ positionId: '1', positionName: '内部名', positionNameOpen: '公开名' }).title, '公开名');
});

test('Agent 更新共享字段后 UI 视图和持久化内容一致，拒绝非法经历类型', () => {
  const { patchResume } = require('../electron/store.cjs');
  const original = createSeed().resume;
  original.basic.phone = '123';
  const updated = patchResume(original, { basic: { name: 'API姓名' }, 'skills.keywords': 'JavaScript' });
  assert.equal(updated.basic.name, 'API姓名');
  assert.equal(updated.basic.phone, '123');
  assert.equal(updated.skills.keywords, 'JavaScript');
  assert.equal(original.basic.name, '');
  assert.throws(() => patchResume(original, { education: '大学' }), /数组/);
});

test('API 端口占用后可重试启动，并发启动返回同一端口', async (t) => {
  const { AgentServer } = require('../electron/agent-server.cjs');
  const occupied = require('node:http').createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const server = new AgentServer({ store: {}, onCommand: async () => {} });
  t.after(() => server.stop());
  await assert.rejects(server.start(occupied.address().port), { code: 'EADDRINUSE' });
  const ports = await Promise.all([server.start(0), server.start(0)]);
  assert.ok(ports[0] > 0);
  assert.equal(ports[0], ports[1]);
});

test('响应中断立即失败，总时限到达时销毁仍未完成的请求', async () => {
  const { guardRequest, guardResponse } = require('../electron/http-lifecycle.cjs');
  const response = new EventEmitter();
  let responseError;
  guardResponse(response, error => { responseError = error; });
  response.emit('aborted');
  assert.match(responseError.message, /中途断开/);
  const request = new EventEmitter();
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(new Promise((resolve, reject) => {
      request.destroy = error => { request.emit('close'); reject(error); };
      guardRequest(request, 20);
    }), /总时限/);
  } finally { clearTimeout(keepAlive); }
});
