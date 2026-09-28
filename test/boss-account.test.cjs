// 代投多账号核心链路测试（2026-09-22 v0.5.0）
// 覆盖：schema v5 迁移 / boss-batch onApplied 落盘回调 / Agent API /v1/boss/* 路由 / 账号浏览器定位
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { JsonStore } = require('../electron/store.cjs');
const { createSeed } = require('../electron/seed.cjs');
const { BossBatchRunner } = require('../electron/boss-batch.cjs');
const { AgentServer } = require('../electron/agent-server.cjs');
const { findEdgeBinary, findKimiExtensionDir } = require('../electron/account-browser.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yjtd-acc-'));
}

test('schema v4 -> v5 迁移：补默认账号与 activeAccountId', () => {
  const dir = tempDir();
  const seed = createSeed();
  const v4 = JSON.parse(JSON.stringify(seed));
  v4.meta.schemaVersion = 4;
  delete v4.accounts;
  delete v4.activeAccountId;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(v4));

  const store = new JsonStore(dir);
  store.init();
  const s = store.get();
  assert.equal(s.meta.schemaVersion, 5);
  assert.equal(s.accounts.length, 1);
  assert.equal(s.accounts[0].id, 'default');
  assert.equal(s.accounts[0].boss.applied.length, 0);
  assert.equal(s.activeAccountId, 'default');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('新 seed 直接是 v5 且带默认账号', () => {
  const seed = createSeed();
  assert.equal(seed.meta.schemaVersion, 5);
  assert.equal(seed.accounts[0].id, 'default');
  assert.equal(seed.activeAccountId, 'default');
});

test('boss-batch: onApplied 回调在每笔投出时触发（引擎契约）', async () => {
  const recorded = [];
  let navigateCount = 0;
  // 假桥：第一次 navigate 返回 SEO 页（login-required 立即停）——不触发 onApplied；
  // 然后用 dryRun 路径验证回调只在 applied.push 处调用。
  const fakeBridge = {
    navigate: async () => { navigateCount += 1; return {}; },
    snapshot: async () => ({ data: { url: 'https://www.zhipin.com/x', links: [] } }),
    click: async () => ({ data: { success: true } })
  };
  const runner = new BossBatchRunner({
    bridge: fakeBridge,
    target: 1,
    dryRun: true,
    plan: [{ city: '武汉', query: '前端实习', page: 1 }],
    onApplied: (entry) => recorded.push(entry)
  });
  const result = await runner.run();
  // 空列表无命中：不投出，回调不触发，引擎正常结束
  assert.equal(result.applied.length, 0);
  assert.equal(recorded.length, 0);
  assert.equal(navigateCount, 1);

  // 三段式快照：1) 列表页(命中链接) 2) 详情页(立即沟通按钮) 3) 发送后(已向BOSS发送消息)
  const snapList = { data: { url: 'https://www.zhipin.com/web/geek/job', links: [{ role: 'link', name: '前端开发实习生-某公司', ref: '@e1' }] } };
  const snapDetail = { data: { url: 'https://www.zhipin.com/job_detail/x', links: [{ role: 'link', name: '立即沟通', ref: '@e2' }] } };
  const snapSent = { data: { url: 'https://www.zhipin.com/job_detail/x', raw: '已向BOSS发送消息' } };
  const snaps = [snapList, snapDetail, snapSent];
  let phase = 0;
  const fakeBridge2 = {
    navigate: async () => ({}),
    snapshot: async () => { phase += 1; return snaps[Math.min(phase - 1, snaps.length - 1)]; },
    click: async () => ({ data: { success: true } })
  };
  const recorded2 = [];
  const runner2 = new BossBatchRunner({
    bridge: fakeBridge2,
    target: 1,
    dryRun: false,
    noThrottle: true,
    plan: [{ city: '武汉', query: '前端实习', page: 1 }],
    onApplied: (entry) => recorded2.push(entry)
  });
  const result2 = await runner2.run();
  assert.equal(result2.applied.length, 1, '快照含命中链接时应投出 1 笔');
  assert.equal(recorded2.length, 1, 'onApplied 应恰好触发一次');
  assert.equal(recorded2[0].title, '前端开发实习生-某公司');
  assert.equal(recorded2[0].city, '武汉');
});

test('Agent API /v1/boss/* 路由与鉴权', async () => {
  const dir = tempDir();
  const store = new JsonStore(dir);
  store.init();
  store.update((s) => { s.settings.apiToken = 'test-token'; return s; });
  const calls = [];
  const server = new AgentServer({
    store,
    onCommand: async () => ({}),
    bossControl: {
      start: async (req) => { calls.push(['start', req]); return { started: true, target: req.target }; },
      stop: async () => { calls.push(['stop']); return { stopping: true }; },
      status: async () => { calls.push(['status']); return { running: false, applied: [] }; },
      accounts: async () => { calls.push(['accounts']); return { activeAccountId: 'default', accounts: [] }; },
      createAccount: async (req) => { calls.push(['create', req]); return { created: true }; }
    }
  });
  const port = await server.start(0);
  const base = `http://127.0.0.1:${port}`;
  const H = { 'Authorization': 'Bearer test-token', 'Content-Type': 'application/json' };

  const bad = await fetch(`${base}/v1/boss/batch/status`);
  assert.equal(bad.status, 401, '无 token 应 401');

  const st = await (await fetch(`${base}/v1/boss/batch/status`, { headers: H })).json();
  assert.deepEqual(Object.keys(st).sort(), ['applied', 'running'].sort());

  const start = await (await fetch(`${base}/v1/boss/batch/start`, { method: 'POST', headers: H, body: JSON.stringify({ target: 50, accountId: 'acc-x' }) })).json();
  assert.equal(start.started, true);

  const acc = await (await fetch(`${base}/v1/boss/accounts`, { headers: H })).json();
  assert.equal(acc.activeAccountId, 'default');

  const created = await (await fetch(`${base}/v1/boss/accounts/create`, { method: 'POST', headers: H, body: JSON.stringify({ name: '测试客户' }) })).json();
  assert.equal(created.created, true);

  const nf = await fetch(`${base}/v1/boss/nonsense`, { headers: H });
  assert.equal(nf.status, 404);

  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('account-browser: Edge 定位与扩展目录探测（不 spawn）', () => {
  // 本机装了 Edge（实测环境）；CI/异机可能没有，两种结果都合法
  const edge = findEdgeBinary();
  assert.ok(edge === null || fs.existsSync(edge), 'findEdgeBinary 要么 null 要么真实存在');

  const tmp = tempDir();
  assert.equal(findKimiExtensionDir(tmp), null, '无 extensions/kimi 时应返回 null');
  fs.mkdirSync(path.join(tmp, 'extensions', 'kimi', '1.0.0'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'extensions', 'kimi', '1.0.0', 'manifest.json'), '{}');
  const found = findKimiExtensionDir(tmp);
  assert.ok(found && found.endsWith('1.0.0'), '应探测到带 manifest 的版本目录');
  fs.rmSync(tmp, { recursive: true, force: true });
});
