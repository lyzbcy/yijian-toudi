// 账号浏览器管理（2026-09-22，Boss 代投商业化）
// 每个客户账号 = 独立 Edge 实例（独立 --user-data-dir）+ --load-extension 强制加载 Kimi 扩展。
// 自用账号（default）不开独立实例——直接用日常 Edge（扩展和登录态都在）。
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findEdgeBinary() {
  for (const p of EDGE_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 在 app userData 下找解包好的 Kimi 扩展目录（由 scripts/extract-kimi-extension.cjs 生成）。
// 结构：userData/extensions/kimi/<manifest.json>（已指向带 manifest 的版本目录）。
function findKimiExtensionDir(userDataPath) {
  const dir = path.join(userDataPath, 'extensions', 'kimi');
  if (!fs.existsSync(dir)) return null;
  // extract 脚本保证该目录直接含 manifest.json；兜底往下探一层
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  const entries = fs.readdirSync(dir).filter((e) => fs.existsSync(path.join(dir, e, 'manifest.json')));
  return entries.length ? path.join(dir, entries[0]) : null;
}

class AccountBrowserManager {
  constructor({ getUserDataPath, log }) {
    this.getUserDataPath = getUserDataPath;
    this.log = log || (() => {});
    this.processes = new Map(); // accountId -> child process
  }

  accountDataDir(accountId) {
    return path.join(this.getUserDataPath(), 'accounts', accountId);
  }

  extensionReady() {
    return Boolean(findKimiExtensionDir(this.getUserDataPath()));
  }

  // 打开客户账号的独立 Edge：先落二维码（Boss 登录页自带），扩展随后自动连桥（10086）。
  launch(account, { startUrl = 'https://www.zhipin.com/web/user/?ka=header-login' } = {}) {
    if (!account || !account.id || account.id === 'default') {
      return { error: 'default-account-uses-daily-edge', message: '自用账号无需独立浏览器，直接用日常 Edge 即可' };
    }
    if (this.processes.has(account.id) && !this.processes.get(account.id).killed) {
      return { started: true, alreadyRunning: true, accountId: account.id };
    }
    const edge = findEdgeBinary();
    if (!edge) return { error: 'edge-not-found', message: '未找到 msedge.exe，请确认 Edge 安装路径' };
    const extDir = findKimiExtensionDir(this.getUserDataPath());
    if (!extDir) {
      return { error: 'kimi-extension-missing', message: '未找到解包的 Kimi 扩展。先运行 scripts/extract-kimi-extension.cjs（或在设置页点"准备扩展"）' };
    }
    const dataDir = this.accountDataDir(account.id);
    fs.mkdirSync(dataDir, { recursive: true });
    const child = spawn(edge, [
      `--user-data-dir=${dataDir}`,
      `--load-extension=${extDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      startUrl
    ], { detached: false, stdio: 'ignore' });
    child.once('exit', (code) => {
      this.processes.delete(account.id);
      this.log(`account browser ${account.id} exited code=${code}`);
    });
    this.processes.set(account.id, child);
    this.log(`account browser launched: ${account.id} dataDir=${dataDir}`);
    return { started: true, accountId: account.id, dataDir };
  }

  close(accountId) {
    const child = this.processes.get(accountId);
    if (!child) return { closed: false, message: '该账号没有运行中的浏览器实例' };
    child.kill();
    this.processes.delete(accountId);
    return { closed: true, accountId };
  }

  runningAccounts() {
    return Array.from(this.processes.keys());
  }
}

module.exports = { AccountBrowserManager, findEdgeBinary, findKimiExtensionDir };
