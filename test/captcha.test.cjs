const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  detectTencentCaptcha,
  requireManualCaptcha
} = require('../electron/captcha.cjs');

test('detectTencentCaptcha 在无 workspace 时返回 detected:false', async () => {
  const result = await detectTencentCaptcha(null);
  assert.equal(result.detected, false);
  const result2 = await detectTencentCaptcha({});
  assert.equal(result2.detected, false);
});

test('detectTencentCaptcha 页面无滑块按钮时返回 detected:false', async () => {
  const workspace = {
    run: async () => ({ detected: false })
  };
  const result = await detectTencentCaptcha(workspace);
  assert.equal(result.detected, false);
});

test('detectTencentCaptcha 检测到拖动按钮时返回 btnRect', async () => {
  const workspace = {
    run: async () => ({ detected: true, btnRect: { x: 10, y: 200, w: 40, h: 20 } })
  };
  const result = await detectTencentCaptcha(workspace);
  assert.equal(result.detected, true);
  assert.equal(result.btnRect.w, 40);
});

test('验证码模块只检测并交给用户，不伪装浏览器或自动拖动', async () => {
  const workspace = {
    run: async () => ({ detected: true, btnRect: { x: 10, y: 20, w: 30, h: 20 } })
  };
  const result = await requireManualCaptcha(workspace);
  assert.equal(result.detected, true);
  assert.equal(result.manualRequired, true);
  assert.match(result.message, /手动/);
});
