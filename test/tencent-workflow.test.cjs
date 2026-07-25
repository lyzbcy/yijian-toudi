const test = require('node:test');
const assert = require('node:assert/strict');
const { fillTencentResume } = require('../electron/adapters/tencent-fill.cjs');
const { applyTencentJob } = require('../electron/adapters/tencent-apply.cjs');

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

test('腾讯岗位投递只准备可见审核页面，不宣称已经提交', async () => {
  const opened = [];
  const scripts = [];
  const workspace = {
    async openWorkspace(options) {
      opened.push(options);
    },
    async run(script) {
      scripts.push(script);
      if (scripts.length === 1) {
        return {
          isNotFound: false,
          loginRequired: false,
          applyButton: { selector: '.default-btn', text: '申请岗位' }
        };
      }
      return { clicked: true };
    }
  };

  const result = await applyTencentJob(
    {
      id: 'tencent-123',
      companyId: 'tencent',
      title: '前端工程师',
      url: 'https://careers.tencent.com/jobdesc.html?postId=123'
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

  assert.equal(opened[0].mode, 'application-review');
  assert.equal(opened[0].context.jobId, 'tencent-123');
  assert.equal(result.status, 'review-required');
  assert.equal(result.ok, true);
});
