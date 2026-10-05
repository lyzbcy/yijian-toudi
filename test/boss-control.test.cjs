const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../electron/store.cjs');
const { BossBatchController } = require('../electron/boss-control.cjs');
const { BossBatchRunner } = require('../electron/boss-batch.cjs');
const { AgentServer } = require('../electron/agent-server.cjs');

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjtd-p0-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new JsonStore(dir); store.init();
  const calls = [];
  let currentUrl;
  let phase = 0;
  const bridge = {
    navigate: async (url) => { calls.push('navigate'); currentUrl = url; },
    snapshot: async () => {
      calls.push('snapshot');
      if (++phase === 1) return { data: { url: currentUrl, links: [{ role: 'link', name: '前端开发实习生', ref: '@e1', company: '样本公司' }] } };
      if (phase === 2) return { data: { tree: [{ name: '立即沟通', ref: '@e2' }] } };
      return { data: { tree: [{ name: '已向BOSS发送消息' }] } };
    },
    click: async (ref) => { calls.push(ref); return { data: { success: true } }; }
  };
  const make = (extra = {}) => new BossBatchController({ store, getBridge: async () => bridge,
    runnerFactory: (opts) => new BossBatchRunner({ ...opts, noThrottle: true, plan: [{ city: '武汉', query: '前端开发实习', page: 1 }] }),
    ...options, ...extra });
  return { store, dir, calls, bridge, make, control: make() };
}

test('控制面: 真实 JsonStore 先记待发送，回执与成功账本原子落盘；重启保留结果', async (t) => {
  const x = setup(t);
  const original = x.bridge.click;
  x.bridge.click = async (ref) => {
    if (ref === '@e2') assert.equal(x.store.get().bossBatchRun.pending.company, '样本公司');
    return original(ref);
  };
  const result = await x.control.start({ target: 1 });
  assert.equal(result.started, true);
  await x.control.done;
  assert.equal(x.control.status().applied.length, 1);
  assert.equal(x.store.get().accounts[0].boss.applied.length, 1);
  assert.equal(x.control.status().pending, null);
  const restartedStore = new JsonStore(x.dir); restartedStore.init();
  const restarted = new BossBatchController({ store: restartedStore, getBridge: async () => { throw new Error('不应访问'); } });
  assert.equal(restarted.status().applied.length, 1);
  assert.equal(restarted.status().running, false);
});

test('控制面: 并发启动在获取桥之前就锁住，停止中不放开锁', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const x = setup(t, { getBridge: () => gate });
  const first = x.control.start({ target: 1 });
  assert.deepEqual(await x.control.start({ target: 1 }), { error: 'already-running' });
  x.control.stop();
  assert.equal(x.control.status().stopping, true);
  assert.equal(x.control.status().running, true);
  assert.deepEqual(await x.control.start({ target: 1 }), { error: 'already-running' });
  release(x.bridge);
  assert.equal((await first).cancelled, true);
  assert.equal(x.control.status().running, false);
  assert.equal(x.calls.length, 0);
});

test('控制面: 发送点击断连留下待复核记录；重启拒绝重发；显式复核只跳过不冒充成功', async (t) => {
  const x = setup(t);
  const click = x.bridge.click;
  x.bridge.click = async (ref) => { if (ref === '@e2') throw new Error('disconnected'); return click(ref); };
  await x.control.start({ target: 1 }); await x.control.done;
  assert.equal(x.control.status().stopReason, 'send-unverified');
  assert.equal(x.control.status().applied.length, 0);
  assert.equal(x.control.status().requiresReview, true);
  const restarted = x.make();
  assert.equal((await restarted.start({ target: 1 })).error, 'review-required');
  const runId = restarted.status().runId;
  assert.equal(restarted.resolve({ runId, action: 'auto' }).error, 'explicit-review-required');
  assert.equal(restarted.resolve({ runId, action: 'acknowledge-and-skip-unknown' }).reviewed, true);
  const boss = x.store.get().accounts[0].boss;
  assert.deepEqual(boss.heldCompanies, ['样本公司']);
  assert.equal(boss.applied.length, 0);
  let banned;
  const check = x.make({ runnerFactory: (opts) => { banned = opts.banCompanies; return new BossBatchRunner({ ...opts, noThrottle: true, plan: [] }); } });
  await check.start({ target: 1 }); await check.done;
  assert.ok(banned.includes('样本公司'));
});

test('控制面: 崩溃残留 running 记录在重启后拦截新批次且保留 pending', async (t) => {
  const x = setup(t);
  x.store.update((s) => { s.bossBatchRun = { id: 'crashed', accountId: 'default', phase: 'running', pending: { company: '未知公司' }, applied: [] }; return s; });
  assert.equal(x.control.status().phase, 'interrupted');
  assert.equal((await x.control.start({ target: 1 })).error, 'review-required');
  assert.equal(x.calls.length, 0);
});

test('控制面: 403 终态可跨进程回读，拒绝自动续跑或换账号绕过', async (t) => {
  const x = setup(t);
  x.bridge.snapshot = async () => ({ data: { url: 'https://www.zhipin.com/web/passport/zp/403.html' } });
  await x.control.start({ target: 1 }); await x.control.done;
  assert.equal(x.control.status().stopReason, 'access-restricted');
  assert.equal((await x.make().start({ accountId: 'another', target: 1 })).error, 'review-required');
  assert.equal(x.calls.filter((s) => s === 'navigate').length, 1);
});

test('控制面: dryRun 没有 pending、发送或成功账本', async (t) => {
  const x = setup(t);
  await x.control.start({ target: 1, dryRun: true }); await x.control.done;
  assert.equal(x.control.status().previewed.length, 1);
  assert.equal(x.control.status().applied.length, 0);
  assert.equal(x.control.status().pending, null);
  assert.ok(!x.calls.includes('@e2'));
});

test('控制面: 发出停止后在途发送未结束时锁保持，结束后未知结果转复核', async (t) => {
  const x = setup(t);
  let releaseClick;
  let sawSend;
  const started = new Promise((resolve) => { sawSend = resolve; });
  const pendingClick = new Promise((resolve) => { releaseClick = resolve; });
  const click = x.bridge.click;
  x.bridge.click = async (ref) => {
    if (ref !== '@e2') return click(ref);
    sawSend();
    return pendingClick;
  };
  await x.control.start({ target: 1 });
  await started;
  x.control.stop();
  assert.equal(x.control.status().running, true);
  assert.equal((await x.control.start({ target: 1 })).error, 'already-running');
  releaseClick({ data: { success: true } });
  await x.control.done;
  assert.equal(x.control.status().running, false);
  assert.equal(x.control.status().requiresReview, true);
  assert.equal(x.control.status().applied.length, 0);
});

test('控制面: 非法目标和字符串 dryRun 不触碰桥', async (t) => {
  const x = setup(t);
  for (const target of [0, -1, 1.5, '10', NaN, Infinity, null]) assert.equal((await x.control.start({ target })).error, 'invalid-target');
  assert.equal((await x.control.start({ target: 1, dryRun: 'false' })).error, 'invalid-dry-run');
  assert.equal((await x.control.start({ target: 121 })).error, 'target-exceeds-limit');
  assert.equal(x.calls.length, 0);
});

test('控制面: 待发送写盘失败时零发送，失败状态可回读', async (t) => {
  const x = setup(t);
  const update = x.store.update.bind(x.store);
  x.store.update = (mutate) => update((s) => {
    const next = mutate(s);
    if (next.bossBatchRun?.pending) throw new Error('disk-full');
    return next;
  });
  await x.control.start({ target: 1 }); await x.control.done;
  assert.equal(x.control.status().stopReason, 'persist-failed');
  assert.ok(!x.calls.includes('@e2'));
});

test('控制面: 企微故障不阻止停止状态和回执落盘', async (t) => {
  const x = setup(t, { notify: async () => { throw new Error('notify-down'); } });
  await x.control.start({ target: 1 }); await x.control.done;
  assert.equal(x.control.status().applied.length, 1);
  assert.equal(x.control.status().running, false);
});

test('控制面: 客户限额与账号隔离保持', async (t) => {
  const x = setup(t);
  x.store.update((s) => { s.accounts.push({ id: 'client', boss: { applied: [], banCompanies: [] } }); return s; });
  assert.equal((await x.control.start({ accountId: 'client', target: 51 })).error, 'target-exceeds-limit');
  await x.control.start({ accountId: 'client', target: 1 }); await x.control.done;
  assert.equal(x.store.get().accounts.find((a) => a.id === 'client').boss.applied.length, 1);
  assert.equal(x.store.get().accounts.find((a) => a.id === 'default').boss.applied.length, 0);
});

test('控制面: 回执后账本写盘失败保留 pending，重启仍拦截重发', async (t) => {
  const x = setup(t);
  const update = x.store.update.bind(x.store);
  x.store.update = (mutate) => update((s) => {
    const next = mutate(s);
    if (next.bossBatchRun?.applied?.length) throw new Error('disk-full');
    return next;
  });
  await x.control.start({ target: 1 }); await x.control.done;
  assert.equal(x.control.status().pending.company, '样本公司');
  assert.equal(x.control.status().applied.length, 0);
  assert.equal((await x.make().start({ target: 1 })).error, 'review-required');
});

test('控制面: 本机真实 HTTP 复核接口鉴权、拒绝过期 runId 并不启动任务', async (t) => {
  const x = setup(t);
  x.store.update((s) => { s.settings.apiToken = 'fixture-token'; s.bossBatchRun = { id: 'blocked', accountId: 'default', phase: 'stopped', requiresReview: true, applied: [] }; return s; });
  const server = new AgentServer({ store: x.store, onCommand: async () => ({}), bossControl: { resolve: (r) => x.control.resolve(r) } });
  const port = await server.start(0); t.after(() => server.stop());
  const url = `http://127.0.0.1:${port}/v1/boss/batch/resolve`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  const post = async (body) => (await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  assert.equal((await post({ runId: 'old', action: 'acknowledge-and-skip-unknown' })).error, 'stale-review');
  assert.equal((await post({ runId: 'blocked', action: 'acknowledge-and-skip-unknown' })).reviewed, true);
  assert.equal(x.control.status().running, false);
  assert.equal(x.calls.length, 0);
});
