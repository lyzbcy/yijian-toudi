# 一键更新连续编排与双平台发行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复简历同步在每个暂停点后不能自动继续的问题，完成真实站点保存回读验收，并建立从同一版本构建 macOS 与 Windows 安装包的可验证发行链路。

**Architecture:** 主进程 `ResumeSyncSession` 继续维护唯一同步游标，渲染层用一个统一阶段执行函数吸收每次结果；顶部“完成”根据主进程返回的 `continueCompanyId` 自动重试当前登录目标或进入下一目标。发行继续使用 Electron/electron-builder，在 macOS 与 Windows 原生 GitHub Actions runner 上分别构建，最后由独立 release job 汇聚产物与 SHA256。

**Tech Stack:** Electron 43、CommonJS、Node.js test runner、Playwright Electron、electron-builder、GitHub Actions、NSIS。

---

## 文件结构

- `src/app.js`：新增渲染层同步阶段执行/结果吸收函数，顶部完成事件自动驱动下一阶段并防止重复点击。
- `src/resume-sync-flow.js`、`test/resume-sync-flow.test.cjs`：可同时在浏览器和 Node 中运行的纯状态决策，确定性覆盖登录重试、核对推进、完成汇总和 workspace-active 保持。
- `electron/resume-sync.cjs`、`electron/main.cjs`：仅当批量会话确实有当前 pending 目标时，顶部完成才返回批量续跑决策。
- `test/ui-resume-sync-all.cjs`：从真实界面按钮启动同步，验证完成后自动重试当前登录目标或推进下一目标。
- `test/ui-resume-sync-cancel.cjs`：验证取消不会自动推进且游标停在当前目标。
- `package.json`：登记新的 UI 回归、Windows 打包和发行验证脚本。
- `test/release-config.test.cjs`：用测试固定双平台构建配置、脚本和工作流安全边界。
- `.github/workflows/release.yml`：macOS/Windows 原生测试、打包、校验与 Release 汇聚。
- `installer/Windows安装说明.md`：Windows 安装、数据边界和内测限制。
- `scripts/verify-artifacts.cjs`：跨平台校验发行目录中必需产物、命名和 SHA256 文件。
- `electron/update-assets.cjs`：按下载文件名精确选择 SHA256 sidecar，并在缺失或不匹配时拒绝安装。
- `test/update-assets.test.cjs`：覆盖多产物 Release 下的更新资产与摘要精确匹配。
- `build/icon.ico`：由现有正式图标生成的 Windows 多尺寸图标。
- `doc/progress/2026-08-18-一键更新连续编排与双平台发行.md`：记录自动化、真站和双平台产物的事实证据。
- `doc/未决问题.md`、`doc/README.md`、`README.md`：同步能力、版本和发行边界的最终口径。

### Task 1: 连续同步端到端回归先行

**Files:**
- Modify: `test/ui-resume-sync-all.cjs`
- Create: `test/ui-resume-sync-cancel.cjs`
- Create: `test/resume-sync-flow.test.cjs`
- Modify: `package.json`

- [ ] **Step 1: 先为纯状态决策写确定性失败测试**

`test/resume-sync-flow.test.cjs` 要求 `decideResumeSyncContinuation` 覆盖：同目标登录重试、下一目标推进、队列完成停止；`mergeResumeSyncStage` 覆盖 `workspace-active` 不清空既有暂停元数据；`summarizeResumeSyncRun` 覆盖已核验/需人工/失败计数。

```js
assert.deepEqual(decideResumeSyncContinuation({
  resumeSyncDecision: 'advance',
  session: { completed: false, continueCompanyId: 'tencent:social' }
}), { type: 'continue', companyId: 'tencent:social' });

assert.deepEqual(decideResumeSyncContinuation({
  resumeSyncDecision: 'advance',
  session: { completed: true, continueCompanyId: null }
}), { type: 'complete' });
```

- [ ] **Step 2: 运行纯状态测试并确认模块缺失导致失败**

Run: `node --test test/resume-sync-flow.test.cjs`

Expected: FAIL，原因是 `src/resume-sync-flow.js` 尚未创建。

- [ ] **Step 3: 把现有 UI 测试改为从真实按钮启动并断言自动继续**

将 `test/ui-resume-sync-all.cjs` 的底层直调替换为真实界面操作，关键逻辑如下：

```js
await window.locator('[data-page="resume"]').click();
await window.locator('#fillResumeAllButton').click();
await window.waitForFunction(async () => (await window.oneClick.workspaceStatus()).active, null, { timeout: 20_000 });

const firstWorkspace = await window.evaluate(() => window.oneClick.workspaceStatus());
assert.equal(firstWorkspace.context.syncTargetId, 'tencent:social');
const expectedNext = firstWorkspace.mode === 'login' ? 'tencent:social' : 'tencent:campus';

await window.locator('#workspaceFinish').click();
await window.waitForFunction(async (target) => {
  const status = await window.oneClick.workspaceStatus();
  return status.active && status.context?.syncTargetId === target;
}, expectedNext, { timeout: 20_000 });
```

测试必须通过按钮启动，不能再用 `window.oneClick.fillResumeToAll(null)` 绕过渲染层。

- [ ] **Step 4: 运行 UI 回归并确认以正确原因失败**

Run:

```bash
pnpm test:ui:sync-all
```

Expected: FAIL/timeout；点击顶部“完成”后没有出现 `expectedNext` 工作区，证明缺失的是渲染层自动续跑，而不是选择器错误。

- [ ] **Step 5: 新增取消不续跑的端到端测试**

创建 `test/ui-resume-sync-cancel.cjs`：启动“一键更新”，记录当前 `syncTargetId`，点击 `#workspaceCancel`，等待工作区关闭，再等待 1 秒并断言仍为关闭状态；随后重新点击“一键更新”，断言打开的仍是原 `syncTargetId`。

```js
const before = await window.evaluate(() => window.oneClick.workspaceStatus());
await window.locator('#workspaceCancel').click();
await window.waitForFunction(async () => !(await window.oneClick.workspaceStatus()).active);
await window.waitForTimeout(1000);
assert.equal((await window.evaluate(() => window.oneClick.workspaceStatus())).active, false);
await window.locator('#fillResumeAllButton').click();
await window.waitForFunction(async (target) => {
  const status = await window.oneClick.workspaceStatus();
  return status.active && status.context?.syncTargetId === target;
}, before.context.syncTargetId);
```

- [ ] **Step 6: 为取消测试登记脚本并确认测试自身可运行**

在 `package.json` 增加：

```json
"test:ui:sync-cancel": "node test/ui-resume-sync-cancel.cjs"
```

Run: `pnpm test:ui:sync-cancel`

Expected: PASS，因为现有取消逻辑本来就不应自动推进；这同时建立后续修复的回归护栏。

- [ ] **Step 7: 精确提交测试基线**

```bash
git add test/resume-sync-flow.test.cjs test/ui-resume-sync-all.cjs test/ui-resume-sync-cancel.cjs package.json
git commit -m "test: 覆盖简历同步自动续跑与取消"
```

### Task 2: 渲染层自动续跑状态机

**Files:**
- Create: `src/resume-sync-flow.js`
- Modify: `src/index.html`
- Modify: `src/app.js`
- Modify: `electron/preload.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/resume-sync.cjs`
- Test: `test/resume-sync-flow.test.cjs`
- Test: `test/resume-sync.test.cjs`
- Test: `test/ui-resume-sync-all.cjs`
- Test: `test/ui-resume-sync-cancel.cjs`

- [ ] **Step 1: 实现浏览器/Node 共用的纯状态模块**

`src/resume-sync-flow.js` 使用 UMD 包装：浏览器挂到 `window.ResumeSyncFlow`，Node 导出 CommonJS。实现 `decideResumeSyncContinuation`、`mergeResumeSyncStage` 和 `summarizeResumeSyncRun`；`src/index.html` 在 `app.js` 前加载它。该模块不访问 DOM、不发 IPC、不点击网页控件。

- [ ] **Step 2: 抽取同步结果吸收函数**

在同步状态变量之后增加：

```js
let resumeSyncTransitioning = false;
let resumeSyncGeneration = 0;

function absorbResumeSyncResult(result = {}) {
  const merged = window.ResumeSyncFlow.mergeResumeSyncStage({
    pausedCompanyId: resumeSyncPausedCompanyId,
    nextCompanyId: resumeSyncNextCompanyId,
    pauseStatus: resumeSyncPauseStatus,
    atEnd: resumeSyncAtEnd
  }, result);
  if (!merged.changed) return result;
  for (const entry of result.results || []) resumeSyncRunResults.set(entry.companyId, entry);
  resumeSyncPausedCompanyId = merged.pausedCompanyId;
  resumeSyncNextCompanyId = merged.nextCompanyId;
  resumeSyncPauseStatus = merged.pauseStatus;
  resumeSyncAtEnd = merged.atEnd;
  if (result.session?.completed || result.completed) {
    resumeSyncRunFinished = true;
    resumeSyncContinueCompanyId = null;
  }
  return result;
}

async function runResumeSyncStage(startCompanyId = resumeSyncContinueCompanyId, generation = resumeSyncGeneration) {
  const result = await window.oneClick.fillResumeToAll(startCompanyId, generation);
  if (generation !== resumeSyncGeneration) return { ...result, ignored: true };
  return absorbResumeSyncResult(result);
}
```

- [ ] **Step 3: 让初次按钮和续跑共用同一函数**

将一键更新按钮内重复的结果状态赋值替换为：

```js
if (resumeSyncRunFinished) {
  resumeSyncRunResults.clear();
  resumeSyncRunFinished = false;
  resumeSyncContinueCompanyId = null;
}
return runResumeSyncStage(resumeSyncContinueCompanyId);
```

- [ ] **Step 4: 顶部完成事件按纯决策自动执行下一游标并展示最终汇总**

把简历同步分支改为使用 `result.session.continueCompanyId`，并在未完成时立即调用 `runResumeSyncStage`：

```js
if (result.resumeSyncDecision === 'advance') {
  const decision = window.ResumeSyncFlow.decideResumeSyncContinuation(result);
  if (decision.type === 'continue') {
    resumeSyncContinueCompanyId = decision.companyId;
    const next = await runResumeSyncStage(resumeSyncContinueCompanyId, generation);
    if (next.ignored) return;
    if (next.session?.completed || next.completed) {
      resumeSyncRunFinished = true;
      const summary = window.ResumeSyncFlow.summarizeResumeSyncRun([...resumeSyncRunResults.values()]);
      toast(`本轮完成：已核验 ${summary.verified}，需人工 ${summary.needsUser}，失败 ${summary.failed}`);
      return;
    }
    toast(next.message || '已自动进入下一项，请继续登录或核对');
    return;
  }
  if (decision.type === 'complete') {
    resumeSyncRunFinished = true;
    const summary = window.ResumeSyncFlow.summarizeResumeSyncRun([...resumeSyncRunResults.values()]);
    toast(`本轮完成：已核验 ${summary.verified}，需人工 ${summary.needsUser}，失败 ${summary.failed}`);
    return;
  }
}
```

登录暂停完成后主进程会返回同一个目标；核对/手动暂停完成后会返回下一目标。渲染层不得自行推算公司顺序。

- [ ] **Step 5: 用代际令牌解决双击和取消竞态**

在 `#workspaceFinish` 处理器入口/出口使用 `resumeSyncTransitioning` 和按钮禁用：

```js
if (resumeSyncTransitioning) return;
resumeSyncTransitioning = true;
const generation = ++resumeSyncGeneration;
$('#workspaceFinish').disabled = true;
try {
  const result = await window.oneClick.finishWorkspace();
  if (generation !== resumeSyncGeneration) return;
  // 决策 + 自动续跑
} finally {
  resumeSyncTransitioning = false;
  $('#workspaceFinish').disabled = false;
}
```

取消按钮始终可用；其处理器保存被取消的 generation，先执行 `resumeSyncGeneration += 1` 使任何迟到的完成/填写响应失效，再调用 `cancelWorkspace({ resumeSyncGeneration: cancelledGeneration })`。重复完成被 `resumeSyncTransitioning` 拒绝，但取消不会被锁住。

generation 还必须跨 preload 传到主进程：主进程把每个批量同步工作区标记为所属 generation，维护已取消 generation 集合，并让 `runResumeSync` 在每家公司开始前、adapter 返回/抛错后、接受阶段结果前检查 `shouldAbort`。取消到达时只关闭同 generation 工作区；即使取消发生在 `loadURL` 途中，同步循环也必须在打开下一家公司前中止。迟到的旧 generation 不得写入 `ResumeSyncSession`、不得覆盖新工作区，并返回 `status:'cancelled'`。增加一个确定性测试：延迟第一个 adapter，其间取消，随后释放旧 Promise，断言结果未被 session 吸收、第二个 adapter 从未调用、工作区保持关闭、不会自动继续；再启动新 generation，断言旧取消不会关闭新工作区。

- [ ] **Step 6: 后端只对真实 pending 批量目标返回续跑决策**

先在 `test/resume-sync.test.cjs` 增加红测试：有 pending 且目标相同返回 true、目标不同返回 false、尚未接受阶段返回 false；运行确认因 `hasPending` 不存在而失败。随后在 `ResumeSyncSession` 增加：

```js
hasPending(companyId) {
  return this.pending?.companyId === companyId;
}
```

`workspace:finish` 和 `workspace:cancel` 只有在 `resumeSyncSession?.hasPending(syncTargetId)` 为真时调用 `finish/cancel` 并返回 `resumeSyncDecision`；独立“更新腾讯简历”完成后只关闭当前页，不得意外启动整批队列。

- [ ] **Step 7: 运行目标回归至绿色**

Run:

```bash
pnpm test:ui:sync-all
pnpm test:ui:sync-cancel
```

Expected: 两项均 PASS；登录分支重试当前目标，核对分支进入下一目标，取消分支保持关闭。

- [ ] **Step 8: 运行状态机单元测试与静态检查**

Run:

```bash
node --test test/resume-sync.test.cjs
node --test test/resume-sync-flow.test.cjs
pnpm check
```

Expected: 全部 PASS，且没有语法错误。

- [ ] **Step 9: 精确提交实现**

```bash
git add src/resume-sync-flow.js src/index.html src/app.js electron/preload.cjs electron/resume-sync.cjs electron/main.cjs test/resume-sync-flow.test.cjs test/resume-sync.test.cjs
git commit -m "fix: 一键更新完成后自动继续下一目标"
```

### Task 3: 双平台发行配置测试先行

**Files:**
- Create: `test/release-config.test.cjs`
- Create: `scripts/run-ui-tests.cjs`
- Create: `scripts/build-release.cjs`
- Create: `test/build-release.test.cjs`
- Create: `scripts/smoke-packaged.cjs`
- Create: `scripts/smoke-windows.ps1`
- Create: `.node-version`
- Modify: `package.json`
- Create: `.github/workflows/release.yml`
- Create: `installer/Windows安装说明.md`

- [ ] **Step 1: 写发行配置失败测试**

创建 `test/release-config.test.cjs`，断言：

```js
test('发行脚本同时声明 macOS 与 Windows 原生构建', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts['dist:mac'], 'node scripts/build-release.cjs mac');
  assert.equal(pkg.scripts['dist:win'], 'node scripts/build-release.cjs win');
  assert.match(pkg.engines.node, />=22\.12/);
  assert.deepEqual(pkg.build.mac.target, ['dir', 'dmg']);
  assert.equal(pkg.build.win.target, 'nsis');
  assert.match(pkg.build.mac.artifactName, /macOS-arm64/);
  assert.match(pkg.build.win.artifactName, /windows-x64/);
});

test('发行工作流在原生 runner 构建并由独立 job 汇聚', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const parsed = YAML.parse(workflow);
  assert.equal(parsed.on.pull_request_target, undefined);
  assert.equal(parsed.jobs.build.permissions.contents, 'read');
  assert.equal(parsed.jobs.release.permissions.contents, 'write');
  assert.deepEqual(parsed.jobs.release.needs, ['build']);
  assert.match(JSON.stringify(parsed.jobs.build), /pnpm dist:mac/);
  assert.match(JSON.stringify(parsed.jobs.build), /pnpm dist:win/);
  assert.match(JSON.stringify(parsed.jobs.release), /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/);
});
```

- [ ] **Step 2: 运行并确认缺失配置导致失败**

Run: `node --test test/release-config.test.cjs`

Expected: FAIL，明确指出 `dist:win` 或 `release.yml` 不存在。

- [ ] **Step 3: 增加 Windows 构建与完整 UI 回归脚本**

先把 `yaml` 2.x 作为固定的 devDependency 加入并更新 `pnpm-lock.yaml`，供测试真正解析工作流结构；不能只用正则匹配注释。在 `package.json` 增加：

```json
"test:ui:all": "node scripts/run-ui-tests.cjs",
"dist:mac": "node scripts/build-release.cjs mac",
"dist:win": "node scripts/build-release.cjs win",
"verify:artifacts": "node scripts/verify-artifacts.cjs"
```

创建 `scripts/run-ui-tests.cjs`，按顺序运行 `ui-smoke`、`ui-resume-segments`、`ui-resume-profiles`、`ui-capabilities`、`ui-workspace-exit`、`ui-resume-sync-all`、`ui-resume-sync-cancel`；任一非零立即退出，并给每项 90 秒超时，避免并发 Electron 互相污染。

- [ ] **Step 4: 新增原生双平台发行工作流**

先为 `scripts/build-release.cjs` 写参数/命令计划测试：mac 必须只生成 `dir + dmg + arm64` 后调用自定义 ZIP 组装，win 必须生成 `nsis + x64`；输出目录固定为全新的 `out/v<version>/mac|win`，不读取或上传旧 `release/`。再实现脚本并让测试转绿。

`.github/workflows/release.yml` 使用：

```yaml
on:
  workflow_dispatch:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  build:
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14-xlarge
            command: pnpm dist:mac
            artifact: macos
          - os: windows-2022
            command: pnpm dist:win
            artifact: windows
    runs-on: ${{ matrix.os }}
  release:
    needs: [build]
    permissions:
      contents: write
```

每个 runner 固定 Node 22.12.0 与 pnpm 10.12.1，必须先 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm check` 和 `pnpm test:ui:all`。macOS runner 先断言 `runner.arch == ARM64`，Windows job 对本次生成的 Setup 执行静默安装、定位安装后 EXE、启动存活检查和卸载；两个 job 只上传已测试的 `out/v<version>/<platform>`。独立 `release` job 使用 `fetch-depth: 0`，仅在 `refs/tags/v*` 时运行，验证标签严格等于 `v${package.json.version}` 且 peeled commit 是 `origin/main` 的祖先，再下载两个 artifact 并复核白名单恰好一个 DMG/一个 ZIP/一个 Setup EXE。

`macos-14-xlarge` 是需要仓库具备 larger-runner 权限/额度的 ARM64 runner，不能把它当成默认一定可用。发布候选阶段必须先用一次不打标签的 `workflow_dispatch` 预检该 job 能在 5 分钟内被调度并通过 `runner.arch == ARM64`；同时在 `doc/未决问题.md` 记录仓库权限、费用和预检时间。预检无法调度时不得创建发布标签：改由本机 Apple Silicon 完成同一构建验证并把“CI ARM runner 未启用”列为发行 blocker，直到 runner 权限开通后再继续。

第三方 Actions 固定到审计时解析的完整提交：`actions/checkout@11d5960a326750d5838078e36cf38b85af677262`、`pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1`、`actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`、`actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`、`actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`。先安装固定 pnpm，再让 setup-node 启用 pnpm 缓存。

Release 状态机：拒绝覆盖已发布同名 Release；允许恢复同标签 draft，但恢复时先删除该 draft 的全部旧资产，再从本次 manifest 全量上传，避免同名残缺资产令重试不可恢复。上传后通过 GitHub API 回读远端文件名和数量，并逐个重新下载到独立临时目录，流式复算 SHA256，与本次 manifest 完全一致后才取消 draft；禁止只比较 size，也禁止 `--clobber`。失败时只留下不可见 draft。workflow 顶层不授予写权限，build job 为 `contents: read`，仅 release job 为 `contents: write`；同标签 `concurrency.cancel-in-progress: false`。

公开后的 v0.4.0 使用普通 Release，标题和说明明确写“内测版”，但不勾选 GitHub prerelease；原因是当前客户端读取 `/releases/latest`，GitHub 不会把 prerelease 返回给该接口。本轮禁止上传自定义 ZIP 不再兼容的 `latest-mac.yml`。

- [ ] **Step 5: 增加 Windows 安装说明**

说明至少包括：Windows 10/11 x64、双击 Setup、SmartScreen 内测提示、卸载入口、本地数据目录 `%APPDATA%\yijian-toudi`、浏览器登录态仅保存在本机、不会自动投递、卸载默认保留用户数据、版本仍为内测。`package.json` 的 `nsis` 显式设置 `oneClick: true`、`perMachine: false`、`createDesktopShortcut: true`、`createStartMenuShortcut: true`；测试断言这些安装模型不漂移。同时把 `engines.node` 和开发说明统一为 `>=22.12 <23`，创建 `.node-version` 固定 `22.12.0`；为 Windows 配置 `build/icon.ico`。

- [ ] **Step 6: 运行发行配置测试至绿色**

Run:

```bash
node --test test/release-config.test.cjs
pnpm test
```

Expected: 发行配置测试和全部单元/集成测试 PASS。

- [ ] **Step 7: 精确提交发行配置**

```bash
git add package.json pnpm-lock.yaml .node-version test/release-config.test.cjs test/build-release.test.cjs .github/workflows/release.yml installer/Windows安装说明.md scripts/run-ui-tests.cjs scripts/build-release.cjs scripts/smoke-packaged.cjs scripts/smoke-windows.ps1
git commit -m "build: 增加 macOS 与 Windows 原生发行流水线"
```

### Task 4: 发行产物校验器

**Files:**
- Create: `test/artifact-verifier.test.cjs`
- Create: `scripts/verify-artifacts.cjs`
- Create: `test/release-manifest.test.cjs`
- Create: `scripts/create-release-manifest.cjs`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 用临时目录写失败测试**

测试导出的 `verifyArtifacts(directory, platform, version)`：

```js
test('macOS 缺少 DMG 时拒绝通过', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-artifacts-'));
  fs.writeFileSync(path.join(dir, '一键投递-0.3.1-macOS-arm64.zip'), 'zip');
  assert.throws(() => verifyArtifacts(dir, 'mac', '0.3.1'), /DMG/);
});

test('Windows Setup 与同名 SHA256 齐全时通过', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-artifacts-'));
  fs.writeFileSync(path.join(dir, '一键投递-0.3.1-windows-x64-Setup.exe'), 'exe');
  const result = writeChecksumsAndVerify(dir, 'win', '0.3.1');
  assert.equal(result.files.length, 1);
  assert.ok(fs.existsSync(path.join(dir, '一键投递-0.3.1-windows-x64-Setup.exe.sha256')));
});
```

- [ ] **Step 2: 运行并确认导出缺失导致失败**

Run: `node --test test/artifact-verifier.test.cjs`

Expected: FAIL，原因是模块不存在或函数未导出。

- [ ] **Step 3: 实现跨平台校验器**

`scripts/verify-artifacts.cjs` 只扫描目标目录第一层，拒绝符号链接；macOS 要求且只允许一个 `一键投递-<version>-macOS-arm64.dmg` 和一个 `一键投递-<version>-macOS-arm64.zip`，Windows 要求且只允许一个 `一键投递-<version>-windows-x64-Setup.exe`。macOS ZIP 还必须解压验证非元数据顶层恰好包含 `一键投递.app`、`一键安装.command`、`安装说明.md`，且 `.command` 保留可执行位；若压缩工具生成 `__MACOSX`，只能忽略该元数据目录，里面不得夹带额外产品文件。测试至少一次使用真实构建 `.app`，不能只靠空目录 fixture。对每个产物用流式 `crypto.createHash('sha256')` 计算摘要，分别原子写入 `<asset-name>.sha256`，内容同时包含哈希和原始 basename。CLI 参数为：

```bash
node scripts/verify-artifacts.cjs <directory> <mac|win> <version>
```

模块导出 `{ verifyArtifacts, writeChecksumsAndVerify }` 供测试调用。

- [ ] **Step 4: 实现可传递的发布 manifest**

先写 `test/release-manifest.test.cjs`，再实现 `scripts/create-release-manifest.cjs`。生成器输入 `--version`、`--commit`、`--mac-dir`、`--win-dir`、`--output`，要求精确发现 3 个安装资产、3 个同名 sidecar，并把两份仓库内说明复制/命名为 `一键投递-<version>-macOS-安装说明.md` 和 `一键投递-<version>-Windows-安装说明.md`。输出 `out/v<version>/release-manifest.json`，其中记录 8 个待上传资产的 basename、byte size、流式 SHA256、平台/用途，以及 commit、已知限制、回滚说明；manifest 自身作为第 9 个 Release 资产，但不自我包含。

mac build artifact 必须显式携带 macOS 安装说明，Windows artifact 显式携带 Windows 安装说明。release job 下载两份 Actions artifact 后调用同一个生成器，把九项文件复制到全新的 staging 目录；上传命令逐项读取 manifest 中的 basename 再追加 manifest 本身，禁止 glob。这样 tag checkout 只需要已提交的生成器和两份安装说明，候选清单不依赖未提交的本地文件。

- [ ] **Step 5: 在工作流上传前执行校验器**

两个构建 job 用一个 `id: meta` 的 Node 步骤读取版本，并通过 `fs.appendFileSync(process.env.GITHUB_OUTPUT, 'version=' + require('./package.json').version + '\\n')` 写入 `$GITHUB_OUTPUT`；后续只引用 `steps.meta.outputs.version`。只有白名单和逐资产摘要全部通过才上传 artifact，禁止 Bash 专用的 `VERSION=$(...)`，也禁止依赖不稳定的 `npm_package_version` 环境变量。

- [ ] **Step 6: 运行测试至绿色并提交**

Run:

```bash
node --test test/artifact-verifier.test.cjs
node --test test/release-manifest.test.cjs
pnpm test
```

Expected: 全部 PASS。

```bash
git add scripts/verify-artifacts.cjs test/artifact-verifier.test.cjs scripts/create-release-manifest.cjs test/release-manifest.test.cjs package.json .github/workflows/release.yml
git commit -m "build: 校验双平台发行产物与摘要"
```

### Task 4A: 跨平台更新下载按资产名精确校验并失败关闭

**Files:**
- Create: `electron/update-assets.cjs`
- Create: `test/update-assets.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `src/app.js`
- Create: `test/update-ui.test.cjs`

- [ ] **Step 1: 写多产物 Release 的失败测试**

覆盖三个行为：macOS 更新只选择 `macOS-arm64.zip`；摘要只选择 `<zip-name>.sha256`；摘要内容中的 basename 必须与下载文件完全一致。

```js
test('当前平台更新资产与同名摘要一一匹配', () => {
  const assets = [
    { name: '一键投递-0.3.1-macOS-arm64.dmg', browser_download_url: 'dmg' },
    { name: '一键投递-0.3.1-macOS-arm64.zip', browser_download_url: 'zip' },
    { name: '一键投递-0.3.1-windows-x64-Setup.exe', browser_download_url: 'exe' },
    { name: '一键投递-0.3.1-macOS-arm64.zip.sha256', browser_download_url: 'zip-sha' }
  ];
  const selected = selectUpdateAssets(assets, 'darwin');
  assert.equal(selected.download.url, 'zip');
  assert.equal(selected.sha256.url, 'zip-sha');
});

test('Windows 只选择 x64 Setup 与同名摘要', () => {
  const assets = [
    { name: '一键投递-0.3.1-windows-x64-Setup.exe', browser_download_url: 'exe' },
    { name: '一键投递-0.3.1-windows-x64-Setup.exe.sha256', browser_download_url: 'exe-sha' }
  ];
  const selected = selectUpdateAssets(assets, 'win32');
  assert.match(selected.download.name, /windows-x64-Setup\.exe$/);
  assert.equal(selected.sha256.name, selected.download.name + '.sha256');
});

test('摘要文件名不匹配时拒绝返回哈希', () => {
  assert.throws(
    () => parseChecksum('a'.repeat(64) + '  other.zip\n', 'target.zip'),
    /target\.zip/
  );
});
```

- [ ] **Step 2: 运行并确认模块缺失导致失败**

Run: `node --test test/update-assets.test.cjs`

Expected: FAIL，原因是 `electron/update-assets.cjs` 不存在。

- [ ] **Step 3: 实现精确选择与解析**

`selectUpdateAssets(assets, platform)` 在 `darwin` 要求恰好一个 `/macOS-arm64\.zip$/`，在 `win32` 要求恰好一个 `/windows-x64-Setup\.exe$/`，并要求恰好一个 `name === download.name + '.sha256'` 的摘要；缺失、重复或不支持的平台都抛出可理解错误。`parseChecksum(text, expectedBasename)` 逐行解析 `64hex + 空白 + basename`，只返回 basename 完全相等的哈希。

- [ ] **Step 4: 主进程下载校验失败关闭**

`update:check` 使用 `selectUpdateAssets(release.assets, process.platform)`，并向渲染层返回 `installKind: 'mac-app-zip' | 'windows-setup'`；`update:download` 使用 `parseChecksum`。摘要缺失、下载失败或 SHA256 不一致时返回 `ok:false`，删除本次损坏/未校验的临时下载，不得打开下载目录，也不得展示“可以安装”的成功提示。本轮继续使用自定义下载器，不上传已经因自定义 ZIP 而失效的 `latest-mac.yml`；Windows 下载 Setup 后只打开所在目录，不静默安装。

`src/app.js` 根据 `installKind` 显示平台正确的后续动作：Windows 明确提示“请运行下载目录中的 Setup 安装程序”，macOS 提示“解压后运行一键安装脚本安装 .app”，不得在 Windows 出现“拖到应用程序”字样。`test/update-ui.test.cjs` 对两种返回值和失败关闭提示做回归。

- [ ] **Step 5: 运行测试和更新流程回归**

Run:

```bash
node --test test/update-assets.test.cjs
node --test test/update-ui.test.cjs
node --test test/version.test.cjs test/core.test.cjs
pnpm check
```

Expected: 全部 PASS。

- [ ] **Step 6: 精确提交**

```bash
git add electron/update-assets.cjs electron/main.cjs src/app.js test/update-assets.test.cjs test/update-ui.test.cjs
git commit -m "fix: 更新下载按文件名严格校验摘要"
```

### Task 4B: Windows 品牌资源、浏览器路径与安装包结构

**Files:**
- Create: `build/icon.ico`
- Modify: `package.json`
- Modify: `electron/browser-runtime.cjs`
- Modify: `test/browser-runtime.test.cjs`
- Create: `scripts/package-macos-release.cjs`
- Create: `test/package-macos-release.test.cjs`

- [ ] **Step 1: 为 Windows 用户级浏览器路径写失败测试**

测试候选路径包含 `%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe` 和 `%LOCALAPPDATA%/Microsoft/Edge/Application/msedge.exe`，并继续保留 Program Files 候选。

- [ ] **Step 2: 运行并确认 LOCALAPPDATA 候选缺失**

Run: `node --test test/browser-runtime.test.cjs`

Expected: 新断言 FAIL，表明当前 Windows 用户级 Chrome/Edge 无法被发现。

- [ ] **Step 3: 增加用户级浏览器候选并运行至绿色**

从传入 env 或 `process.env.LOCALAPPDATA` 构造候选，禁止硬编码某个用户名。运行 `node --test test/browser-runtime.test.cjs`，Expected: PASS。

- [ ] **Step 4: 生成并登记 Windows 多尺寸图标**

从现有 `build/icon.icns`/源 PNG 生成含 16、24、32、48、64、128、256 像素的 `build/icon.ico`；`package.json` 的 `build.win.icon` 明确指向该文件。用图像检查工具确认每个尺寸可读取且透明通道正常。

- [ ] **Step 5: 为 macOS 分发 ZIP 外层结构写失败测试**

`scripts/package-macos-release.cjs` 的测试要求最终 ZIP 解压后顶层同时包含 `一键投递.app`、`一键安装.command`、`安装说明.md`，而不是只有 builder 生成的裸 app ZIP。

- [ ] **Step 6: 实现 macOS 分发 ZIP 组装**

脚本从 `out/v<version>/mac/mac-arm64/一键投递.app`、`installer/一键安装.command`、`installer/安装说明.md` 组装临时目录，再用 macOS `ditto -c -k --sequesterRsrc <临时目录>/ <临时ZIP>` 压缩目录内容（不使用 `--keepParent`，避免多一层随机临时目录）。解压验证三项非元数据顶层结构、`__MACOSX` 中没有额外产品文件以及 `.command` 可执行位后，原子重命名为 `out/v<version>/mac/一键投递-<version>-macOS-arm64.zip`；测试既覆盖最小 fixture，也对本轮真实 `.app` 运行相同检查。成功或失败都清理临时目录，绝不复用旧 `release/` ZIP。`package.json` 的 `build.mac.target` 只声明 `dir` 和 `dmg`，`scripts/build-release.cjs mac` 必须在 electron-builder 生成 app/DMG 后调用该脚本，任何入口都不得生成或上传 builder ZIP。

- [ ] **Step 7: 精确提交**

```bash
git add build/icon.ico package.json electron/browser-runtime.cjs test/browser-runtime.test.cjs scripts/package-macos-release.cjs test/package-macos-release.test.cjs
git commit -m "build: 补齐 Windows 资源与 macOS 分发结构"
```

### Task 5: 全量自动化与双阶段代码复查

**Files:**
- None planned; this task is read-only verification. Confirmed review defects return to the owning task and are committed there.

- [ ] **Step 1: 串行运行所有 Electron 回归**

Run:

```bash
pnpm test
pnpm check
pnpm test:ui:all
```

Expected: 全部命令退出码 0；Electron 测试不得并行运行。

- [ ] **Step 2: 启动介绍页后运行桌面/移动端测试**

在一个受控后台进程启动 `pnpm preview:site`，确认端口就绪后运行 `pnpm test:site`，最后终止预览进程。

Expected: 标题正确、图片无破损、移动端横向溢出为 0。

- [ ] **Step 3: 逐任务进行规格符合性审查**

审查连续同步是否满足：登录重试当前、核对推进下一、取消不推进、没有自动保存/提交/投递；审查发行是否满足原生 runner、同标签、双产物、SHA256、无 `pull_request_target`。

- [ ] **Step 4: 逐任务进行代码质量审查**

检查竞态、双击、网络超时、Windows 路径、中文文件名、shell 差异、GitHub token 权限、artifact glob 和错误退出码。Critical/Important 问题全部修复后重新审查。

- [ ] **Step 5: 执行全项目最终审查**

独立审查者对设计文档、实施计划、Git diff、测试输出和发行工作流进行最终审计，确认没有未解决 blocker 后才能进入真实站点。

### Task 6: 真实招聘站简历更新与保存回读

**Files:**
- Create: `doc/progress/2026-08-18-一键更新连续编排与双平台发行.md`
- Modify: `doc/未决问题.md`
- Modify: `doc/README.md`

- [ ] **Step 1: 备份本机简历数据并记录非敏感基线**

使用应用内备份导出功能生成恢复点；记录应用版本、招聘方向、目标平台和开始时间。文档不得写入手机号、邮箱、证件号、Token、Cookie 或邮箱授权码。

真实站外部写入只由当前主代理执行，子代理只允许只读审计截图、日志和字段报告。产品代码及自动化脚本永远不得点击保存/提交/申请/投递。用户已在本线程明确授权主代理更新官网简历；主代理也只能点击语义精确为“保存”“保存个人简历”“保存修改”的按钮，任何同时包含“提交简历”“申请”“投递”“应聘”或协议确认的按钮一律不点击。

- [ ] **Step 2: 腾讯社招更新与保存回读**

由应用“一键更新”打开腾讯社招页；处理登录/验证码；核对字段报告；主代理只在按钮语义精确属于上述保存白名单且页面不处于岗位申请流程时点击；关闭并重新打开，记录成功保存、回读一致和需人工字段数。语义不明确时不写入，只记录阻塞。

- [ ] **Step 3: 腾讯校招更新与安全退出**

自动进入校招后核对页面风险。若页面只有“提交简历”且它会真实投递，则绝不点击；只记录自动填入与回读结果，保持 degraded。

- [ ] **Step 4: 字节社招更新与保存回读**

执行与腾讯社招相同的“填入→主代理核对→保存白名单按钮→重新打开回读”；遇到 SSO/验证码使用本机会话人工处理，不绕过风控。

- [ ] **Step 5: 阿里社招更新与保存回读**

确认 `/personal/social-resume` 页面按钮语义后更新；按钮不满足保存白名单或可能触发申请时不点击并记录阻塞。

- [ ] **Step 6: 百度、小米、京东、美团手动入口诚实验收**

验证队列能依次打开正确社招/校招入口、顶部完成/取消可用；由于当前 adapter 为 manual，不把打开页面计为自动更新成功，也不替用户猜填自定义组件。

- [ ] **Step 7: 更新进度和未决问题**

逐平台记录：最后实测日期、入口、登录方式、自动识别字段数、回读一致字段数、人工字段、是否保存成功、是否有投递风险。只有完成保存后重新打开回读的平台才能升级 `verified`。

### Task 6A: 在构建前固定 v0.4.0 版本

**Files:**
- Modify: `package.json`
- Modify: `src/index.html`
- Modify: `site/index.html`
- Modify: `site/version.json`
- Modify: `scripts/release.cjs`
- Modify: `test/version.test.cjs`
- Modify: `README.md`
- Modify: `installer/安装说明.md`
- Modify: `installer/Windows安装说明.md`

- [ ] **Step 1: 用失败测试固定 v0.4.0 版本一致性**

先将 `test/version.test.cjs` 的期望升级为 `0.4.0`，并断言 `package.json`、应用标题、介绍页当前版本、macOS/Windows 下载文件名、两份安装说明和 `site/version.json` 同步；运行后确认因当前 0.3.0/0.2.0 漂移而失败。

- [ ] **Step 2: 让发布脚本严格更新全部版本载体**

`scripts/release.cjs` 的 semver 校验使用 `/^\d+\.\d+\.\d+$/`；更新 `package.json`、`src/index.html`、`site/index.html`、`site/version.json`、`README.md`、macOS/Windows 安装说明，并验证每个替换规则至少命中一次，否则退出非零。执行 `node scripts/release.cjs 0.4.0`，再运行版本测试至绿色。

- [ ] **Step 3: 精确提交版本升级**

```bash
git add package.json src/index.html site/index.html site/version.json scripts/release.cjs test/version.test.cjs README.md installer/安装说明.md installer/Windows安装说明.md
git commit -m "chore: 升级发行版本至 0.4.0"
```

### Task 7: 本地 macOS 构建与验证

**Files:**
- Update: `doc/progress/2026-08-18-一键更新连续编排与双平台发行.md`

- [ ] **Step 1: 清理本轮专用输出路径并构建 macOS**

构建脚本只清理项目 `out/v0.4.0/mac`，路径解析后必须仍位于项目 `out/` 内；不删除旧 `release/` 或用户其他文件。运行 `pnpm dist:mac` 生成 DMG、自定义分发 ZIP 和逐资产摘要。

- [ ] **Step 2: 校验产物和 SHA256**

运行 `pnpm verify:artifacts -- out/v0.4.0/mac mac 0.4.0`；检查 DMG、arm64 ZIP 和各自 `<asset>.sha256` 均存在且摘要可复算。

- [ ] **Step 3: 验证打包应用内容和启动**

检查 `.app/Contents/Resources/app.asar`、应用版本与架构；从打包 `.app` 启动，完成首屏、简历页、顶部退出栏、一键更新暂停/取消回归。

- [ ] **Step 4: 记录签名事实**

运行 `codesign -dv --verbose=4` 与 Gatekeeper 检查。没有 Developer ID 时明确记录“未签名内测包”，不得写成已公证。

### Task 8: Windows 原生构建与验证

**Files:**
- Update: `doc/progress/2026-08-18-一键更新连续编排与双平台发行.md`

- [ ] **Step 1: 在 Windows 原生环境执行测试**

使用 Windows GitHub Actions runner 或真实 Windows 机器运行 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm check`、`pnpm test:ui:all`。

- [ ] **Step 2: 生成 NSIS 安装包**

运行 `pnpm dist:win`，产出 `out/v0.4.0/win/一键投递-0.4.0-windows-x64-Setup.exe`。

- [ ] **Step 3: 校验 Windows 产物**

运行 `pnpm verify:artifacts -- out/v0.4.0/win win 0.4.0`，确认 Setup 与同名 `.sha256`。

- [ ] **Step 4: 安装/启动冒烟**

在 Windows 环境静默或交互安装，确认安装目录存在应用 EXE，启动后进程保持至少 10 秒且没有立即崩溃；能进行图形环境验证时检查首屏和简历页。未完成真实 Windows GUI 验证时 Release 保持内测标记。

### Task 9: 发行前事实与文档收口

**Files:**
- Modify: `doc/README.md`
- Modify: `doc/development/roadmap.md`
- Modify: `doc/integrations/大厂清单.md`
- Modify: `doc/progress/2026-08-18-一键更新连续编排与双平台发行.md`

- [ ] **Step 1: 修正文档漂移**

统一当前版本、测试数量、6 家岗位抓取、3 家 degraded 自动填写、4 家 manual 入口、BOSS 协议限制和真实保存验收结果。

- [ ] **Step 2: 回读 `agent.md` 逐条核对初心**

对岗位横向聚合、统一简历、邮件、Agent API、更新、macOS/Windows 落地逐项标记已完成/部分完成/未完成，禁止用“已支持”替代 degraded/manual。

- [ ] **Step 3: 最终全量验证**

重新运行 Task 5 全套命令，并对 macOS/Windows 构建记录、真站回读记录和 SHA256 做交叉核验。

- [ ] **Step 4: 精确提交事实与文档收口**

```bash
git add doc/README.md doc/development/roadmap.md doc/integrations/大厂清单.md doc/progress/2026-08-18-一键更新连续编排与双平台发行.md doc/未决问题.md
git commit -m "docs: 记录连续同步与双平台发行实测"
```

### Task 10: 发布候选准备（不自动对外发布）

**Files:**
- Generate (ignored build output): `out/v0.4.0/release-manifest.json`
- Generate (ignored staging output): `out/v0.4.0/release-assets/`

- [ ] **Step 1: 生成发布候选清单**

在双平台产物汇聚后运行已提交并测试过的 `scripts/create-release-manifest.cjs`，生成 `out/v0.4.0/release-manifest.json` 与全新 `release-assets/` staging。manifest 精确列出 v0.4.0 Git commit、一个 macOS DMG、一个 macOS 分发 ZIP、一个 Windows Setup、三个同名 SHA256 sidecar、两份带平台名的安装说明，以及每项 size/SHA256、已知限制和回滚方式；staging 加上 manifest 本身后必须恰好 9 项。对外上传逻辑只能逐项消费 manifest basename 并追加 manifest，禁止 glob 上传整个构建目录。

- [ ] **Step 2: 检查远端差异与未提交文件**

只读确认本地分支、远端 `main`、标签和 Release 差异；不得把无关用户文件混入发布提交。

- [ ] **Step 3: 请求一次不可逆发布确认**

推送分支、创建标签、GitHub Release、更新 Pages 均属于外部发布动作。只有到此步骤才向用户一次性展示产物与验证证据并请求确认；未确认前停留在本地发布候选状态。
