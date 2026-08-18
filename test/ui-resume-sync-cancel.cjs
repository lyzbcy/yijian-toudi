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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-sync-cancel-'));
  let application;
  let watchdog;
  try {
    application = await electron.launch({
      args: [root, `--user-data-dir=${profile}`],
      executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    });
    watchdog = setTimeout(() => {
      console.error('sync-cancel UI test exceeded 70 seconds');
      if (application.process().exitCode === null) application.process().kill('SIGKILL');
    }, 70_000);
    watchdog.unref();

    // 只读观测真实会话取消：保留原 cancel 行为与返回值，只记录其真实快照。
    await withTimeout(application.evaluate(({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const mainRequire = createRequire(`${app.getAppPath()}/electron/main.cjs`);
      const { ResumeSyncSession } = mainRequire('./resume-sync.cjs');
      const originalCancel = ResumeSyncSession.prototype.cancel;
      globalThis.__yjtLastResumeSyncCancel = null;
      ResumeSyncSession.prototype.cancel = function cancelWithTestObservation(companyId) {
        const snapshot = originalCancel.call(this, companyId);
        globalThis.__yjtLastResumeSyncCancel = { companyId, snapshot };
        return snapshot;
      };
    }), 5_000, 'resume sync cancel observation injection');

    const window = await application.firstWindow();
    await window.waitForSelector('.hero-card');
    if (await window.locator('#onboardingDialog[open]').count() > 0) {
      await window.locator('.onboarding-choice[data-recruit="all"]').click();
      await window.waitForTimeout(400);
    }

    await window.locator('[data-page="resume"]').first().click();
    await window.locator('#fillResumeAllButton').click();
    const before = await pollUntil(
      () => window.evaluate(() => window.oneClick.workspaceStatus()),
      (status) => status.active
        && Boolean(status.context?.syncTargetId)
        && Boolean(status.context?.taskId),
      'the first resume sync workspace to open'
    );

    const firstTask = await pollUntil(
      async () => {
        const currentState = await window.evaluate(() => window.oneClick.getState());
        return currentState.tasks.find((task) => task.id === before.context.taskId);
      },
      (task) => ['waiting', 'done', 'error'].includes(task?.status),
      'the first resume sync business result'
    );
    assert.notEqual(firstTask.status, 'error', `first resume sync task failed: ${firstTask.detail}`);

    await window.locator('#workspaceCancel').click();
    const cancelObservation = await pollUntil(
      () => application.evaluate(() => globalThis.__yjtLastResumeSyncCancel),
      (observation) => observation?.companyId === before.context.syncTargetId,
      'the resume sync session cancel snapshot'
    );
    assert.equal(cancelObservation.snapshot.continueCompanyId, before.context.syncTargetId);
    await pollUntil(
      () => window.evaluate(() => window.oneClick.workspaceStatus()),
      (status) => !status.active,
      'the cancelled workspace to close'
    );
    await window.waitForTimeout(1_000);
    const afterCancel = await window.evaluate(() => window.oneClick.workspaceStatus());
    assert.equal(afterCancel.active, false, '取消后不得自动打开下一个工作区');

    await window.locator('#fillResumeAllButton').click();
    const retried = await pollUntil(
      () => window.evaluate(() => window.oneClick.workspaceStatus()),
      (status) => status.active
        && status.context?.syncTargetId === before.context.syncTargetId
        && Boolean(status.context?.taskId)
        && status.context.taskId !== before.context.taskId,
      `retrying cancelled target ${before.context.syncTargetId}`
    );
    assert.equal(retried.context.syncTargetId, before.context.syncTargetId);
    assert.notEqual(retried.context.taskId, before.context.taskId);

    const retriedTask = await pollUntil(
      async () => {
        const currentState = await window.evaluate(() => window.oneClick.getState());
        return currentState.tasks.find((task) => task.id === retried.context.taskId);
      },
      (task) => ['waiting', 'done', 'error'].includes(task?.status),
      'the retried resume sync business result'
    );
    assert.notEqual(retriedTask.status, 'error', `retried resume sync task failed: ${retriedTask.detail}`);

    await window.locator('#workspaceCancel').click();
    await pollUntil(
      () => window.evaluate(() => window.oneClick.workspaceStatus()),
      (status) => !status.active,
      'the retried workspace to close'
    );

    console.log(JSON.stringify({
      ok: true,
      cancelledTarget: before.context.syncTargetId,
      retriedTarget: retried.context.syncTargetId
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
