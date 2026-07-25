const test = require('node:test');
const assert = require('node:assert/strict');
const { fillTencentResume } = require('../electron/adapters/tencent-fill.cjs');

test('腾讯简历填写保留可见工作区并返回逐字段报告', async () => {
  const opened = [];
  const scripts = [];
  const workspace = {
    async openWorkspace(options) {
      opened.push(options);
    },
    async run(script) {
      scripts.push(script);
      if (scripts.length === 1) {
        return { loginRequired: false, isNotFound: false, inputCount: 2 };
      }
      return [
        { key: 'basic.name', matched: true },
        { key: 'basic.email', matched: false }
      ];
    }
  };

  const result = await fillTencentResume(
    {
      basic: { name: '张三', email: 'z@example.com' }
    },
    {
      workspace,
      company: {
        id: 'tencent',
        name: '腾讯',
        portal: 'https://careers.tencent.com/'
      }
    }
  );

  assert.equal(opened[0].mode, 'resume-review');
  assert.equal(result.status, 'review-required');
  assert.deepEqual(result.report.filled, ['basic.name']);
  assert.deepEqual(result.report.manual, ['basic.email']);
});
