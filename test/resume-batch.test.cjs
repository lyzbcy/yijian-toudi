const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ResumeBatch, tileBounds, resumeFingerprint } = require('../electron/resume-batch.cjs');
const tick = () => new Promise(r => setImmediate(r));
test('fingerprint ignores save timestamps, completion and inactive profiles', () => {
  assert.equal(resumeFingerprint({ basic: { name: 'A', email: 'B' }, updatedAt: 1, completion: 50, profiles: [] }),
    resumeFingerprint({ completion: 80, updatedAt: 2, basic: { email: 'B', name: 'A' }, profiles: [{ id: 'unused' }] }));
  assert.notEqual(resumeFingerprint({ basic: { name: 'A' } }), resumeFingerprint({ basic: { name: 'B' } }));
});
function fixture({ count = 7, fill, targets } = {}) {
  let state = { settings: {}, resume: { basic: { name: 'fixture' } } };
  const opened = [], disposed = [];
  const store = { get: () => structuredClone(state), update: fn => { state = fn(structuredClone(state)); } };
  targets ||= Array.from({ length: count }, (_, i) => ({ id: `c${i}`, name: `C${i}`, syncTargetId: `c${i}:campus`, resumeRecruitType: 'campus' }));
  const batch = new ResumeBatch({ store, getTargets: () => targets,
    getAdapter: () => ({ fillResume: fill || (async () => ({ status: 'review-required' })) }),
    createWorkspace: async (t, index) => { opened.push(t.syncTargetId); return { index, dispose: async () => disposed.push(t.syncTargetId) }; }
  });
  return { batch, store, opened, disposed, ids: targets.map(t => t.syncTargetId) };
}
test('selection validates empty, unknown, concurrency and deduplicates', async () => {
  const f = fixture();
  assert.throws(() => f.batch.start({ targetIds: [] }));
  assert.throws(() => f.batch.start({ targetIds: ['unknown'] }));
  assert.throws(() => f.batch.start({ targetIds: f.ids, concurrency: 8 }));
  f.batch.start({ targetIds: [f.ids[2], f.ids[2]] }); await tick();
  assert.deepEqual(f.opened, [f.ids[2]]);
  assert.deepEqual(f.store.get().settings.resumeSyncSelection, [f.ids[2]]);
  await f.batch.stop();
});
for (const concurrency of [4, 6]) test(`${concurrency} independent slots; close advances queue and failure stays local`, async () => {
  const f = fixture(); f.batch.start({ targetIds: f.ids, concurrency }); await tick();
  assert.equal(f.opened.length, concurrency);
  assert.throws(() => f.batch.start({ targetIds: f.ids }));
  await f.batch.close(f.ids[0]); await tick();
  assert.equal(f.opened.length, concurrency + 1);
  assert.equal(f.batch.slots.size, concurrency);
  await f.batch.stop(); assert.equal(f.batch.isActive(), false);
});
test('same platform different tracks serialize but do not block another company', async () => {
  const targets = [{ id: 'a', syncTargetId: 'a:social' }, { id: 'a', syncTargetId: 'a:campus' }, { id: 'b', syncTargetId: 'b:campus' }];
  const f = fixture({ targets }); f.batch.start({ targetIds: f.ids }); await tick();
  assert.deepEqual(f.opened, ['a:social', 'b:campus']);
  await f.batch.close('a:social'); await tick();
  assert.equal(f.opened.at(-1), 'a:campus'); await f.batch.stop();
});
test('stop retains lock until in-flight adapter settles; no late saved receipt', async () => {
  let done;
  const f = fixture({ count: 1, fill: () => new Promise(r => { done = r; }) });
  f.batch.start({ targetIds: f.ids }); await tick(); await f.batch.stop();
  assert.equal(f.batch.isActive(), true);
  assert.throws(() => f.batch.start({ targetIds: f.ids }));
  done({ status: 'saved', saveEvidence: 'late' }); await tick();
  assert.equal(f.batch.isActive(), false);
  assert.equal(f.store.get().resumeSyncHistory[f.ids[0]].status, 'cancelled');
  assert.equal(f.store.get().resumeSyncHistory[f.ids[0]].lastUpdatedAt, undefined);
});
test('attempt timestamp is not saved timestamp; saved needs evidence and survives new controller', async () => {
  let result = { status: 'saved' };
  const f = fixture({ count: 1, fill: async () => result });
  f.batch.start({ targetIds: f.ids }); await tick();
  let h = f.store.get().resumeSyncHistory[f.ids[0]];
  assert.ok(h.lastAttemptAt); assert.equal(h.lastUpdatedAt, undefined); assert.equal(h.status, 'review-required');
  result = { status: 'saved', saveEvidence: 'fixture server read-back receipt' };
  await f.batch.retry(f.ids[0]); await tick();
  h = f.store.get().resumeSyncHistory[f.ids[0]]; assert.ok(h.lastUpdatedAt);
  await f.batch.close(f.ids[0]);
  new ResumeBatch({ store: f.store, getTargets: () => [] });
  assert.equal(f.store.get().resumeSyncHistory[f.ids[0]].lastUpdatedAt, h.lastUpdatedAt);
  f.store.update(s => { s.resume.basic.name = 'changed'; return s; });
  assert.equal(f.batch.catalog().targets[0].resumeChanged, true);
});
test('adapter exception releases only failing slot', async () => {
  const f = fixture({ fill: async (_r, { company }) => { if (company.id === 'c0') throw Error('fixture'); return { status: 'login-required' }; } });
  f.batch.start({ targetIds: f.ids }); await tick(); await tick();
  assert.equal(f.batch.entries[0].status, 'failed'); assert.equal(f.opened.length, 5);
  assert.equal(f.batch.entries[1].status, 'login-required'); await f.batch.stop();
});
test('explicit user confirmation is separate from automatic save and not inherited by new resume', async () => {
  const f = fixture({ count: 1 }); f.batch.start({ targetIds: f.ids }); await tick();
  await f.batch.confirmSaved(f.ids[0]);
  const h = f.store.get().resumeSyncHistory[f.ids[0]];
  assert.ok(h.lastUserConfirmedAt); assert.equal(h.lastUpdatedAt, undefined);
  f.store.update(s => { s.resume.basic.name = 'new resume'; return s; });
  f.batch.start({ targetIds: f.ids }); await tick();
  assert.equal(f.batch.catalog().targets[0].resumeChanged, true);
  await f.batch.stop();
});
test('selection persistence failure starts no window and leaves no phantom lock', () => {
  const f = fixture(); f.store.update = () => { throw Error('disk full'); };
  assert.throws(() => f.batch.start({ targetIds: f.ids }), /disk full/);
  assert.equal(f.batch.isActive(), false); assert.equal(f.opened.length, 0);
});
test('rapid double retry cannot overlap a platform', async () => {
  const f = fixture({ count: 1 }); f.batch.start({ targetIds: f.ids }); await tick();
  const first = f.batch.retry(f.ids[0]);
  await assert.rejects(f.batch.retry(f.ids[0])); await first; await tick();
  assert.equal(f.opened.length, 2); await f.batch.stop();
});
test('tile coordinates cover a non-origin monitor with no overlap', () => {
  for (const count of [4, 6]) {
    const area = { x: -1920, y: 40, width: 1919, height: 1039 };
    const tiles = Array.from({ length: count }, (_, i) => tileBounds(area, count, i));
    assert.equal(tiles.reduce((sum, t) => sum + t.width * t.height, 0), area.width * area.height);
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = tiles[i], b = tiles[j];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  }
});
