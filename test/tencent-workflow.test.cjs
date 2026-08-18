const test = require('node:test');
const assert = require('node:assert/strict');
const { fillTencentResume, planTencentResumePatch, resolveResumeUrl } = require('../electron/adapters/tencent-fill.cjs');
const { applyTencentJob, resolveTencentJobUrl } = require('../electron/adapters/tencent-apply.cjs');

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
        return { loginRequired: false, isNotFound: false, inputCount: 2 };
      }
      if (scripts.length === 3) {
        return [
          { index: 0, label: '姓名', placeholder: '请输入姓名', name: 'name', id: 'name', type: 'input:text', value: '' },
          { index: 1, label: '联系邮箱', placeholder: '请输入联系邮箱', name: 'email', id: 'email', type: 'input:email', value: '' }
        ];
      }
      if (scripts.length === 4) {
        return [
          { key: 'basic.name', fieldIndex: 0, locator: { kind: 'id', value: 'name' }, expected: '张三', observed: '张三', written: true },
          { key: 'basic.email', fieldIndex: 1, locator: { kind: 'id', value: 'email' }, expected: 'z@example.com', observed: '错误值', written: true }
        ];
      }
      return [
        { index: 0, id: 'name', name: 'name', value: '张三' },
        { index: 1, id: 'email', name: 'email', value: '错误值' }
      ];
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

test('腾讯岗位投递只打开详情页，绝不自动点击申请按钮', async () => {
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
      throw new Error('不应执行第二段点击脚本');
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
  assert.equal(result.status, 'manual-required');
  assert.equal(result.ok, true);
  assert.equal(scripts.length, 1);
  assert.match(result.message, /不会触发/);
});

test('腾讯 http 岗位链接升级为 https', () => {
  assert.equal(
    resolveTencentJobUrl({ url: 'http://careers.tencent.com/jobdesc.html?postId=123' }),
    'https://careers.tencent.com/jobdesc.html?postId=123'
  );
});

test('腾讯岗位 404 时关闭工作区并返回失败', async () => {
  let closed = 0;
  const workspace = {
    async openWorkspace() {},
    async run() {
      return { isNotFound: true, loginRequired: false, applyButton: null };
    },
    async closeWorkspaceIfOpen() {
      closed += 1;
    }
  };

  const result = await applyTencentJob(
    {
      id: 'tencent-404',
      companyId: 'tencent',
      title: '已下线岗位',
      url: 'https://careers.tencent.com/jobdesc.html?postId=404'
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

  assert.equal(result.status, 'failed');
  assert.equal(result.ok, false);
  assert.equal(closed, 1);
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
  // 用 campus 全量模式（含 gender/roles），验证 patch 的 fill/skip/manual 三态逻辑
  const { patches, summary } = planTencentResumePatch(resume, inspection, { recruitType: 'campus' });
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

// 社招/校招简历页路由：2026-07-26 录制实测后接入。社招走 careers.tencent.com，
// 校招走独立域名 join.qq.com（其「提交简历」会真实投递职位）。
test('resolveResumeUrl 社招/校招选对不同域名的简历页', () => {
  assert.equal(resolveResumeUrl('social'), 'https://careers.tencent.com/resume.html?operType=1');
  assert.equal(resolveResumeUrl('campus'), 'https://join.qq.com/resume.html');
  // summer-intern / daily-intern 也归为校招方向
  assert.equal(resolveResumeUrl('summer-intern'), 'https://join.qq.com/resume.html');
  assert.equal(resolveResumeUrl('daily-intern'), 'https://join.qq.com/resume.html');
  // 缺省为社招（保住旧调用方不传 recruitType 时的行为）
  assert.equal(resolveResumeUrl(undefined), 'https://careers.tencent.com/resume.html?operType=1');
});

test('腾讯校招简历填写打开 join.qq.com 并带 applyRisk 警示', async () => {
  const opened = [];
  const scripts = [];
  const workspace = {
    async openWorkspace(options) { opened.push(options); },
    async run(script) {
      scripts.push(script);
      if (scripts.length === 1) {
        return { loginRequired: false, isNotFound: false, inputCount: 2 };
      }
      if (scripts.length === 2) {
        return { loginRequired: false, isNotFound: false, inputCount: 2 };
      }
      if (scripts.length === 3) {
        return [{ key: 'basic.name', matched: true }];
      }
      return [];
    }
  };

  const result = await fillTencentResume(
    { basic: { name: '张三' } },
    {
      workspace,
      company: { id: 'tencent', name: '腾讯', portal: 'https://careers.tencent.com/' },
      recruitType: 'campus'
    }
  );

  // 必须打开校招域名，而不是社招 careers.tencent.com
  assert.match(opened[0].url, /^https:\/\/join\.qq\.com\//);
  assert.match(opened[0].title, /校招/);
  assert.equal(opened[0].context.recruitType, 'campus');
  assert.equal(result.status, 'review-required');
  // 校招「提交简历」=真实投递，必须带 applyRisk 让调用方/前端识别风险
  assert.equal(result.applyRisk, 'submit-means-apply');
  assert.match(result.message, /提交简历/);
});

test('腾讯社招简历填写（默认 recruitType）仍走 careers.tencent.com 且无 applyRisk', async () => {
  const opened = [];
  const scripts = [];
  const workspace = {
    async openWorkspace(options) { opened.push(options); },
    async run(script) {
      scripts.push(script);
      if (scripts.length === 1) return { loginRequired: false, isNotFound: false, inputCount: 2 };
      if (scripts.length === 2) return { loginRequired: false, isNotFound: false, inputCount: 2 };
      if (scripts.length === 3) return [{ key: 'basic.name', matched: true }];
      return [];
    }
  };

  const result = await fillTencentResume(
    { basic: { name: '张三' } },
    {
      workspace,
      company: { id: 'tencent', name: '腾讯', portal: 'https://careers.tencent.com/' }
      // 故意不传 recruitType，验证默认 social 行为不回归
    }
  );

  assert.match(opened[0].url, /^https:\/\/careers\.tencent\.com\//);
  assert.equal(result.applyRisk, undefined);
});

test('腾讯没有任何字段通过延迟回读时不得返回 ok:true', async () => {
  let calls = 0;
  const workspace = {
    async openWorkspace() {},
    async run() {
      calls += 1;
      if (calls === 1) return { loginRequired: false, isNotFound: false, inputCount: 1 };
      if (calls === 2) return { loginRequired: false, isNotFound: false, inputCount: 1 };
      if (calls === 3) return [{ index: 0, id: 'name', name: 'name', label: '姓名', type: 'input:text', value: '' }];
      if (calls === 4) return [{ key: 'basic.name', fieldIndex: 0, locator: { kind: 'id', value: 'name' }, expected: '张三', observed: '张三', written: true }];
      return [{ index: 0, id: 'name', name: 'name', value: '旧值' }];
    }
  };
  const result = await fillTencentResume(
    { basic: { name: '张三' } },
    { workspace, company: { id: 'tencent', name: '腾讯' } }
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.report.filled, []);
});
