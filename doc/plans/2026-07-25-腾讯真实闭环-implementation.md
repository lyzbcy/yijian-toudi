# 腾讯真实闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让腾讯简历填写和岗位投递在应用内的可见浏览器工作区中运行，最终保存或提交由用户确认，并准确保留购物车与投递状态。

**Architecture:** 把现有 `login-manager` 扩展为唯一的可见浏览器工作区，登录、简历和投递执行器通过依赖注入复用它。纯业务状态由独立模块管理并单元测试；适配器只负责页面探测与填表，不自行创建或销毁不可见视图。

**Tech Stack:** Electron 43 `WebContentsView`、CommonJS、Node.js 内置测试运行器、原生 HTML/CSS/JavaScript。

---

## 文件结构

- `electron/review-state.cjs`：纯函数；归一化自动化结果、决定购物车与已投递状态。
- `electron/resume-plan.cjs`：纯函数；把统一简历转换为有稳定键的腾讯填写计划。
- `electron/login-manager.cjs`：可见浏览器工作区生命周期、模式和上下文。
- `electron/adapters/tencent-fill.cjs`：在已有可见工作区中探测并填写简历。
- `electron/adapters/tencent-apply.cjs`：在已有可见工作区中打开岗位并准备投递。
- `electron/main.cjs`：动作编排、审核完成、购物车持久化和任务状态。
- `electron/preload.cjs`：暴露审核完成与取消的最小 IPC。
- `src/index.html`、`src/app.js`、`src/styles.css`：通用工作区控制条与审核提示。
- `test/review-state.test.cjs`：状态机测试。
- `test/resume-plan.test.cjs`：简历计划测试。
- `test/ui-smoke.cjs`：工作区控制条的界面契约。

### Task 1: 投递审核状态机

**Files:**
- Create: `electron/review-state.cjs`
- Create: `test/review-state.test.cjs`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { settleCart } = require('../electron/review-state.cjs');

test('只有明确提交成功的岗位移入已投递', () => {
  const cart = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const results = [
    { id: 'a', status: 'submitted', message: '成功' },
    { id: 'b', status: 'review-required', message: '待确认' },
    { id: 'c', status: 'failed', message: '失败' }
  ];
  const next = settleCart({ cart, applied: [], results, today: '2026-07-25' });
  assert.deepEqual(next.cart.map((job) => job.id), ['b', 'c']);
  assert.deepEqual(next.applied.map((job) => job.id), ['a']);
  assert.equal(next.cart[0].applyStatus, '待确认');
  assert.equal(next.cart[1].applyStatus, '失败');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec node --test test/review-state.test.cjs`

Expected: FAIL，提示找不到 `electron/review-state.cjs`。

- [ ] **Step 3: 实现最小状态机**

```js
const STATUS_LABELS = {
  queued: '等待处理',
  'login-required': '需登录',
  'review-required': '待确认',
  submitted: '已投递',
  'manual-required': '需手动完成',
  failed: '失败',
  cancelled: '已取消'
};

function settleCart({ cart, applied, results, today }) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const nextCart = [];
  const nextApplied = [...applied];
  for (const job of cart) {
    const result = byId.get(job.id) || { status: 'failed', message: '没有执行结果' };
    const snapshot = {
      ...job,
      applyStatus: STATUS_LABELS[result.status] || result.status,
      applyMessage: result.message || ''
    };
    if (result.status === 'submitted') {
      if (!nextApplied.some((item) => item.id === job.id)) {
        nextApplied.unshift({ ...snapshot, appliedAt: today });
      }
    } else {
      nextCart.push(snapshot);
    }
  }
  return { cart: nextCart, applied: nextApplied };
}

module.exports = { STATUS_LABELS, settleCart };
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm exec node --test test/review-state.test.cjs`

Expected: 1 test passed。

- [ ] **Step 5: 提交**

```bash
git add electron/review-state.cjs test/review-state.test.cjs
git commit -m "test: define application review state"
```

### Task 2: 统一简历到腾讯填写计划

**Files:**
- Create: `electron/resume-plan.cjs`
- Create: `test/resume-plan.test.cjs`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTencentResumePlan } = require('../electron/resume-plan.cjs');

test('生成有稳定键且不包含空值的腾讯简历计划', () => {
  const plan = createTencentResumePlan({
    basic: { name: '张三', phone: '', email: 'z@example.com' },
    intention: { roles: '前端工程师' },
    education: [{ school: '示例大学', major: '计算机' }]
  });
  assert.deepEqual(plan.map((item) => item.key), [
    'basic.name',
    'basic.email',
    'intention.roles',
    'education.0.school',
    'education.0.major'
  ]);
  assert.equal(plan.some((item) => item.value === ''), false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec node --test test/resume-plan.test.cjs`

Expected: FAIL，提示找不到 `electron/resume-plan.cjs`。

- [ ] **Step 3: 实现计划生成**

```js
const FIELD_RULES = [
  ['basic.name', ['姓名', 'name']],
  ['basic.phone', ['手机', '电话', 'phone', 'mobile']],
  ['basic.email', ['邮箱', 'email', 'mail']],
  ['basic.city', ['现居', '城市', 'city']],
  ['basic.wechat', ['微信', 'wechat']],
  ['intention.roles', ['期望', '意向', '岗位', 'position']],
  ['intention.salary', ['薪资', 'salary']],
  ['education.0.school', ['学校', 'school', '院校']],
  ['education.0.major', ['专业', 'major']],
  ['skills.keywords', ['技能', 'skill']],
  ['extras.summary', ['简介', '介绍', 'summary', '描述']]
];

function readPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function createTencentResumePlan(resume) {
  return FIELD_RULES.flatMap(([key, keywords]) => {
    const value = String(readPath(resume, key) || '').trim();
    return value ? [{ key, value, keywords }] : [];
  });
}

module.exports = { FIELD_RULES, createTencentResumePlan };
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm exec node --test test/resume-plan.test.cjs`

Expected: 1 test passed。

- [ ] **Step 5: 提交**

```bash
git add electron/resume-plan.cjs test/resume-plan.test.cjs
git commit -m "feat: create deterministic resume fill plan"
```

### Task 3: 把登录视图升级为通用可见工作区

**Files:**
- Modify: `electron/login-manager.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `test/ui-smoke.cjs`

- [ ] **Step 1: 为工作区控制条写失败的界面契约**

在 `test/ui-smoke.cjs` 增加：

```js
const controls = await window.locator('#workspaceBar [data-workspace-action]').count();
if (controls < 2) throw new Error(`工作区控制按钮不足：${controls}`);
```

- [ ] **Step 2: 运行界面测试并确认失败**

Run: `pnpm test:ui`

Expected: FAIL，提示工作区控制按钮不足。

- [ ] **Step 3: 扩展工作区 API**

`electron/login-manager.cjs` 对外提供：

```js
function openWorkspace({ company, url = company.portal, mode = 'browse', title = company.name, context = null }) {}
async function run(script) {}
async function snapshot() {}
async function finish() {}
function getStatus() {}
```

`getStatus()` 返回：

```js
{
  active: Boolean(currentView),
  companyId: currentCompanyId,
  mode: currentMode,
  title: currentTitle,
  url: getCurrentUrl(),
  context: currentContext
}
```

`finish()` 在销毁前返回 `{ status, snapshot }`，其中 `snapshot` 只含 URL、标题和截断后的页面文本，不含 cookie 或本地存储。

- [ ] **Step 4: 接入最小 IPC 与控制条**

`electron/preload.cjs` 暴露：

```js
workspaceStatus: () => ipcRenderer.invoke('workspace:status'),
finishWorkspace: () => ipcRenderer.invoke('workspace:finish'),
cancelWorkspace: () => ipcRenderer.invoke('workspace:cancel')
```

`src/index.html` 增加：

```html
<div class="workspace-bar hidden" id="workspaceBar">
  <span class="workspace-bar-icon">🔐</span>
  <div class="workspace-bar-text">
    <strong id="workspaceBarTitle">浏览器工作区</strong>
    <span id="workspaceBarHint"></span>
  </div>
  <button class="ghost-button" data-workspace-action="cancel" id="workspaceCancel">取消</button>
  <button class="primary-button" data-workspace-action="finish" id="workspaceFinish">完成</button>
</div>
```

登录入口改为 `mode: 'login'`；前端依据 `mode` 显示“完成登录”“完成核对”或“完成投递检查”。

- [ ] **Step 5: 运行界面测试**

Run: `pnpm test:ui`

Expected: PASS，并保留原有首屏与 41 个简历字段断言。

- [ ] **Step 6: 提交**

```bash
git add electron/login-manager.cjs electron/main.cjs electron/preload.cjs src/index.html src/app.js src/styles.css test/ui-smoke.cjs
git commit -m "feat: add visible browser review workspace"
```

### Task 4: 腾讯简历可见填写

**Files:**
- Modify: `electron/adapters/tencent-fill.cjs`
- Modify: `electron/main.cjs`
- Modify: `test/resume-plan.test.cjs`

- [ ] **Step 1: 增加字段报告测试**

```js
const { summarizeFillReport } = require('../electron/resume-plan.cjs');

test('字段报告区分已填写和需手动处理', () => {
  const report = summarizeFillReport(
    [{ key: 'basic.name' }, { key: 'basic.email' }],
    [{ key: 'basic.name', matched: true }]
  );
  assert.deepEqual(report.filled, ['basic.name']);
  assert.deepEqual(report.manual, ['basic.email']);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec node --test test/resume-plan.test.cjs`

Expected: FAIL，提示 `summarizeFillReport` 不存在。

- [ ] **Step 3: 实现报告函数并重构执行器**

`electron/adapters/tencent-fill.cjs` 改为：

```js
async function fillTencentResume(resume, { workspace, company, onStep } = {}) {
  const plan = createTencentResumePlan(resume);
  await workspace.openWorkspace({
    company,
    url: RESUME_URL,
    mode: 'resume-review',
    title: '核对腾讯简历',
    context: { action: 'fill-resume', companyId: 'tencent' }
  });
  const probe = await workspace.run(LOGIN_AND_FORM_PROBE);
  if (probe.loginRequired) return { ok: false, status: 'login-required', message: '请先登录腾讯' };
  const matches = await workspace.run(buildFillScript(plan));
  const report = summarizeFillReport(plan, matches);
  return {
    ok: true,
    status: 'review-required',
    message: `已填写 ${report.filled.length} 个字段，${report.manual.length} 个字段需手动检查`,
    report
  };
}
```

执行器不创建、销毁视图，不点击官网保存按钮。

- [ ] **Step 4: 运行单元与静态检查**

Run: `pnpm test && pnpm check`

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add electron/resume-plan.cjs electron/adapters/tencent-fill.cjs electron/main.cjs test/resume-plan.test.cjs
git commit -m "feat: keep Tencent resume fill visible for review"
```

### Task 5: 腾讯投递准备与购物车保留

**Files:**
- Modify: `electron/adapters/tencent-apply.cjs`
- Modify: `electron/main.cjs`
- Modify: `src/app.js`
- Modify: `test/review-state.test.cjs`

- [ ] **Step 1: 增加购物车部分结果测试**

```js
test('没有结果的岗位按失败保留，已有投递记录不重复', () => {
  const next = settleCart({
    cart: [{ id: 'a' }, { id: 'b' }],
    applied: [{ id: 'old' }],
    results: [{ id: 'a', status: 'submitted', message: '成功' }],
    today: '2026-07-25'
  });
  assert.deepEqual(next.cart.map((job) => job.id), ['b']);
  assert.deepEqual(next.applied.map((job) => job.id), ['a', 'old']);
});
```

- [ ] **Step 2: 运行新增回归测试**

Run: `pnpm exec node --test test/review-state.test.cjs`

Expected: PASS；该测试固定后续重构必须保留的购物车语义。

- [ ] **Step 3: 重构腾讯投递执行器**

```js
async function applyTencentJob(job, { workspace, company, onStep } = {}) {
  const detailUrl = resolveTencentJobUrl(job);
  await workspace.openWorkspace({
    company,
    url: detailUrl,
    mode: 'application-review',
    title: `核对投递：${job.title}`,
    context: { action: 'apply-job', companyId: 'tencent', jobId: job.id }
  });
  const page = await workspace.run(PAGE_PROBE);
  if (page.loginRequired) return { ok: false, status: 'login-required', message: '请先登录腾讯' };
  if (!page.applyButton) return { ok: false, status: 'manual-required', message: '未找到可靠的申请按钮' };
  await workspace.run(CLICK_APPLY_BUTTON);
  return { ok: true, status: 'review-required', message: '已打开投递流程，请核对后在官网提交' };
}
```

一次只准备一个岗位。遇到 `review-required` 时队列暂停，剩余岗位保留，用户完成当前审核后再继续。

- [ ] **Step 4: 使用状态机持久化结果**

`electron/main.cjs` 用 `settleCart()` 替代整车清空逻辑。工作区完成时检查页面是否明确包含提交成功证据；没有证据则仍为 `review-required`。

- [ ] **Step 5: 运行完整测试**

Run: `pnpm test && pnpm check && pnpm test:ui`

Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add electron/adapters/tencent-apply.cjs electron/main.cjs src/app.js test/review-state.test.cjs
git commit -m "fix: preserve cart until application is confirmed"
```

### Task 6: Agent 命令与文档一致性

**Files:**
- Modify: `electron/agent-server.cjs`
- Modify: `src/app.js`
- Modify: `README.md`
- Modify: `doc/README.md`
- Modify: `doc/progress/2026-07-25-腾讯闭环.md`
- Modify: `test/core.test.cjs`

- [ ] **Step 1: 写 Agent 审核状态测试**

在 `test/core.test.cjs` 增加命令断言：`fill_resume` 返回 `review-required` 时，HTTP 仍返回任务/审核状态而不是宣称完成。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec node --test test/core.test.cjs`

Expected: FAIL，当前响应缺少明确审核状态。

- [ ] **Step 3: 更新 API 与 Prompt**

`POST /v1/commands` 对可见浏览器动作返回：

```json
{
  "accepted": true,
  "result": {
    "status": "review-required",
    "message": "请回到一键投递完成核对"
  }
}
```

Prompt 明确“`review-required` 不等于成功，必须等待用户在应用内确认”。

- [ ] **Step 4: 更新 AI memory**

新增进度记录，写清自动测试证据、真实账号验收边界和下一阶段入口。README 不再描述六家岗位为演示数据，也不声称腾讯最终投递已经无人值守完成。

- [ ] **Step 5: 完整验证**

Run:

```bash
pnpm test
pnpm check
pnpm test:ui
pnpm preview:site
# 在另一个终端运行 pnpm test:site
```

Expected: 单元测试、静态检查、桌面和介绍页冒烟测试全部通过。

- [ ] **Step 6: 提交**

```bash
git add electron/agent-server.cjs src/app.js README.md doc/README.md doc/progress/2026-07-25-腾讯闭环.md test/core.test.cjs
git commit -m "docs: record Tencent review-gated workflow"
```

## 阶段完成条件

- 自动填简历和投递页面在应用内可见。
- 执行器不销毁用户需要审核的页面。
- 软件不点击最终保存或提交。
- 只有明确成功的岗位进入已投递，其余保留在购物车。
- Agent 能识别并报告 `review-required`。
- 所有自动化验证通过，真实账号验证停在最终外部写入之前。
