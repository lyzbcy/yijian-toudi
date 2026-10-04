(function (root) {
  function failureMessage(result) {
    const reason = result.message === 'updated-app-restart-not-confirmed'
      ? '新版未能完成启动确认。' : '上次更新未完成。';
    if (result.restorationDeferred) return reason + '当前程序仍在运行，旧版恢复副本已保留。请先保存资料并正常关闭软件，再联系作者恢复。';
    if (result.restored) return reason + '旧版文件已恢复，请重试更新或打开发布页。';
    return reason + '请重试更新或打开发布页。';
  }
  async function watch(readStatus, onFailure, { pollMs = 750, timeoutMs = 110000 } = {}) {
    if (typeof readStatus !== 'function') return;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let result;
      try { result = await readStatus(); } catch { return; }
      if (result?.status === 'failed') { onFailure(failureMessage(result)); return; }
      if (result?.status !== 'installed' || Date.now() >= deadline) return;
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  }
  root.watchDesktopInstallStatus = watch;
})(window);
