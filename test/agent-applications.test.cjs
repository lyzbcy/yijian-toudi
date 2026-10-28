'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { mutate, read } = require('../electron/agent-applications.cjs');
const { AgentServer } = require('../electron/agent-server.cjs');
const { JsonStore } = require('../electron/store.cjs');
function fixture() {
  let state = {}, n = 0;
  const s = { accountId: 'ACCOUNT', profileId: 'PROFILE' };
  const write = body => { const draft = structuredClone(state); const r = mutate(draft, { ...s, ...body }, 'key-' + ++n); state = draft; return r; };
  const create = () => write({ action: 'create', company: 'SAMPLE 企业', role: '工程师', jobKey: 'job-1', url: 'https://jobs.example/job?token=secret#private' });
  const next = (item, action, extra = {}) => write({ id: item.id, revision: item.revision, action, ...extra });
  const ready = i => next(i, 'ready', { eligibilityConfirmed: true, factsConfirmed: true, fieldsReviewed: true, attachmentsReviewed: true, missingFields: [] });
  const begin = i => next(ready(i), 'begin-submit', { userAuthorized: true });
  const receipt = i => next(i, 'receipt', { attemptId: i.attemptId, outcome: 'submitted', evidence: { observed: true, url: 'https://jobs.example/my-applications', reference: 'PRIVATE_RECEIPT.png', text: '申请成功 SAMPLE job-1', observedAt: new Date().toISOString() } });
  return { s, write, create, next, ready, begin, receipt, state: () => state };
}
test('create accepts arbitrary website and strips query tokens; duplicate scope and job', () => {
  const f = fixture(), i = f.create(); assert.equal(i.url, 'https://jobs.example/job');
  assert.throws(f.create, /duplicate/);
  assert.equal(read(f.state(), { ...f.s, accountId: 'OTHER' }).counts.total, 0);
  assert.throws(() => f.next(i, 'checkpoint', { accountId: 'OTHER', status: 'in-progress', reason: 'test' }), /not-found/);
  const query = f.write({ action: 'create', company: 'OTHER 企业', role: '工程师', jobKey: 'job-2', url: 'https://jobs.example/detail?jobId=J2&token=secret' });
  assert.equal(query.url, 'https://jobs.example/detail?jobId=J2');
});
test('missing facts pause a single job, revision prevents stale updates', () => {
  const f = fixture(), i = f.create(), paused = f.next(i, 'checkpoint', { status: 'waiting-materials', reason: '待客户核实', tabId: 'TAB', missingFields: [{ field: '高考满分', reason: '未确认' }] });
  assert.equal(paused.missingFields.length, 1); assert.equal(read(f.state(), f.s).counts.pending, 1);
  assert.throws(() => f.next(i, 'checkpoint', { status: 'skipped', reason: 'stale' }), /revision-conflict/);
  assert.throws(() => f.next(paused, 'ready', { factsConfirmed: false }), /review-required/);
  assert.equal(f.ready(paused).status, 'ready');
});
test('ready requires all four reviews and resolved materials; authorization before intent', () => {
  const f = fixture(), i = f.create();
  assert.throws(() => f.next(i, 'begin-submit', { userAuthorized: true }), /not-ready/);
  assert.throws(() => f.next(i, 'ready', { eligibilityConfirmed: true, factsConfirmed: true, fieldsReviewed: true, attachmentsReviewed: true, missingFields: [{ field: 'unknown' }] }), /unresolved-materials/);
  const ready = f.ready(i); assert.throws(() => f.next(ready, 'begin-submit', {}), /not-ready/);
});
test('short forms rank first; blocked and uncertain jobs do not stop next candidates', () => {
  const f = fixture(), slow = f.create();
  const fast = f.write({ action: 'create', company: 'SHORT 企业', role: '工程师', jobKey: 'short', url: 'https://jobs.example/short', effort: 'short', timeBudgetSeconds: 60 });
  assert.equal(read(f.state(), f.s).nextCandidates[0].id, fast.id);
  f.next(fast, 'checkpoint', { status: 'waiting-verification', reason: '用户接管' });
  assert.deepEqual(read(f.state(), f.s).nextCandidates.map(i => i.id), [slow.id]);
  f.begin(slow); assert.equal(read(f.state(), f.s).nextCandidates.length, 0);
  assert.throws(() => f.write({ action: 'create', company: 'X', role: 'Y', jobKey: 'budget', url: 'https://jobs.example', timeBudgetSeconds: 0 }), /invalid-effort-budget/);
});
test('unknown cannot be reset/retried, only receipt query resolves same attempt', () => {
  const f = fixture(), active = f.begin(f.create()), unknown = f.next(active, 'receipt', { attemptId: active.attemptId, outcome: 'submission-unknown' });
  assert.throws(() => f.ready(unknown), /receipt-query-required/);
  assert.throws(() => f.next(unknown, 'checkpoint', { status: 'in-progress', reason: 'retry' }), /receipt-query-required/);
  assert.throws(() => f.next(unknown, 'receipt', { attemptId: 'wrong', outcome: 'submitted' }), /attempt-mismatch/);
  assert.equal(f.receipt(unknown).status, 'submitted');
});
test('receipt requires evidence; independent sync and unique company count', () => {
  const f = fixture(), active = f.begin(f.create());
  assert.throws(() => f.next(active, 'receipt', { attemptId: active.attemptId, outcome: 'submitted' }), /evidence-required/);
  assert.throws(() => f.next(active, 'sync', { status: 'synced' }), /receipt-required/);
  let done = f.receipt(active); done = f.next(done, 'sync', { status: 'failed', destination: 'OfferBiu', reference: '等待同步' });
  assert.equal(read(f.state(), f.s).counts.submitted, 1); assert.equal(read(f.state(), f.s).counts.synced, 0);
  f.next(done, 'sync', { status: 'synced', destination: 'OfferBiu', reference: 'record-SAMPLE' });
  const second = f.write({ action: 'create', company: 'ＳＡＭＰＬＥ 企业', role: '另一岗位', jobKey: 'job-2', url: 'https://jobs.example/2' });
  f.receipt(f.begin(second));
  assert.deepEqual(read(f.state(), f.s).counts, { total: 2, submitted: 2, uniqueCompanies: 1, synced: 1, pending: 0 });
  assert.equal(read(f.state(), f.s).coverage.measuredPercent, null);
});
test('bad URL, future receipt, body types and idempotency conflicts reject', () => {
  const f = fixture();
  for (const url of ['javascript:alert(1)', 'file:///C:/private', 'https://user:pass@example.com']) assert.throws(() => f.write({ action: 'create', company: 'X', role: 'Y', jobKey: url, url }), /invalid-url/);
  const active = f.begin(f.create());
  assert.throws(() => f.next(active, 'receipt', { attemptId: active.attemptId, outcome: 'submitted', evidence: { observed: true, observedAt: '2099-01-01', url: 'https://jobs.example', reference: 'x', text: 'y' } }), /evidence-time/);
  const state = {}, body = { ...f.s, action: 'create', company: 'X', role: 'Y', jobKey: 'Z', url: 'https://jobs.example' };
  assert.throws(() => mutate(state, body, null), /required/);
  const a = mutate(state, body, '__proto__'); assert.deepEqual(mutate(state, body, '__proto__'), a);
  assert.throws(() => mutate(state, { ...body, role: 'OTHER' }, '__proto__'), /idempotency-conflict/);
  assert.throws(() => mutate(state, null, 'key'), /invalid-body/);
});
test('production HTTP persists across store restart, auth/read isolation/idempotency and CLI', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-applications83-'));
  const store = new JsonStore(dir); store.init(); let server;
  try {
    server = new AgentServer({ store }); const port = await server.start(0), base = 'http://127.0.0.1:' + port;
    const headers = { Authorization: 'Bearer ' + store.get().settings.apiToken, 'Content-Type': 'application/json', 'Idempotency-Key': 'create-http' };
    assert.equal((await fetch(base + '/v1/applications')).status, 401);
    assert.equal((await fetch(base + '/v1/applications', { headers })).status, 400);
    const body = { accountId: 'ACCOUNT', profileId: 'PROFILE', action: 'create', company: 'SAMPLE', role: '工程师', jobKey: 'J1', url: 'https://jobs.example/J1' };
    const post = () => fetch(base + '/v1/applications', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await fetch(base + '/v1/applications', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'bad key' }, body: JSON.stringify(body) })).status, 400);
    const a = await post(); assert.equal(a.status, 200); const result = await a.json();
    assert.deepEqual(await (await post()).json(), result);
    const before = fs.readFileSync(store.file, 'utf8');
    const q = '?accountId=ACCOUNT&profileId=PROFILE';
    assert.equal((await (await fetch(base + '/v1/applications' + q, { headers })).json()).counts.total, 1);
    assert.equal(fs.readFileSync(store.file, 'utf8'), before);
    const { spawn } = require('node:child_process');
    const cli = await new Promise(resolve => {
      const child = spawn(process.execPath, [path.resolve(__dirname, '../skill/yijian-toudi/scripts/applications.cjs'), 'list', 'ACCOUNT', 'PROFILE'], { windowsHide: true, env: { ...process.env, YJTD_BASE_URL: base, YJTD_API_TOKEN: store.get().settings.apiToken } });
      let out = '', err = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b); child.on('exit', code => resolve({ code, out, err }));
    });
    assert.equal(cli.code, 0, cli.err); assert.equal(JSON.parse(cli.out).items[0].id, result.item.id);
    const input = path.join(dir, 'private-input.json');
    fs.writeFileSync(input, JSON.stringify({ ...body, jobKey: 'J2' }));
    const written = await new Promise(resolve => {
      const child = spawn(process.execPath, [path.resolve(__dirname, '../skill/yijian-toudi/scripts/applications.cjs'), 'write', input, 'cli-write-J2'], { windowsHide: true, env: { ...process.env, YJTD_BASE_URL: base, YJTD_API_TOKEN: store.get().settings.apiToken } });
      let out = '', err = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b); child.on('exit', code => resolve({ code, out, err }));
    });
    assert.equal(written.code, 0, written.err); assert.equal(JSON.parse(written.out).item.jobKey, 'J2');
    await server.stop();
    const reopened = new JsonStore(dir); reopened.init();
    assert.equal(read(reopened.get(), body).items[0].id, result.item.id);
    assert.equal(read(reopened.get(), body).counts.total, 2);
  } finally { await server?.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('shutdown after await prevents ledger writes', async () => {
  const state = { settings: { apiToken: 'SAMPLE' } }; let writes = 0, stopping;
  const api = new AgentServer({ store: { get: () => state, update: () => writes++ } });
  try {
    const port = await api.start(0);
    api.server.once('request', r => r.once('end', () => { stopping = api.stop(); }));
    const response = await fetch('http://127.0.0.1:' + port + '/v1/applications', { method: 'POST', headers: { Authorization: 'Bearer SAMPLE' }, body: '{}' });
    assert.equal(response.status, 503); await stopping; assert.equal(writes, 0);
  } finally { await api.stop(); }
});
