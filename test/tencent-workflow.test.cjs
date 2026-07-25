const test = require('node:test');
const assert = require('node:assert/strict');
const { fillTencentResume, planTencentResumePatch } = require('../electron/adapters/tencent-fill.cjs');
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
      if (scripts.length === 2) {
        return [
          { key: 'basic.name', matched: true },
          { key: 'basic.email', matched: false }
        ];
      }
      // 第 3 次 run 是 INSPECT_FORM_FIELDS（读填写后字段），stub 返回空数组模拟读不到
      return [];
    }
  };

  const result = await fillTencentResume(
    {
      basic: { name: '张三', email: 'z@example.com' }
    },
    {
      workspace,
      taskId: 'task-resume-1',
      company: {
        id: 'tencent',
        name: '腾讯',
        portal: 'https://careers.tencent.com/'
      }
    }
  );

  assert.equal(opened[0].mode, 'resume-review');
  assert.equal(opened[0].context.taskId, 'task-resume-1');
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
      taskId: 'task-apply-1',
      company: {
        id: 'tencent',
        name: '腾讯',
        portal: 'https://careers.tencent.com/'
      }
    }
  );

  assert.equal(opened[0].mode, 'application-review');
  assert.equal(opened[0].context.jobId, 'tencent-123');
  assert.equal(opened[0].context.taskId, 'task-apply-1');
  assert.equal(result.status, 'review-required');
  assert.equal(result.ok, true);
});

test('planTencentResumePatch 生成 fill/skip/manual 三类差异', () => {
  const resume = {
    basic: { name: '张三', email: 'zhang@example.com', city: '杭州', gender: '男' },
    intention: { roles: '前端工程师' }
  };
  // 模拟远端读到的字段：姓名已有值（skip）、邮箱为空（fill）、没有城市字段（manual）、性别是 select 且选项不含「男」（manual）
  const inspection = {
    fields: [
      { index: 0, label: '姓名', type: 'input:text', value: '张三', name: 'name', id: 'name', placeholder: '', options: null },
      { index: 1, label: '邮箱', type: 'input:email', value: '', name: 'email', id: 'email', placeholder: '请输入邮箱', options: null },
      { index: 2, label: '性别', type: 'select', value: '', name: 'gender', id: 'gender', placeholder: '', options: ['女', '其他'] }
    ]
  };
  const { patches, summary } = planTencentResumePatch(resume, inspection);
  const byKey = Object.fromEntries(patches.map((p) => [p.key, p]));
  // 姓名：本地张三 = 远端张三 → skip
  assert.equal(byKey['basic.name'].action, 'skip');
  // 邮箱：本地有值，远端空 → fill
  assert.equal(byKey['basic.email'].action, 'fill');
  assert.equal(byKey['basic.email'].matchedField, '邮箱');
  // 城市：远端无此字段 → manual
  assert.equal(byKey['basic.city'].action, 'manual');
  // 性别：select 选项不含「男」→ manual
  assert.equal(byKey['basic.gender'].action, 'manual');
  assert.match(byKey['basic.gender'].risk, /下拉框/);
  // 汇总计数正确：name=skip, email=fill, city=manual, gender=manual, intention.roles=manual（远端无此字段）
  assert.equal(summary.fill, 1);
  assert.equal(summary.skip, 1);
  assert.equal(summary.manual, 3);
});

test('planTencentResumePatch 无远端字段时全部 manual', () => {
  const resume = { basic: { name: '张三' } };
  const { patches, summary } = planTencentResumePatch(resume, { fields: [] });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].action, 'manual');
  assert.equal(summary.manual, 1);
  assert.equal(summary.fill, 0);
});

test('planTencentResumePatch 标注覆盖风险（远端有值且与本地不同）', () => {
  const resume = { basic: { name: '李四' } };
  const inspection = { fields: [{ index: 0, label: '姓名', type: 'input:text', value: '张三', options: null }] };
  const { patches } = planTencentResumePatch(resume, inspection);
  assert.equal(patches[0].action, 'fill');
  assert.match(patches[0].risk, /覆盖/);
  assert.equal(patches[0].remoteValue, '张三');
  assert.equal(patches[0].localValue, '李四');
});
