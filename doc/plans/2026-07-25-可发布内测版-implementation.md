# 可发布内测版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前开发版升级为可公开下载的 macOS 内测版，补齐隐私告知、备份恢复、Agent 幂等审计、版本一致性、发布物与线上下载链路。

**Architecture:** 本地数据能力拆到纯函数模块并先做单元测试；Electron 主进程只负责文件对话框与 IPC。Agent API 在执行命令前用持久化幂等记录占位，执行后写结果和脱敏审计；发布版本由 `package.json`、应用界面、介绍页缓存版本和 GitHub Release 同步维护。

**Tech Stack:** Electron 43、Node.js 内置测试运行器、JSON 原子存储、GitHub Actions/Pages/Release、electron-builder。

---

### Task 1: 安全备份与恢复模型

**Files:**
- Create: `electron/backup.cjs`
- Create: `test/backup.test.cjs`
- Modify: `electron/store.cjs`

- [ ] **Step 1: 写失败测试**

```js
test('备份排除 Token 和邮箱授权码，恢复保留本机密钥', () => {
  const backup = createBackup(source, '0.2.0');
  assert.equal(backup.data.settings.apiToken, undefined);
  assert.equal(backup.data.settings.email.encryptedCode, undefined);
  const restored = restoreBackup(current, backup);
  assert.equal(restored.settings.apiToken, current.settings.apiToken);
  assert.equal(restored.settings.email.encryptedCode, current.settings.email.encryptedCode);
  assert.equal(restored.resume.basic.name, source.resume.basic.name);
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `node --test test/backup.test.cjs`

Expected: FAIL，提示找不到 `electron/backup.cjs`。

- [ ] **Step 3: 实现备份信封**

```js
function createBackup(state, appVersion) {
  const data = structuredClone(state);
  delete data.settings.apiToken;
  delete data.settings.email.encryptedCode;
  delete data.idempotency;
  return {
    format: 'yijian-toudi-backup',
    formatVersion: 1,
    appVersion,
    createdAt: new Date().toISOString(),
    data
  };
}
```

`restoreBackup()` 验证格式、版本和必要对象，只恢复 `resume/jobs/messages/cart/applied/tasks/settings.jobs` 等用户数据；`apiToken`、邮箱加密授权码和浏览器 session 保留当前机器值。

- [ ] **Step 4: 为迁移补齐字段**

`JsonStore.migrate()` 确保旧用户拥有：

```js
state.meta.privacyAcceptedAt ??= null;
state.audit ??= [];
state.idempotency ??= {};
```

- [ ] **Step 5: 运行测试**

Run: `pnpm test`

Expected: 全部通过。

### Task 2: 隐私告知与备份恢复界面

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `test/ui-smoke.cjs`

- [ ] **Step 1: 写失败界面契约**

桌面冒烟测试断言首次向导含隐私说明，设置页含“备份数据”“恢复备份”两个按钮。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test:ui`

Expected: FAIL，提示隐私说明或备份按钮缺失。

- [ ] **Step 3: 增加备份/恢复 IPC**

主进程使用系统保存/打开对话框：

```js
ipcMain.handle('backup:export', () => exportBackup());
ipcMain.handle('backup:restore', () => restoreBackupFromFile());
```

恢复前先把当前数据写到 `恢复前自动备份-<timestamp>.json`；解析、格式或结构不正确时不修改当前状态。

- [ ] **Step 4: 更新首次向导**

首次向导明确显示：

- 简历、招聘邮件摘要和网站登录态保存在本机。
- 邮箱使用 IMAP 授权码并由系统安全存储加密。
- Agent API 只监听 `127.0.0.1`。
- 最终保存和投递由用户确认。

用户选择方向时同时写入 `meta.privacyAcceptedAt`。

- [ ] **Step 5: 运行桌面测试**

Run: `pnpm test:ui`

Expected: PASS。

### Task 3: Agent 幂等键与审计

**Files:**
- Create: `electron/agent-command.cjs`
- Create: `test/agent-command.test.cjs`
- Modify: `electron/agent-server.cjs`
- Modify: `electron/main.cjs`
- Modify: `src/app.js`

- [ ] **Step 1: 写失败测试**

```js
async function postCommand({ port, token, key, body }) {
  return fetch(`http://127.0.0.1:${port}/v1/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {})
    },
    body: JSON.stringify(body)
  });
}

async function createTestServer(onCommand = async () => ({ ok: true })) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-idempotency-'));
  const store = new JsonStore(directory);
  const state = store.init();
  const instance = new AgentServer({ store, onCommand });
  const port = await instance.start(0);
  return {
    instance,
    port,
    token: state.settings.apiToken
  };
}

test('写命令缺少 Idempotency-Key 返回 428', async () => {
  const server = await createTestServer();
  try {
    const response = await postCommand({
      ...server,
      body: { action: 'refresh_jobs' }
    });
    assert.equal(response.status, 428);
  } finally {
    await server.instance.stop();
  }
});

test('相同键和相同命令只执行一次并返回第一次结果', async () => {
  let calls = 0;
  const server = await createTestServer(async () => ({ call: ++calls }));
  try {
    const first = await postCommand({
      ...server,
      key: 'refresh-20260725-1',
      body: { action: 'refresh_jobs' }
    });
    const firstBody = await first.json();
    const second = await postCommand({
      ...server,
      key: 'refresh-20260725-1',
      body: { action: 'refresh_jobs' }
    });
    assert.equal(calls, 1);
    assert.deepEqual(await second.json(), firstBody);
  } finally {
    await server.instance.stop();
  }
});

test('相同键对应不同命令返回 409', async () => {
  const server = await createTestServer();
  try {
    await postCommand({
      ...server,
      key: 'shared-key',
      body: { action: 'refresh_jobs' }
    });
    const conflict = await postCommand({
      ...server,
      key: 'shared-key',
      body: { action: 'apply_cart' }
    });
    assert.equal(conflict.status, 409);
  } finally {
    await server.instance.stop();
  }
});

test('审计记录不包含 Token、cookie 或授权码', () => {
  const entry = createAuditEntry({
    action: 'refresh_jobs',
    source: 'agent-api',
    target: 'all',
    status: 'done',
    message: '完成'
  });
  assert.equal(JSON.stringify(entry).includes('authorizationCode'), false);
  assert.equal(JSON.stringify(entry).includes('cookie'), false);
  assert.equal(JSON.stringify(entry).includes('apiToken'), false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/agent-command.test.cjs test/core.test.cjs`

Expected: 缺少幂等控制的断言失败。

- [ ] **Step 3: 实现命令指纹与脱敏审计**

```js
function commandFingerprint(body) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex');
}

function createAuditEntry({ action, source, target, status, message }) {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action,
    source,
    target: target || null,
    status,
    message: String(message || '').slice(0, 300)
  };
}
```

- [ ] **Step 4: 接入持久化幂等记录**

`POST /v1/commands` 要求 `Idempotency-Key`。首次请求在 `state.idempotency[key]` 写入 `pending` 与指纹；完成后写状态和结果。相同键、相同指纹返回原记录且不再次调用 `onCommand`；相同键、不同指纹返回 409。

`state.audit` 只保留最近 200 条，记录动作、来源、目标、状态和脱敏消息。

- [ ] **Step 5: 更新 Agent Prompt**

Prompt 要求每个写命令生成唯一 `Idempotency-Key`，重试同一动作复用原键，新动作必须换键。

- [ ] **Step 6: 运行测试**

Run: `pnpm test && pnpm check`

Expected: 全部通过。

### Task 4: 版本与介绍页一致性

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/index.html`
- Modify: `site/index.html`
- Modify: `site/version.json`
- Modify: `README.md`
- Create: `CHANGELOG.md`
- Create: `doc/progress/2026-07-25-v0.2.0.md`

- [ ] **Step 1: 把版本统一升级为 `0.2.0`**

修改 package 元数据、应用“关于”区域、README 和变更记录。

- [ ] **Step 2: 更新介绍页真实能力**

介绍页明确区分：

- 六家公司岗位抓取已实现。
- 腾讯简历与投递为“自动准备 + 用户确认”。
- 其他公司简历/投递仍在适配。

不使用“全平台已经自动更新完成”等超出现状的表述。

- [ ] **Step 3: 递增网页缓存版本**

`site/index.html` 的 `PAGE_V` 与 `site/version.json` 的 `v` 同时从 1 改为 2，日期改为 `2026-07-25`。

- [ ] **Step 4: 运行一致性检查**

Run: `pnpm check && pnpm test:site`

Expected: PAGE_V 一致，桌面/移动端无断图和横向溢出。

### Task 5: macOS 发布物

**Files:**
- Modify: `installer/安装说明.md`
- Generate under ignored `release/`: macOS app/ZIP/DMG/SHA256

- [ ] **Step 1: 构建应用目录**

Run: `pnpm pack:mac`

Expected: `release/mac-arm64/一键投递.app` 存在并可启动。

- [ ] **Step 2: 运行打包应用冒烟测试**

用 Playwright Electron 指向打包后的可执行文件，验证主窗口、招聘项目和简历页。

- [ ] **Step 3: 生成分发包**

Run: `pnpm dist:mac`

Expected: 产出 `一键投递-0.2.0-arm64.dmg` 与 `一键投递-0.2.0-arm64.zip`。

- [ ] **Step 4: 组装带安装脚本的 ZIP**

把 `.app`、`一键安装.command`、`安装说明.md` 放进同一目录重新压缩，并生成 `.sha256`。安装说明标注未签名、安全边界与系统要求。

- [ ] **Step 5: 完整验证**

Run: `pnpm test && pnpm check && pnpm test:ui && pnpm test:site`

Expected: 全部通过。

### Task 6: GitHub 发布与线上验证

**Files:**
- Git branch and GitHub repository state

- [ ] **Step 1: 提交阶段二代码**

提交信息分别覆盖备份隐私、Agent 幂等审计、版本介绍页和发布文档。

- [ ] **Step 2: 推送当前分支并合入发布分支**

遵守项目 GitHub 管理技能，推送经验证的提交。发布前确认远端没有覆盖冲突。

- [ ] **Step 3: 创建 `v0.2.0` Release**

发布说明必须包含真实能力、人工确认边界、安装方法和校验值；上传 ZIP、DMG、安装说明与 SHA256。

- [ ] **Step 4: 验证 Pages 与下载链路**

检查 GitHub Pages 最新版本、介绍页下载按钮、Release 标签和资产名称一致。

## 阶段完成条件

- 新用户首次启动能看到隐私边界。
- 备份恢复不会覆盖本机 Token 与邮箱加密授权码，错误文件不会破坏当前数据。
- Agent 写命令具备持久化幂等与脱敏审计。
- 应用、介绍页、文档和 Release 均为 `0.2.0`。
- macOS 发布物经过构建与冒烟验证，SHA256 可复算一致。
- 线上介绍页下载按钮指向含新资产的最新 Release。
