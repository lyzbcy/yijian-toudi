# 内嵌投递安全退出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让腾讯投递继续在应用内嵌运行，同时保证顶部退出栏始终可见，并在 404 或异常时自动回到「一键投递」。

**Architecture:** `login-manager.cjs` 负责原生网页的生命周期和边界；腾讯适配器只识别页面并返回业务状态；`main.cjs` 在跨模块异常处做最终清理。界面顶部控制栏与原生网页使用同一个高度常量语义，并通过单元测试和 Electron 真实页面测试保护。

**Tech Stack:** Electron 43 `WebContentsView`、CommonJS、Node.js 内置测试运行器、Playwright Electron。

---

### Task 1: 腾讯 404 和链接回归保护

**Files:**
- Modify: `test/tencent-workflow.test.cjs`
- Modify: `electron/adapters/tencent-apply.cjs`

- [ ] **Step 1: 写入会在旧实现上失败的测试**

在 `test/tencent-workflow.test.cjs` 中导入 `resolveTencentJobUrl`，并加入：

```js
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
    { id: 'tencent-404', title: '已下线岗位', url: 'https://careers.tencent.com/jobdesc.html?postId=404' },
    { workspace, company: { id: 'tencent', name: '腾讯' } }
  );
  assert.equal(result.status, 'failed');
  assert.equal(closed, 1);
});
```

- [ ] **Step 2: 在未修复基线上验证测试确实能抓到故障**

把新增测试放入由当前 `HEAD` 导出的临时副本后运行：

```bash
node --test test/tencent-workflow.test.cjs
```

Expected: `http` 链接仍为 `http`，或 404 后关闭次数为 `0`，测试失败。

- [ ] **Step 3: 保留通过测试所需的最小实现**

`resolveTencentJobUrl` 将可信的腾讯 `http` 链接改为 `https`。`applyTencentJob` 发现 `page.isNotFound` 后先执行 `await workspace.closeWorkspaceIfOpen()`，再返回 `failed`。

- [ ] **Step 4: 验证专项测试通过**

Run:

```bash
node --test test/tencent-workflow.test.cjs
```

Expected: 全部通过。

### Task 2: 顶部安全区与全链路兜底

**Files:**
- Create: `electron/workspace-layout.cjs`
- Create: `test/workspace-layout.test.cjs`
- Modify: `electron/login-manager.cjs`
- Modify: `electron/main.cjs`
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`

- [ ] **Step 1: 写边界计算失败测试**

创建 `test/workspace-layout.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { TOP_BAR_HEIGHT, calculateWorkspaceBounds } = require('../electron/workspace-layout.cjs');

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
```

- [ ] **Step 2: 运行并确认模块缺失**

Run:

```bash
node --test test/workspace-layout.test.cjs
```

Expected: FAIL，提示找不到 `electron/workspace-layout.cjs`。

- [ ] **Step 3: 实现纯边界模块并接入原生视图**

创建：

```js
const TOP_BAR_HEIGHT = 52;

function calculateWorkspaceBounds(contentWidth, contentHeight) {
  return {
    x: 0,
    y: TOP_BAR_HEIGHT,
    width: Math.max(0, contentWidth),
    height: Math.max(0, contentHeight - TOP_BAR_HEIGHT)
  };
}

module.exports = { TOP_BAR_HEIGHT, calculateWorkspaceBounds };
```

`login-manager.cjs` 使用 `parentWindow.getContentSize()` 和 `calculateWorkspaceBounds`；监听 `resize`、`maximize`、`unmaximize`、`enter-full-screen`、`leave-full-screen`。新增幂等的 `closeWorkspaceIfOpen()` 并导出。

- [ ] **Step 4: 对齐顶部控制栏**

`src/index.html` 把 `.workspace-bar` 移到会被隐藏的 `.main` 容器之外；`src/styles.css` 把它固定在顶部，高度为 `52px`；`src/app.js` 在工作区激活时始终移除控制栏的 `hidden` 类，并让更新检查异步执行以免阻塞关键按钮的事件绑定。`main.cjs` 在适配器抛错、`failed` 结果和非人工接管失败状态下调用 `closeWorkspaceIfOpen()`。

- [ ] **Step 5: 运行单元测试**

Run:

```bash
node --test test/workspace-layout.test.cjs test/tencent-workflow.test.cjs
```

Expected: 全部通过。

### Task 3: Electron 真实退出验收

**Files:**
- Create: `test/ui-workspace-exit.cjs`
- Modify: `package.json`
- Modify: `doc/progress/2026-07-25-腾讯闭环深化与复查修复.md`

- [ ] **Step 1: 编写真实交互测试**

测试启动临时 Electron profile，关闭首启引导，调用 `window.oneClick.openLogin('tencent')`，断言：

```js
await window.waitForSelector('body.workspace-active #workspaceBar:not(.hidden)');
const box = await window.locator('#workspaceBar').boundingBox();
assert.equal(Math.round(box.y), 0);
assert.equal(Math.round(box.height), 52);
await window.locator('#workspaceCancel').click();
await window.waitForSelector('body:not(.workspace-active) .main');
assert.equal((await window.evaluate(() => window.oneClick.workspaceStatus())).active, false);
```

- [ ] **Step 2: 加入测试入口并运行**

在 `package.json` 增加：

```json
"test:ui:workspace": "node test/ui-workspace-exit.cjs"
```

Run:

```bash
pnpm test:ui:workspace
```

Expected: 输出 `{ "ok": true }`，退出码为 0。

- [ ] **Step 3: 运行完整验证**

Run:

```bash
pnpm test
pnpm test:ui
pnpm test:ui:workspace
pnpm check
```

Expected: 所有命令退出码为 0，无新增错误或警告。

- [ ] **Step 4: 更新进度记录**

在 `doc/progress/2026-07-25-腾讯闭环深化与复查修复.md` 记录根因、修复范围、自动测试结果和真实界面截图位置；明确 404 会回到购物车、登录或核对状态会保留内嵌页。
