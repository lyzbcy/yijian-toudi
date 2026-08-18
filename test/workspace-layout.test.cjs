const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TOP_BAR_HEIGHT,
  calculateWorkspaceBounds
} = require('../electron/workspace-layout.cjs');

test('内嵌网页从顶部退出栏下方开始', () => {
  assert.equal(TOP_BAR_HEIGHT, 52);
  assert.deepEqual(calculateWorkspaceBounds(1440, 900), {
    x: 0,
    y: 52,
    width: 1440,
    height: 848
  });
});

test('极小内容区不会产生负尺寸', () => {
  assert.deepEqual(calculateWorkspaceBounds(-1, 20), {
    x: 0,
    y: 52,
    width: 0,
    height: 0
  });
});
