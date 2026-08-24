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

test('resume-review 模式右侧预留进度日志栏空间，其余模式全宽', () => {
  const full = calculateWorkspaceBounds(1440, 900);
  assert.equal(full.width, 1440);
  const withRail = calculateWorkspaceBounds(1440, 900, { reserveFillLogRail: true });
  assert.equal(withRail.width, 1440 - 296);
  assert.equal(withRail.x + withRail.width, 1144);
});
