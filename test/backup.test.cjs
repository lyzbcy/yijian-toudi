const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBackup,
  restoreBackup
} = require('../electron/backup.cjs');
const { JsonStore } = require('../electron/store.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function sampleState(name) {
  return {
    meta: {
      schemaVersion: 1,
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z'
    },
    companies: [{ id: 'tencent', name: '腾讯' }],
    jobs: [{ id: 'job-1', title: '工程师' }],
    messages: [],
    resume: {
      basic: { name }
    },
    cart: [],
    applied: [],
    tasks: [],
    audit: [],
    idempotency: {
      secret: { status: 'done' }
    },
    settings: {
      apiToken: `token-${name}`,
      githubRepo: 'lyzbcy/yijian-toudi',
      jobs: { daysBack: 30, recruitType: 'social' },
      email: {
        address: 'user@qq.com',
        encryptedCode: `encrypted-${name}`,
        connected: true
      }
    }
  };
}

test('备份排除 Token、邮箱授权码和幂等记录', () => {
  const backup = createBackup(sampleState('备份用户'), '0.2.0');

  assert.equal(backup.format, 'yijian-toudi-backup');
  assert.equal(backup.appVersion, '0.2.0');
  assert.equal(backup.data.settings.apiToken, undefined);
  assert.equal(backup.data.settings.email.encryptedCode, undefined);
  assert.equal(backup.data.idempotency, undefined);
});

test('恢复用户数据但保留当前机器的 Token 和邮箱授权码', () => {
  const current = sampleState('当前用户');
  const backup = createBackup(sampleState('备份用户'), '0.2.0');
  const restored = restoreBackup(current, backup);

  assert.equal(restored.resume.basic.name, '备份用户');
  assert.equal(restored.settings.apiToken, 'token-当前用户');
  assert.equal(restored.settings.email.encryptedCode, 'encrypted-当前用户');
  assert.deepEqual(restored.idempotency, current.idempotency);
});

test('恢复拒绝未知格式且不修改当前对象', () => {
  const current = sampleState('当前用户');
  const before = structuredClone(current);

  assert.throws(
    () => restoreBackup(current, { format: 'other', data: {} }),
    /备份格式/
  );
  assert.deepEqual(current, before);
});

test('JsonStore.replace 会把恢复结果真正写回磁盘和内存', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-restore-'));
  const jsonStore = new JsonStore(directory);
  jsonStore.init();
  const current = jsonStore.get();
  const replacement = structuredClone(current);
  replacement.resume.basic.name = '备份里的姓名';
  const profile = replacement.resume.profiles.find((item) => item.id === replacement.resume.activeProfileId);
  if (profile) profile.label = '恢复后的简历';

  jsonStore.replace(replacement);
  assert.equal(jsonStore.get().resume.basic.name, '备份里的姓名');
  const reloaded = new JsonStore(directory);
  reloaded.init();
  assert.equal(reloaded.get().resume.basic.name, '备份里的姓名');
});
