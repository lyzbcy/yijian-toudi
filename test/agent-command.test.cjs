const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../electron/store.cjs');
const { AgentServer } = require('../electron/agent-server.cjs');
const {
  commandFingerprint,
  createAuditEntry
} = require('../electron/agent-command.cjs');

async function createTestServer(onCommand = async () => ({ ok: true })) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-idempotency-'));
  const store = new JsonStore(directory);
  const state = store.init();
  const instance = new AgentServer({ store, onCommand });
  const port = await instance.start(0);
  return {
    instance,
    store,
    port,
    token: state.settings.apiToken
  };
}

function postCommand({ port, token, key, body }) {
  return fetch(`http://127.0.0.1:${port}/v1/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {})
    },
    body: JSON.stringify(body)
  });
}

test('命令指纹稳定且脱敏审计只保留允许字段', () => {
  assert.equal(
    commandFingerprint({ action: 'refresh_jobs' }),
    commandFingerprint({ action: 'refresh_jobs' })
  );
  const entry = createAuditEntry({
    action: 'refresh_jobs',
    source: 'agent-api',
    target: 'all',
    status: 'done',
    message: '完成',
    apiToken: 'secret',
    authorizationCode: 'secret',
    cookie: 'secret'
  });
  const serialized = JSON.stringify(entry);
  assert.equal(serialized.includes('secret'), false);
  assert.deepEqual(Object.keys(entry).sort(), [
    'action',
    'createdAt',
    'id',
    'message',
    'source',
    'status',
    'target'
  ]);
});

test('写命令缺少 Idempotency-Key 返回 428', async () => {
  const server = await createTestServer();
  try {
    const response = await postCommand({
      ...server,
      body: { action: 'refresh_jobs' }
    });
    assert.equal(response.status, 428);
  } finally {
    await server.instance.stop();
  }
});

test('相同键和相同命令只执行一次并返回第一次结果', async () => {
  let calls = 0;
  const server = await createTestServer(async () => ({ call: ++calls }));
  try {
    const first = await postCommand({
      ...server,
      key: 'refresh-20260725-1',
      body: { action: 'refresh_jobs' }
    });
    const firstBody = await first.json();
    const second = await postCommand({
      ...server,
      key: 'refresh-20260725-1',
      body: { action: 'refresh_jobs' }
    });

    assert.equal(calls, 1);
    assert.deepEqual(await second.json(), firstBody);
    assert.equal(server.store.get().audit.length, 2);
  } finally {
    await server.instance.stop();
  }
});

test('相同键对应不同命令返回 409', async () => {
  const server = await createTestServer();
  try {
    await postCommand({
      ...server,
      key: 'shared-key',
      body: { action: 'refresh_jobs' }
    });
    const conflict = await postCommand({
      ...server,
      key: 'shared-key',
      body: { action: 'apply_cart' }
    });
    assert.equal(conflict.status, 409);
  } finally {
    await server.instance.stop();
  }
});

test('Agent 数据写入：update_resume 改简历字段并持久化', async () => {
  const { patchResume } = require('../electron/store.cjs');
  const server = await createTestServer(async (cmd) => {
    // 模拟 handleCommand 的 update_resume 分支
    if (cmd.action === 'update_resume') {
      server.store.update((state) => {
        state.resume = patchResume(state.resume, cmd.patch, { merge: cmd.merge !== false });
        return state;
      });
      const s = server.store.get();
      return { ok: true, completion: s.resume.completion };
    }
    return { ok: true };
  });
  try {
    const res = await postCommand({
      port: server.port, token: server.token, key: 'update-resume-1',
      body: { action: 'update_resume', patch: { basic: { name: '测试用户' } }, merge: true }
    });
    assert.equal(res.status, 202);
    const data = await res.json();
    assert.equal(data.result.ok, true);
    // 持久化校验：重新读 store
    const s = server.store.get();
    assert.equal(s.resume.profiles[0].basic.name, '测试用户');
  } finally {
    await server.instance.stop();
  }
});

test('Agent 数据写入：search_jobs 按关键词筛选', async () => {
  const { findJobs } = require('../electron/store.cjs');
  const server = await createTestServer(async (cmd) => {
    if (cmd.action === 'search_jobs') {
      const s = server.store.get();
      const matched = findJobs([{ id: '1', title: '前端', city: '苏州' }, { id: '2', title: '后端', city: '北京' }], cmd.filter || {});
      return { count: matched.length, jobs: matched };
    }
    return { ok: true };
  });
  try {
    const res = await postCommand({
      port: server.port, token: server.token, key: 'search-1',
      body: { action: 'search_jobs', filter: { keyword: '前端' } }
    });
    const data = await res.json();
    assert.equal(data.result.count, 1);
    assert.equal(data.result.jobs[0].title, '前端');
  } finally {
    await server.instance.stop();
  }
});
