const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, dayInShanghai } = require('../skill/yijian-toudi/scripts/daily-boss.cjs');
const { JsonStore } = require('../electron/store.cjs');
const { AgentServer } = require('../electron/agent-server.cjs');
const skillVersion = require('../skill/yijian-toudi/version.json').version;

test('Shanghai date is stable across the UTC day boundary', () => {
  assert.equal(dayInShanghai(new Date('2026-09-27T16:00:00Z')), '2026-09-28');
});

function fixture() {
  const calls = [];
  const request = async (url, options) => {
    const route = new URL(url).pathname;
    calls.push({ route, method: options.method, body: options.body && JSON.parse(options.body) });
    const data = route === '/v1/status' ? { version: skillVersion }
      : route === '/v1/boss/accounts' ? { accounts: [{ id: 'default' }, { id: 'client' }] }
      : route === '/v1/boss/batch/status' ? { running: false }
      : { started: true, accountId: options.body && JSON.parse(options.body).accountId, target: options.body && JSON.parse(options.body).target };
    return { ok: true, json: async () => data };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjtd-skill-'));
  const env = { YJTD_API_TOKEN: 'test-token', YJTD_STATE_DIR: dir, YJTD_TARGET: '100' };
  return { request, calls, dir, env };
}

test('dryRun starts but does not write the daily marker', async () => {
  const x = fixture();
  try {
    const result = await run({ env: { ...x.env, YJTD_DRY_RUN: '1' }, request: x.request, now: new Date('2026-09-28T01:00:00Z') });
    assert.equal(result.started, true);
    assert.deepEqual(x.calls.at(-1).body, { accountId: 'default', target: 100, dryRun: true });
    assert.equal(fs.readdirSync(x.dir).length, 0);
  } finally { fs.rmSync(x.dir, { recursive: true, force: true }); }
});

test('live start is once per Shanghai day', async () => {
  const x = fixture();
  try {
    const first = await run({ env: x.env, request: x.request, now: new Date('2026-09-28T01:00:00Z') });
    const second = await run({ env: x.env, request: x.request, now: new Date('2026-09-28T02:00:00Z') });
    assert.equal(first.started, true);
    assert.equal(second.skipped, 'already-triggered-today');
    assert.equal(x.calls.filter((c) => c.route.endsWith('/start')).length, 1);
    assert.equal(fs.readdirSync(x.dir).length, 1);
  } finally { fs.rmSync(x.dir, { recursive: true, force: true }); }
});

test('rejects mismatched version, remote origin, and over-cap target before start', async () => {
  const x = fixture();
  try {
    await assert.rejects(run({ env: { ...x.env, YJTD_BASE_URL: 'https://example.com' }, request: x.request }), /loopback/);
    await assert.rejects(run({ env: { ...x.env, YJTD_ACCOUNT_ID: 'client' }, request: x.request }), /exceeds account cap/);
    const wrongVersion = async (url, options) => url.pathname === '/v1/status'
      ? { ok: true, json: async () => ({ version: '0.4.0' }) }
      : x.request(url, options);
    await assert.rejects(run({ env: x.env, request: wrongVersion }), /version mismatch/);
    assert.equal(x.calls.filter((c) => c.route.endsWith('/start')).length, 0);
  } finally { fs.rmSync(x.dir, { recursive: true, force: true }); }
});

test('dryRun reaches the real loopback Agent API without external browser actions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjtd-skill-api-'));
  const store = new JsonStore(dir);
  store.init();
  store.update((state) => { state.settings.apiToken = 'integration-token'; return state; });
  const starts = [];
  const server = new AgentServer({
    store,
    onCommand: async () => ({}),
    bossControl: {
      accounts: async () => ({ accounts: [{ id: 'default' }] }),
      status: async () => ({ running: false }),
      start: async (body) => { starts.push(body); return { started: true, ...body }; }
    }
  });
  try {
    const port = await server.start(0);
    const result = await run({ env: { YJTD_API_TOKEN: 'integration-token', YJTD_BASE_URL: `http://127.0.0.1:${port}`, YJTD_DRY_RUN: '1' } });
    assert.equal(result.started, true);
    assert.deepEqual(starts, [{ accountId: 'default', target: 100, dryRun: true }]);
  } finally {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
