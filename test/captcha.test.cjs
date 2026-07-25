const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  attachStealth,
  detectTencentCaptcha,
  solveTencentCaptcha,
  FIND_GAP_SCRIPT,
  STEALTH_SCRIPT
} = require('../electron/captcha.cjs');

test('STEALTH_SCRIPT 是合法 JS 且隐藏 navigator.webdriver', () => {
  const ctx = { navigator: { webdriver: true }, window: { innerWidth: 1000, innerHeight: 700, outerWidth: 0, outerHeight: 0 } };
  vm.createContext(ctx);
  vm.runInContext(STEALTH_SCRIPT, ctx);
  assert.equal(ctx.navigator.webdriver, undefined);
});

test('FIND_GAP_SCRIPT 是合法 JS（可解析）', () => {
  // 验证脚本能被 JS 引擎解析（语法正确）
  assert.doesNotThrow(() => new vm.Script(FIND_GAP_SCRIPT));
});

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

test('solveTencentCaptcha 无 webContents 时优雅降级', async () => {
  const result = await solveTencentCaptcha({ getWebContents: () => null });
  assert.equal(result.solved, false);
  assert.equal(result.reason, 'no-webcontents');
});

test('solveTencentCaptcha 未检测到验证码视为已通过', async () => {
  const workspace = {
    getWebContents: () => ({ isDestroyed: () => false }),
    run: async () => ({ detected: false })
  };
  const result = await solveTencentCaptcha(workspace);
  assert.equal(result.solved, true);
  assert.equal(result.reason, 'no-captcha-detected');
});

test('attachStealth 对空 webContents 安全返回', () => {
  assert.equal(typeof attachStealth(null), 'undefined');
  const cleanup = attachStealth({ isDestroyed: () => true });
  assert.equal(typeof cleanup, 'undefined');
});
