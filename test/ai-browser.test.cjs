const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.FIXTURE_SOURCE_ROOT || path.resolve(__dirname, '..');
test('AI browser entry and local-only request validation', () => {
  const api = require(path.join(root, 'scripts/ai-browser.cjs'));
  assert.equal(api.sanitizeUrl('https://qq.jd.com/new/wx/callback.action?code=secret#token'), 'https://qq.jd.com/new/wx/callback.action');
  assert.equal(api.sanitizeUrl('https://campus.jd.com/#/resume?code=secret'), 'https://campus.jd.com/#/resume');
  assert.equal(api.requiresSubmission({name:'保 存'}),true);
  assert.equal(api.requiresSubmission({name:'微信登录'}),false);
  assert.deepEqual(api.normalizeRequest({action:'list',port:9229}).framePath, []);
  assert.throws(()=>api.normalizeRequest({action:'evaluate'}), /unsupported_action/);
  assert.throws(()=>api.normalizeRequest({action:'list',port:0}), /invalid_port/);
  assert.throws(()=>api.normalizeRequest({action:'list',endpoint:'http://example.com'}), /unknown_field/);
  assert.throws(()=>api.normalizeRequest({action:'snapshot'}), /target_id_required/);
  assert.throws(()=>api.normalizeRequest({action:'snapshot',targetId:'x',framePath:[-1]}), /invalid_frame_path/);
  assert.throws(()=>api.normalizeRequest({action:'click',targetId:'x',ref:'e1'}), /snapshot_id_required/);
  assert.throws(()=>api.normalizeRequest({action:'fill',targetId:'x',ref:'e1',snapshotId:'x'}), /fill_value_required/);
});
