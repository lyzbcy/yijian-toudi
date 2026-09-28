// 代投多账号核心链路测试（2026-09-22 v0.5.0）
// 覆盖：schema v5 迁移 / boss-batch onApplied 落盘回调 / Agent API /v1/boss/* 路由 / 账号浏览器定位
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { JsonStore } = require('../electron/store.cjs');
const { createSeed } = require('../electron/seed.cjs');
const { BossBatchRunner, extractJobLinks } = require('../electron/boss-batch.cjs');
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
    snapshot: async () => ({ data: { url: 'https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF%E5%AE%9E%E4%B9%A0&city=101200100&page=1', links: [] } }),
    click: async () => ({ data: { success: true } })
  };
  const runner = new BossBatchRunner({
    bridge: fakeBridge,
    target: 1,
    dryRun: true,
    noThrottle: true,
    plan: [{ city: '武汉', query: '前端实习', page: 1 }],
    onApplied: (entry) => recorded.push(entry)
  });
  const result = await runner.run();
  // 空列表无命中：不投出，回调不触发，引擎正常结束
  assert.equal(result.applied.length, 0);
  assert.equal(recorded.length, 0);
  assert.equal(navigateCount, 1);
  assert.equal(runner.stopped, true, '正常完成后须回报空闲，允许下一批启动');
  assert.equal(runner.stopReason, 'completed');

  // 三段式快照：1) 列表页(命中链接) 2) 详情页(立即沟通按钮) 3) 发送后(已向BOSS发送消息)
  const snapList = { data: { url: 'https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF%E5%AE%9E%E4%B9%A0&city=101200100&page=1', links: [{ role: 'link', name: '前端开发实习生-某公司', ref: '@e1', company: '某公司' }] } };
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
  assert.equal(runner2.stopped, true, '达到目标数后须回报空闲');
  assert.equal(recorded2.length, 1, 'onApplied 应恰好触发一次');
  assert.equal(recorded2[0].title, '前端开发实习生-某公司');
  assert.equal(recorded2[0].city, '武汉');
});

test('boss-batch: 未登录城市页即使带普通链接也立即停止', async () => {
  let navigations = 0;
  let clicks = 0;
  const runner = new BossBatchRunner({
    bridge: {
      navigate: async () => { navigations += 1; return { data: { success: true } }; },
      snapshot: async () => ({ data: {
        url: 'https://www.zhipin.com/web/geek/jobs?city=101200100&_security_check=1_123',
        title: '「武汉招聘」-2026年武汉人才招聘信息 - BOSS直聘',
        links: [{ role: 'link', name: '登录/注册', ref: '@e1' }]
      } }),
      click: async () => { clicks += 1; return { data: { success: true } }; }
    },
    plan: [
      { city: '武汉', query: '前端开发实习', page: 1 },
      { city: '武汉', query: '后端开发实习', page: 1 }
    ],
    target: 1,
    dryRun: false,
    noThrottle: true
  });
  const result = await runner.run();
  assert.equal(result.stopReason, 'login-required');
  assert.equal(navigations, 1);
  assert.equal(clicks, 0);
  assert.equal(result.applied.length, 0);
});

test('boss-batch: 已登录城市页即使有 SEO 标题也继续扫描', async () => {
  let navigations = 0;
  const runner = new BossBatchRunner({
    bridge: {
      navigate: async () => { navigations += 1; return { data: { success: true } }; },
      snapshot: async () => ({ data: {
        url: 'https://www.zhipin.com/web/geek/jobs?query=%E6%B8%B8%E6%88%8F%E5%BC%80%E5%8F%91%E5%AE%9E%E4%B9%A0&city=101200100&page=1',
        title: '「武汉招聘」-2026年武汉人才招聘信息 - BOSS直聘',
        links: [
          { role: 'link', name: '简历 new', ref: '@e1' },
          { role: 'link', name: '开发实习', ref: '@e2' },
          { role: 'link', name: '立即沟通', ref: '@e3' }
        ],
        footer: '热门城市 附近城市'
      } }),
      click: async () => { throw new Error('不应点击非目标链接'); }
    },
    plan: [{ city: '武汉', query: '游戏开发实习', page: 1 }],
    target: 1,
    dryRun: false,
    noThrottle: true
  });
  const result = await runner.run();
  assert.equal(result.stopReason, 'completed');
  assert.equal(navigations, 1);
  assert.equal(result.applied.length, 0);
});

test('boss-batch: 已登录页面加载中无岗位链接时不误报掉线', async () => {
  const runner = new BossBatchRunner({
    bridge: {
      navigate: async () => ({ data: { success: true } }),
      snapshot: async () => ({ data: {
        url: 'https://www.zhipin.com/web/geek/jobs?query=%E6%B8%B8%E6%88%8F%E5%BC%80%E5%8F%91%E5%AE%9E%E4%B9%A0&city=101200100&page=1',
        title: '「武汉招聘」-2026年武汉人才招聘信息 - BOSS直聘',
        links: [],
        footer: '热门城市 附近城市'
      } }),
      click: async () => { throw new Error('不应点击加载中的页面'); }
    },
    plan: [{ city: '武汉', query: '游戏开发实习', page: 1 }],
    target: 1,
    dryRun: false,
    noThrottle: true
  });
  const result = await runner.run();
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.applied.length, 0);
});

test('boss-batch: 结构化岗位列表绑定真实公司，避免整页公司误去重', () => {
  const snap = { data: { tree: [{ role: 'list', children: [
    { role: 'listitem', children: [
      { role: 'link', name: '前端开发实习生', ref: '@e20' },
      { role: 'list', children: [] },
      { role: 'link', name: '目标公司', ref: '@e21' }
    ] },
    { role: 'listitem', children: [
      { role: 'link', name: '后端开发实习生', ref: '@e22' },
      { role: 'link', name: '已投公司', ref: '@e23' }
    ] }
  ] }] } };
  assert.deepEqual(extractJobLinks(snap), [
    { title: '前端开发实习生', ref: '@e20', company: '目标公司' },
    { title: '后端开发实习生', ref: '@e22', company: '已投公司' }
  ]);
});

test('boss-batch: 使用规范 jobs 路由，并对旧查询快照重新导航', async () => {
  const calls = [];
  let snapshots = 0;
  const expected = 'https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91%E5%AE%9E%E4%B9%A0&city=101200100&page=1';
  const runner = new BossBatchRunner({
    bridge: {
      navigate: async (url, options) => { calls.push({ url, options }); return { data: { success: true } }; },
      snapshot: async () => ({ data: {
        url: ++snapshots < 4
          ? 'https://www.zhipin.com/web/geek/jobs?query=%E6%B8%B8%E6%88%8F%E5%BC%80%E5%8F%91%E5%AE%9E%E4%B9%A0&city=101200100&page=1'
          : expected,
        tree: []
      } }),
      click: async () => { throw new Error('旧查询不得点击'); }
    },
    plan: [{ city: '武汉', query: '前端开发实习', page: 1 }],
    target: 1,
    dryRun: true,
    noThrottle: true
  });
  await runner.run();
  assert.equal(calls[0].url, expected);
  assert.ok(calls.length >= 2, '旧查询快照应重新导航');
  assert.equal(calls[1].options?.newTab, true);
});

test('boss-batch: 已投公司在点击前跳过', async () => {
  let clicks = 0;
  const runner = new BossBatchRunner({
    bridge: { click: async () => { clicks += 1; return { data: { success: true } }; } },
    banCompanies: ['已投公司'],
    target: 1,
    dryRun: false,
    noThrottle: true
  });
  assert.equal(await runner.applyOne({ title: '前端开发实习生', ref: '@e20', company: '已投公司' }, '武汉'), 'skip');
  assert.equal(clicks, 0);
});

test('boss-batch: dryRun 达目标后停并只记录预览', async () => {
  let clicks = 0;
  let persisted = 0;
  let phase = 0;
  const searchUrl = 'https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91%E5%AE%9E%E4%B9%A0&city=101200100&page=1';
  const runner = new BossBatchRunner({
    bridge: {
      navigate: async () => {},
      snapshot: async () => phase++ === 0
        ? { data: { url: searchUrl, links: [
          { role: 'link', name: '前端开发实习生', ref: '@e1', company: '公司甲' },
          { role: 'link', name: '前端开发实习生', ref: '@e2', company: '公司乙' }
        ] } }
        : { data: { url: 'https://www.zhipin.com/job_detail/x', links: [{ role: 'link', name: '立即沟通', ref: '@e3' }] } },
      click: async () => { clicks += 1; return { data: { success: true } }; }
    },
    plan: [{ city: '武汉', query: '前端开发实习', page: 1 }],
    target: 1, dryRun: true, noThrottle: true,
    onApplied: () => { persisted += 1; }
  });
  const result = await runner.run();
  assert.deepEqual(result.previewed, [{ city: '武汉', title: '前端开发实习生', company: '公司甲' }]);
  assert.equal(result.applied.length, 0);
  assert.equal(clicks, 1, '仅点开详情，不点沟通按钮');
  assert.equal(persisted, 0);
});

test('boss-batch: 发送后无回执即停且不继续下一岗位', async () => {
  let clicks = 0;
  let phase = 0;
  const runner = new BossBatchRunner({
    bridge: {
      navigate: async () => {},
      snapshot: async () => phase++ === 0
        ? { data: { url: 'https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91%E5%AE%9E%E4%B9%A0&city=101200100&page=1', links: [
          { role: 'link', name: '前端开发实习生', ref: '@e1', company: '公司甲' },
          { role: 'link', name: '前端开发实习生', ref: '@e2', company: '公司乙' }
        ] } }
        : { data: { url: 'https://www.zhipin.com/job_detail/x', links: [{ role: 'link', name: '立即沟通', ref: '@e3' }] } },
      click: async () => { clicks += 1; return { data: { success: true } }; }
    },
    plan: [{ city: '武汉', query: '前端开发实习', page: 1 }],
    target: 2, dryRun: false, noThrottle: true
  });
  const result = await runner.run();
  assert.equal(result.stopReason, 'send-unverified');
  assert.equal(result.applied.length, 0);
  assert.equal(clicks, 2, '第一岗位详情和发送各点击一次，第二岗位未触碰');
});

test('boss-batch: 回执后落盘失败须停，避免继续发送', async () => {
  let clicks = 0;
  let phase = 0;
  const runner = new BossBatchRunner({
    bridge: {
      navigate: async () => {},
      snapshot: async () => {
        phase += 1;
        if (phase === 1) return { data: { url: 'https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91%E5%AE%9E%E4%B9%A0&city=101200100&page=1', links: [
          { role: 'link', name: '前端开发实习生', ref: '@e1', company: '公司甲' },
          { role: 'link', name: '前端开发实习生', ref: '@e2', company: '公司乙' }
        ] } };
        if (phase === 2) return { data: { links: [{ role: 'link', name: '立即沟通', ref: '@e3' }] } };
        return { data: { raw: '已向BOSS发送消息' } };
      },
      click: async () => { clicks += 1; return { data: { success: true } }; }
    },
    plan: [{ city: '武汉', query: '前端开发实习', page: 1 }],
    target: 2, dryRun: false, noThrottle: true,
    onApplied: () => { throw new Error('disk full'); }
  });
  const result = await runner.run();
  assert.equal(result.stopReason, 'persist-failed');
  assert.equal(result.applied.length, 1, '真实发送仍应如实计数');
  assert.equal(clicks, 2);
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
