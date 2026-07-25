const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { JsonStore, calculateResumeCompletion } = require('./store.cjs');
const { BrowserAutomation } = require('./automation.cjs');
const { AgentServer } = require('./agent-server.cjs');
const { syncQqMail } = require('./mail.cjs');
const { listTencentJobs } = require('./adapters/tencent.cjs');
const { listBaiduJobs } = require('./adapters/baidu.cjs');
const { listBytedanceJobs } = require('./adapters/bytedance.cjs');
const { listXiaomiJobs } = require('./adapters/xiaomi.cjs');
const { listJdJobs } = require('./adapters/jd.cjs');
const { listMeituanJobs } = require('./adapters/meituan.cjs');
const { logger } = require('./logger.cjs');
const loginManager = require('./login-manager.cjs');
const {
  applyResultToCart,
  isSubmissionSuccess,
  validateCartRules,
  taskStatusForAutomation
} = require('./review-state.cjs');
const { createBackup, restoreBackup } = require('./backup.cjs');

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
  loginManager.setParent(window);
  loginManager.onChange((status) => {
    if (window && !window.isDestroyed()) window.webContents.send('workspace:changed', status);
  });
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
    if (task) {
      Object.assign(task, {
        status,
        detail,
        progress: status === 'done' ? 100 : task.progress
      });
      if (status === 'done' || status === 'error') {
        task.finishedAt = new Date().toISOString();
      } else {
        delete task.finishedAt;
      }
    }
    return state;
  });
  broadcast();
}

// 高频进度更新：只改内存 + 广播，不写盘（避免每抓一个岗位就写一次 state.json）
function updateTaskLive(id, patch) {
  const task = store.state.tasks.find((item) => item.id === id);
  if (task) Object.assign(task, patch);
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
  if (command.action === 'apply_cart') return applyCart();
  if (command.action === 'fill_resume') {
    const currentState = store.get();
    const { fillTencentResume } = require('./adapters/tencent-fill.cjs');
    const company = currentState.companies.find((item) => item.id === 'tencent');
    return fillTencentResume(currentState.resume, {
      workspace: loginManager,
      company
    });
  }
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

// 已适配的公司抓取器。每加一家，在这里登记一行即可被 refreshJobs 自动调用。
// idPrefix 用于合并时按公司清理旧数据、保留已收藏岗位。
const JOB_ADAPTERS = [
  { companyId: 'tencent', name: '腾讯', idPrefix: 'tencent-', fetch: (opts) => listTencentJobs(opts) },
  { companyId: 'baidu', name: '百度', idPrefix: 'baidu-', fetch: (opts) => listBaiduJobs(opts) },
  { companyId: 'bytedance', name: '字节跳动', idPrefix: 'bytedance-', fetch: (opts) => listBytedanceJobs(opts) },
  { companyId: 'xiaomi', name: '小米', idPrefix: 'xiaomi-', fetch: (opts) => listXiaomiJobs(opts) },
  { companyId: 'jd', name: '京东', idPrefix: 'jd-', fetch: (opts) => listJdJobs(opts) },
  { companyId: 'meituan', name: '美团', idPrefix: 'meituan-', fetch: (opts) => listMeituanJobs(opts) }
];

async function refreshJobs() {
  const settings = store.get().settings;
  const daysBack = settings.jobs?.daysBack || 30;
  const recruitType = settings.jobs?.recruitType || 'social';
  const recruitLabel = { social: '社招', campus: '校招', 'summer-intern': '暑期实习', 'daily-intern': '日常实习', all: '全部' }[recruitType] || '社招';
  logger.info('开始刷新岗位', { daysBack, recruitType, adapters: JOB_ADAPTERS.map((a) => a.companyId) });
  const totalAdapters = JOB_ADAPTERS.length;
  const id = addTask({ type: 'jobs', title: '刷新全部岗位', detail: `正在抓取各大厂${recruitLabel}岗位（近 ${daysBack} 天）…`, progress: 5 });
  try {
    const results = [];
    for (let ai = 0; ai < JOB_ADAPTERS.length; ai++) {
      const adapter = JOB_ADAPTERS[ai];
      const baseDone = results.reduce((s, r) => s + r.count, 0);
      updateTaskLive(id, {
        detail: `正在抓取${adapter.name}（第 ${ai + 1}/${totalAdapters} 家）…`,
        progress: Math.round((ai / totalAdapters) * 100),
        currentCompany: adapter.name,
        currentJob: ''
      });
      logger.info(`抓取${adapter.name}开始`);
      try {
        const jobs = await adapter.fetch({
          daysBack,
          recruitType,
          onProgress: (info) => {
            const running = baseDone + (info.collected ?? 0);
            if (info.error) {
              logger.warn(`${adapter.name}抓取批次失败`, info);
              updateTaskLive(id, {
                detail: `${adapter.name}第 ${info.page || info.keyword} 批失败（${info.error}），继续…`,
                currentJob: '重试中…'
              });
            } else {
              // 实时显示当前抓到的岗位，让用户看到"在动"
              updateTaskLive(id, {
                detail: `正在抓取${adapter.name}… 已累计 ${running} 个岗位`,
                progress: Math.round(((ai + (info.collected ?? 0) / Math.max(info.total || info.fetched || 1, 1)) / totalAdapters) * 100),
                currentJob: info.latestJob || `已抓取 ${info.collected ?? 0} 个`
              });
            }
          }
        });
        results.push({ companyId: adapter.companyId, name: adapter.name, idPrefix: adapter.idPrefix, count: jobs.length, jobs, error: null });
        logger.info(`抓取${adapter.name}完成`, { count: jobs.length });
        // 每抓完一家就合并入库，让用户 progressively 看到数据
        mergeJobs(adapter.idPrefix, jobs);
        broadcast();
      } catch (error) {
        logger.error(`抓取${adapter.name}失败`, { error: error.message });
        results.push({ companyId: adapter.companyId, name: adapter.name, idPrefix: adapter.idPrefix, count: 0, jobs: [], error: error.message });
      }
    }

    const next = store.update((state) => {
      state.settings.jobs = { ...state.settings.jobs, lastRefreshAt: new Date().toISOString() };
      return state;
    });
    broadcast();

    const totalAdded = results.reduce((sum, r) => sum + r.count, 0);
    const summary = results.map((r) => `${r.name || r.companyId} ${r.count} 个${r.error ? `（失败：${r.error}）` : ''}`).join('，');

    if (totalAdded === 0) {
      logger.warn('刷新岗位完成但无数据', { results: results.map((r) => ({ c: r.companyId, err: r.error })) });
      finishTask(id, 'error', '各家适配器均未能抓取到岗位，请稍后重试。');
      return { mode: 'live', added: 0, message: '未能抓取到岗位，请稍后重试' };
    }

    logger.info('刷新岗位全部完成', { total: totalAdded, breakdown: results.map((r) => ({ company: r.name, count: r.count })) });
    finishTask(id, 'done', `已抓取 ${totalAdded} 个岗位（近 ${daysBack} 天）：${summary}。`);
    return { mode: 'live', added: totalAdded, message: `已抓取 ${totalAdded} 个岗位` };
  } catch (error) {
    logger.error('刷新岗位异常', { error: error.message });
    finishTask(id, 'error', `抓取失败：${error.message}`);
    throw error;
  }
}

// 按 idPrefix 合并岗位：清掉该公司的旧数据，写入新数据，保留已收藏状态
function mergeJobs(idPrefix, newJobs) {
  const favorites = new Map(store.get().jobs.filter((job) => job.favorite).map((job) => [job.id, job]));
  store.update((state) => {
    const others = state.jobs.filter((job) => !job.id.startsWith(idPrefix));
    state.jobs = [
      ...others,
      ...newJobs.map((job) => (favorites.has(job.id) ? { ...job, favorite: true } : job))
    ];
    return state;
  });
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

// 加入/移除购物车
async function toggleCart(jobId) {
  const next = store.update((state) => {
    if (!state.cart) state.cart = [];
    const idx = state.cart.findIndex((item) => item.id === jobId);
    if (idx >= 0) {
      // 已在购物车，移除
      state.cart.splice(idx, 1);
    } else {
      // 加入购物车（从 jobs 里复制岗位快照）
      const job = state.jobs.find((item) => item.id === jobId);
      if (job) state.cart.push({ ...job });
    }
    return state;
  });
  broadcast();
  return next;
}

// 一键投递：用已登录 session 打开招聘网站执行真实投递（agent.md 核心目标）
// 每家公司的投递由对应适配器执行，底层复用 persist:<companyId> session
const APPLY_ADAPTERS = {
  tencent: { apply: (job, opts) => require('./adapters/tencent-apply.cjs').applyTencentJob(job, opts) }
};

async function applyCart() {
  const currentState = store.get();
  const cart = currentState.cart || [];
  if (cart.length === 0) return { applied: 0, message: '购物车是空的' };
  if (loginManager.isActive()) {
    return {
      status: 'workspace-active',
      message: '请先完成或取消当前浏览器操作'
    };
  }

  const ruleCheck = validateCartRules({
    cart,
    companies: currentState.companies
  });
  if (!ruleCheck.ok) {
    return { status: 'blocked', message: ruleCheck.message };
  }

  const job = cart[0];
  const company = currentState.companies.find((item) => item.id === job.companyId);
  const adapter = APPLY_ADAPTERS[job.companyId];
  const id = addTask({
    type: 'browser',
    title: `准备投递：${job.title}`,
    detail: `正在打开 ${company?.name || job.companyId} 招聘官网…`,
    progress: 20
  });

  let result;
  if (!adapter) {
    result = {
      id: job.id,
      status: 'manual-required',
      message: `${company?.name || job.companyId} 暂未支持自动投递，请手动完成`
    };
    logger.warn('无投递适配器', { company: job.companyId, job: job.id });
  } else {
    try {
      const adapterResult = await adapter.apply(job, {
        workspace: loginManager,
        company,
        taskId: id,
        onStep: (info) => updateTaskLive(id, { detail: info.message })
      });
      result = {
        id: job.id,
        status: adapterResult.status,
        message: adapterResult.message
      };
    } catch (error) {
      result = {
        id: job.id,
        status: 'failed',
        message: error.message
      };
      logger.error('投递准备失败', { job: job.id, error: error.message });
    }
  }

  store.update((state) => {
    const next = applyResultToCart({
      cart: state.cart,
      applied: state.applied,
      result,
      today: new Date().toISOString().slice(0, 10)
    });
    state.cart = next.cart;
    state.applied = next.applied;
    return state;
  });
  broadcast();

  const taskStatus = taskStatusForAutomation(result.status);
  finishTask(id, taskStatus, result.message);
  logger.info('投递准备结束', { job: job.id, status: result.status });
  return {
    ...result,
    remaining: store.get().cart.length
  };
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

async function exportBackup() {
  const defaultPath = path.join(
    app.getPath('documents'),
    `一键投递备份-${new Date().toISOString().slice(0, 10)}.json`
  );
  const selected = await dialog.showSaveDialog(window, {
    title: '备份一键投递数据',
    defaultPath,
    filters: [{ name: '一键投递备份', extensions: ['json'] }]
  });
  if (selected.canceled || !selected.filePath) return { canceled: true };
  const backup = createBackup(store.get(), app.getVersion());
  fs.writeFileSync(selected.filePath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  return { canceled: false, file: selected.filePath };
}

async function restoreBackupFromFile() {
  const selected = await dialog.showOpenDialog(window, {
    title: '选择一键投递备份',
    properties: ['openFile'],
    filters: [{ name: '一键投递备份', extensions: ['json'] }]
  });
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true };

  const file = selected.filePaths[0];
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  const restored = restoreBackup(store.get(), backup);
  const confirmation = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '确认恢复备份',
    message: '恢复会替换当前简历、岗位、消息和购物车。',
    detail: '软件会先在本机自动保存一份恢复前备份；Agent Token、邮箱授权码和网站登录态不会被替换。',
    buttons: ['取消', '确认恢复'],
    defaultId: 0,
    cancelId: 0
  });
  if (confirmation.response !== 1) return { canceled: true };

  const backupDirectory = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const automaticBackup = path.join(
    backupDirectory,
    `恢复前自动备份-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(
    automaticBackup,
    `${JSON.stringify(createBackup(store.get(), app.getVersion()), null, 2)}\n`,
    'utf8'
  );
  store.update(() => restored);
  await agentServer?.stop();
  agentServer = null;
  if (store.get().settings.apiEnabled) await startAgentServer();
  broadcast();
  return { canceled: false, file, automaticBackup };
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
  // 简历一键更新到腾讯：用已登录 session 打开腾讯简历页自动填表（agent.md 核心目标）
  ipcMain.handle('resume:fill-tencent', async () => {
    const currentState = store.get();
    const resume = currentState.resume;
    const company = currentState.companies.find((item) => item.id === 'tencent');
    const { fillTencentResume } = require('./adapters/tencent-fill.cjs');
    const id = addTask({ type: 'browser', title: '更新简历到腾讯', detail: '正在打开腾讯简历页…' });
    try {
      const result = await fillTencentResume(resume, {
        workspace: loginManager,
        company,
        taskId: id,
        onStep: (info) => updateTaskLive(id, { detail: info.message })
      });
      finishTask(id, taskStatusForAutomation(result.status), result.message);
      logger.info('简历填写腾讯', { status: result.status, filled: result.filledCount });
      return result;
    } catch (error) {
      finishTask(id, 'error', error.message);
      throw error;
    }
  });
  ipcMain.handle('job:favorite', (_event, id) => toggleFavorite(id));
  ipcMain.handle('cart:toggle', (_event, id) => toggleCart(id));
  ipcMain.handle('cart:apply', () => applyCart());
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
      // jobsDaysBack / recruitType 是扁平传入，存到嵌套的 settings.jobs
      if (patch.jobsDaysBack !== undefined) {
        state.settings.jobs = { ...state.settings.jobs, daysBack: patch.jobsDaysBack };
        delete patch.jobsDaysBack;
      }
      if (patch.recruitType !== undefined) {
        state.settings.jobs = { ...state.settings.jobs, recruitType: patch.recruitType };
        // 选择求职方向后，标记 onboarding 已完成
        state.meta.onboardingSeen = true;
        state.meta.privacyAcceptedAt = state.meta.privacyAcceptedAt || new Date().toISOString();
        delete patch.recruitType;
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
  ipcMain.handle('backup:export', () => exportBackup());
  ipcMain.handle('backup:restore', () => restoreBackupFromFile());
  ipcMain.handle('external:open', (_event, url) => {
    if (!/^https?:\/\//.test(url)) throw new Error('只允许打开 http(s) 链接');
    return shell.openExternal(url);
  });
  ipcMain.handle('item:show', (_event, itemPath) => shell.showItemInFolder(itemPath));
  // 开发日志：返回内存中最近 50 条（见 logger.cjs）
  ipcMain.handle('log:get', () => logger.recent());

  // 嵌入式登录（见 login-manager.cjs）
  ipcMain.handle('login:open', (_event, companyId) => {
    const company = store.get().companies.find((item) => item.id === companyId);
    if (!company) throw new Error('未找到公司');
    logger.info('打开嵌入式登录', { company: company.name, portal: company.portal });
    return loginManager.openLoginView(company);
  });
  ipcMain.handle('login:close', async () => {
    logger.info('关闭嵌入式登录');
    await loginManager.closeLoginView();
    return { ok: true };
  });
  ipcMain.handle('login:status', () => ({
    active: loginManager.isActive(),
    companyId: loginManager.getActiveCompanyId(),
    url: loginManager.getCurrentUrl()
  }));
  ipcMain.handle('workspace:status', () => loginManager.getStatus());
  ipcMain.handle('workspace:finish', async () => {
    const result = await loginManager.finishWorkspace();
    const context = result.status?.context;
    if (context?.action === 'fill-resume' && context.taskId) {
      finishTask(context.taskId, 'done', '用户已完成腾讯简历核对');
      return result;
    }
    if (context?.action !== 'apply-job' || !context.jobId) return result;

    const submitted = isSubmissionSuccess(result.snapshot);
    const applicationResult = {
      id: context.jobId,
      status: submitted ? 'submitted' : 'review-required',
      message: submitted
        ? '腾讯页面已确认投递成功'
        : '页面没有出现明确成功提示，岗位继续保留在购物车'
    };
    store.update((state) => {
      const next = applyResultToCart({
        cart: state.cart,
        applied: state.applied,
        result: applicationResult,
        today: new Date().toISOString().slice(0, 10)
      });
      state.cart = next.cart;
      state.applied = next.applied;
      return state;
    });
    broadcast();
    if (context.taskId) {
      finishTask(
        context.taskId,
        taskStatusForAutomation(applicationResult.status),
        applicationResult.message
      );
    }
    return { ...result, applicationResult };
  });
  ipcMain.handle('workspace:cancel', async () => {
    const status = loginManager.getStatus();
    const result = await loginManager.cancelWorkspace();
    const context = status.context;
    if (context?.action === 'fill-resume' && context.taskId) {
      finishTask(context.taskId, 'error', '用户取消了腾讯简历核对');
      return result;
    }
    if (context?.action !== 'apply-job' || !context.jobId) return result;

    store.update((state) => {
      const next = applyResultToCart({
        cart: state.cart,
        applied: state.applied,
        result: {
          id: context.jobId,
          status: 'cancelled',
          message: '用户取消了本次投递检查'
        },
        today: new Date().toISOString().slice(0, 10)
      });
      state.cart = next.cart;
      state.applied = next.applied;
      return state;
    });
    broadcast();
    if (context.taskId) finishTask(context.taskId, 'error', '用户取消了本次投递检查');
    return result;
  });
});

app.on('window-all-closed', async () => {
  await automation?.close();
  await agentServer?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
