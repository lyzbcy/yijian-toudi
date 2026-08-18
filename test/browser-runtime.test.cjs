const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveBrowserExecutable } = require('../electron/browser-runtime.cjs');

test('浏览器解析优先使用显式存在路径，不硬编码 Playwright 缓存版本', () => {
  const explicit = path.join(path.sep, 'custom', 'chrome');
  const result = resolveBrowserExecutable({
    explicitPath: explicit,
    platform: 'darwin',
    existsSync: (candidate) => candidate === explicit
  });
  assert.equal(result, explicit);
});

test('找不到浏览器时给出可理解错误而非引用本机 chromium-1223', () => {
  assert.throws(
    () => resolveBrowserExecutable({ platform: 'linux', existsSync: () => false }),
    (error) => /Chrome|Edge|Chromium/.test(error.message) && !/1223/.test(error.message)
  );
});
