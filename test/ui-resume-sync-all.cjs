const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

async function closeApplication(application) {
  const child = application.process();
  await withTimeout(application.close(), 5_000, 'Electron application close').catch(() => {});
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  if (child.exitCode === null && child.signalCode === null) {
    await withTimeout(new Promise((resolve) => {
      const onExit = () => resolve();
      child.once('exit', onExit);
      if (child.exitCode !== null || child.signalCode !== null) {
        child.off('exit', onExit);
        resolve();
      }
    }), 5_000, 'Electron process exit');
  }
}

async function withTimeout(promise, timeout, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeout);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function pollUntil(read, predicate, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`Timed out waiting for ${description}; last value: ${JSON.stringify(value)}`);
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-sync-all-'));
  let application;
  let watchdog;
  try {
    application = await electron.launch({
      args: [root, `--user-data-dir=${profile}`],
      executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    });
    watchdog = setTimeout(() => {
      console.error('sync-all UI test exceeded 70 seconds');
      if (application.process().exitCode === null) application.process().kill('SIGKILL');
    }, 70_000);
    watchdog.unref();

    // 只读观测真实编排阶段：不替换 adapter、网络或返回值，仅在原 acceptStage
    // 完成后记录其真实入参。该包装只存在于本次 Electron 测试进程。
    await withTimeout(application.evaluate(({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const mainRequire = createRequire(`${app.getAppPath()}/electron/main.cjs`);
      const { ResumeSyncSession } = mainRequire('./resume-sync.cjs');
      const originalAcceptStage = ResumeSyncSession.prototype.acceptStage;
      globalThis.__yjtLastResumeSyncStage = null;
      ResumeSyncSession.prototype.acceptStage = function acceptStageWithTestObservation(stage = {}) {
        const snapshot = originalAcceptStage.call(this, stage);
        globalThis.__yjtLastResumeSyncStage = {
          status: stage.status ?? null,
          currentCompanyId: stage.currentCompanyId ?? null,
          nextCompanyId: stage.nextCompanyId ?? null,
          continueCompanyId: stage.continueCompanyId ?? null,
          atEnd: Boolean(stage.atEnd),
          completed: Boolean(stage.completed)
        };
        return snapshot;
      };
    }), 5_000, 'resume sync stage observation injection');

    const window = await application.firstWindow();
    await window.waitForSelector('.hero-card');
    if (await window.locator('#onboardingDialog[open]').count() > 0) {
      await window.locator('.onboarding-choice[data-recruit="all"]').click();
      await window.waitForTimeout(400);
    }
    const state = await window.evaluate(() => window.oneClick.getState());
    assert.equal(state.settings.jobs.recruitType, 'all');

    await window.locator('[data-page="resume"]').first().click();
    await window.locator('#fillResumeAllButton').click();
    const firstWorkspace = await pollUntil(
      () => window.evaluate(() => window.oneClick.workspaceStatus()),
      (status) => status.active,
      'the first resume sync workspace to open'
    );
    assert.equal(firstWorkspace.active, true);
    assert.equal(firstWorkspace.context.syncTargetId, 'tencent:social');
    assert.equal(firstWorkspace.context.recruitType, 'social');

    // workspace.mode 只是 UI 展示模式；后续目标必须来自真实 resume sync stage.status。
    const firstStage = await pollUntil(
      () => application.evaluate(() => globalThis.__yjtLastResumeSyncStage),
      (stage) => stage?.currentCompanyId === 'tencent:social',
      'the first observed resume sync stage'
    );
    assert.match(firstStage.status, /^(login-required|manual-required|review-required)$/);
    const expectedTargetByStatus = {
      'login-required': 'tencent:social',
      'review-required': 'tencent:campus',
      'manual-required': 'tencent:campus'
    };
    const expectedNext = expectedTargetByStatus[firstStage.status];

    // 用户只需点顶部“完成核对”；renderer 应自动继续下一轨，
    // 不要求再点一次“一键更新”。
    await window.locator('#workspaceFinish').click();
    const nextWorkspace = await pollUntil(
      () => window.evaluate(() => window.oneClick.workspaceStatus()),
      (status) => status.active
        && status.context?.syncTargetId === expectedNext
        && Boolean(status.context?.taskId)
        && status.context.taskId !== firstWorkspace.context.taskId,
      `automatic continuation after ${firstStage.status} to ${expectedNext}`
    );
    assert.equal(nextWorkspace.active, true);
    assert.equal(nextWorkspace.context.syncTargetId, expectedNext);
    assert.notEqual(nextWorkspace.context.taskId, firstWorkspace.context.taskId);
    assert.equal(nextWorkspace.context.recruitType, expectedNext === 'tencent:social' ? 'social' : 'campus');

    await pollUntil(
      async () => {
        const currentState = await window.evaluate(() => window.oneClick.getState());
        return currentState.tasks.find((task) => task.id === nextWorkspace.context.taskId);
      },
      (task) => ['waiting', 'done', 'error'].includes(task?.status),
      'the continued resume sync business result'
    );
    await window.locator('#workspaceCancel').click();
    await pollUntil(
      () => window.evaluate(() => window.oneClick.workspaceStatus()),
      (status) => !status.active,
      'the continued workspace to close'
    );

    console.log(JSON.stringify({
      ok: true,
      firstStatus: firstStage.status,
      firstTarget: firstWorkspace.context.syncTargetId,
      nextTarget: nextWorkspace.context.syncTargetId
    }));
  } finally {
    if (watchdog) clearTimeout(watchdog);
    try {
      if (application) await closeApplication(application);
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
