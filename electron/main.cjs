const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { JsonStore, calculateResumeCompletion } = require('./store.cjs');
const { BrowserAutomation } = require('./automation.cjs');
const { AgentServer } = require('./agent-server.cjs');
const { syncQqMail } = require('./mail.cjs');
const { listTencentJobs } = require('./adapters/tencent.cjs');

let window;
let store;
let automation;
let agentServer;

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  window.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.argv.includes('--dev')) window.webContents.openDevTools({ mode: 'detach' });
}

function broadcast() {
  if (window && !window.isDestroyed()) window.webContents.send('state:changed', store.get());
}

function addTask({ type, title, status = 'running', detail = '', progress = 10 }) {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  store.update((state) => {
    state.tasks.unshift({ id, type, title, status, detail, progress, createdAt: new Date().toISOString() });
    state.tasks = state.tasks.slice(0, 100);
    return state;
  });
  broadcast();
  return id;
}

function finishTask(id, status, detail) {
  store.update((state) => {
    const task = state.tasks.find((item) => item.id === id);
    if (task) Object.assign(task, { status, detail, progress: status === 'done' ? 100 : task.progress, finishedAt: new Date().toISOString() });
    return state;
  });
  broadcast();
}

async function handleCommand(command) {
  if (command.action === 'refresh_jobs') return refreshJobs();
  if (command.action === 'open_company') return openCompany(command.companyId);
  if (command.action === 'favorite_job') {
    await toggleFavorite(command.jobId);
    return { jobId: command.jobId };
  }
  if (command.action === 'export_snapshot') return exportSnapshot(false);
  if (command.action === 'sync_email') {
    throw new Error('出于安全考虑，邮箱同步需在应用内输入本机保存的授权码');
  }
}

async function startAgentServer() {
  const settings = store.get().settings;
  if (!settings.apiEnabled) return;
  agentServer = new AgentServer({ store, onCommand: handleCommand });
  try {
    const port = await agentServer.start(settings.apiPort);
    if (port !== settings.apiPort) {
      store.update((state) => { state.settings.apiPort = port; return state; });
    }
  } catch (error) {
    store.update((state) => {
      state.tasks.unshift({
        id: `task-api-${Date.now()}`, type: 'system', title: 'Agent API 启动失败',
        status: 'error', progress: 0, detail: error.message, createdAt: new Date().toISOString()
      });
      return state;
    });
  }
}

async function refreshJobs() {
  const settings = store.get().settings;
  const daysBack = settings.jobs?.daysBack || 30;
  const id = addTask({ type: 'jobs', title: '刷新全部岗位', detail: `正在抓取腾讯社招岗位（近 ${daysBack} 天）…`, progress: 20 });
  try {
    let fetchedCount = 0;
    let totalReported = 0;
    const tencentJobs = await listTencentJobs({
      daysBack,
      onProgress: (info) => {
        fetchedCount = info.collected ?? fetchedCount;
        totalReported = info.total ?? totalReported;
        if (info.error) {
          finishTask(id, 'running', `第 ${info.page} 页失败（${info.error}），保留已抓取数据继续…`);
        } else {
          finishTask(id, 'running', `已抓取 ${fetchedCount} 个腾讯岗位（共 ${totalReported}）…`);
        }
      }
    });

    const next = store.update((state) => {
      // 合并：腾讯岗位按 id 去重；已收藏的非腾讯岗位保留；已收藏的腾讯岗位保留 favorite
      const favorites = new Map(state.jobs.filter((job) => job.favorite).map((job) => [job.id, job]));
      const nonTencent = state.jobs.filter((job) => !job.id.startsWith('tencent-'));
      const merged = [
        ...nonTencent,
        ...tencentJobs.map((job) => (favorites.has(job.id) ? { ...job, favorite: true } : job))
      ];
      state.jobs = merged;
      state.settings.jobs = { ...state.settings.jobs, lastRefreshAt: new Date().toISOString() };
      return state;
    });
    broadcast();

    if (tencentJobs.length === 0) {
      finishTask(id, 'error', '未能抓取到任何腾讯岗位，请稍后重试。腾讯 API 可能暂时不可用。');
      return { mode: 'live', added: 0, message: '未能抓取到岗位，请稍后重试' };
    }

    finishTask(id, 'done', `已抓取腾讯 ${tencentJobs.length} 个岗位（近 ${daysBack} 天）。`);
    return { mode: 'live', added: tencentJobs.length, message: `已抓取腾讯 ${tencentJobs.length} 个岗位` };
  } catch (error) {
    finishTask(id, 'error', `抓取失败：${error.message}`);
    throw error;
  }
}

async function openCompany(companyId) {
  const company = store.get().companies.find((item) => item.id === companyId);
  if (!company) throw new Error('未找到公司');
  const id = addTask({ type: 'browser', title: `打开 ${company.name} 招聘官网`, detail: '将使用独立的本地浏览器资料目录保留登录态。' });
  try {
    const result = await automation.openPortal(company);
    finishTask(id, 'done', `已打开 ${company.name} 招聘官网；如出现登录或验证码，请在浏览器中完成。`);
    return result;
  } catch (error) {
    finishTask(id, 'error', error.message);
    throw error;
  }
}

async function toggleFavorite(jobId) {
  const next = store.update((state) => {
    const job = state.jobs.find((item) => item.id === jobId);
    if (job) job.favorite = !job.favorite;
    return state;
  });
  broadcast();
  return next;
}

async function exportSnapshot(showDialog = true) {
  const snapshot = store.get();
  delete snapshot.settings.apiToken;
  const outputDirectory = path.join(app.getPath('documents'), '一键投递导出');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const file = path.join(outputDirectory, `求职快照-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  if (showDialog) await dialog.showMessageBox(window, { type: 'info', title: '导出完成', message: '求职快照已导出', detail: file });
  return { file };
}

function encryptSecret(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用');
  return safeStorage.encryptString(value).toString('base64');
}

function decryptSecret(value) {
  if (!value) return '';
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET' });
    request.setHeader('Accept', 'application/vnd.github+json');
    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`更新服务返回 ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('更新信息格式不正确')); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

app.whenReady().then(async () => {
  store = new JsonStore(app.getPath('userData'));
  store.init();
  automation = new BrowserAutomation(app.getPath('userData'));
  await startAgentServer();
  createWindow();

  ipcMain.handle('state:get', () => store.get());
  ipcMain.handle('resume:save', (_event, resume) => {
    const next = store.update((state) => {
      state.resume = { ...resume, updatedAt: new Date().toISOString(), completion: calculateResumeCompletion(resume) };
      return state;
    });
    broadcast();
    return next;
  });
  ipcMain.handle('job:favorite', (_event, id) => toggleFavorite(id));
  ipcMain.handle('jobs:refresh', () => refreshJobs());
  ipcMain.handle('company:open', (_event, id) => openCompany(id));
  ipcMain.handle('email:sync', async (_event, credentials) => {
    const address = credentials.address || store.get().settings.email.address;
    const authorizationCode = credentials.authorizationCode || decryptSecret(store.get().settings.email.encryptedCode);
    const id = addTask({ type: 'email', title: '同步 QQ 邮箱招聘信息', detail: '正在读取最近邮件并只保留招聘相关内容…' });
    try {
      const messages = await syncQqMail({ address, authorizationCode });
      const next = store.update((state) => {
        const byId = new Map([...messages, ...state.messages].map((message) => [message.id, message]));
        state.messages = [...byId.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
        state.settings.email = {
          address,
          encryptedCode: authorizationCode ? encryptSecret(authorizationCode) : state.settings.email.encryptedCode,
          connected: true,
          lastSyncAt: new Date().toISOString()
        };
        return state;
      });
      finishTask(id, 'done', `已识别 ${messages.length} 封招聘相关邮件。`);
      return next;
    } catch (error) {
      finishTask(id, 'error', `邮箱同步失败：${error.message}`);
      throw error;
    }
  });
  ipcMain.handle('update:check', async () => {
    const repo = store.get().settings.githubRepo.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { configured: false, current: app.getVersion() };
    const release = await requestJson(`https://api.github.com/repos/${repo}/releases/latest`);
    const latest = String(release.tag_name || '').replace(/^v/, '');
    return { configured: true, current: app.getVersion(), latest, updateAvailable: latest && latest !== app.getVersion(), url: release.html_url };
  });
  ipcMain.handle('settings:update', async (_event, patch) => {
    const before = store.get().settings;
    const next = store.update((state) => {
      // jobsDaysBack 是扁平传入，存到嵌套的 settings.jobs.daysBack
      if (patch.jobsDaysBack !== undefined) {
        state.settings.jobs = { ...state.settings.jobs, daysBack: patch.jobsDaysBack };
        delete patch.jobsDaysBack;
      }
      state.settings = { ...state.settings, ...patch, email: { ...state.settings.email, ...(patch.email || {}) } };
      return state;
    });
    if (before.apiEnabled !== next.settings.apiEnabled || before.apiPort !== next.settings.apiPort) {
      await agentServer?.stop();
      agentServer = null;
      if (next.settings.apiEnabled) await startAgentServer();
    }
    broadcast();
    return next;
  });
  ipcMain.handle('snapshot:export', () => exportSnapshot(true));
  ipcMain.handle('external:open', (_event, url) => {
    if (!/^https?:\/\//.test(url)) throw new Error('只允许打开 http(s) 链接');
    return shell.openExternal(url);
  });
  ipcMain.handle('item:show', (_event, itemPath) => shell.showItemInFolder(itemPath));
});

app.on('window-all-closed', async () => {
  await automation?.close();
  await agentServer?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
