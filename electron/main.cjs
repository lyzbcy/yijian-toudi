const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, net, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JsonStore, calculateResumeCompletion, applyResumeEdit, switchProfile, addProfile, deleteProfile, renameProfile, migrateFlatResumeToProfiles, patchResume, batchAddToCart, findJobs } = require('./store.cjs');
const { AgentServer } = require('./agent-server.cjs');
const { syncQqMail } = require('./mail.cjs');
const registry = require('./adapters/registry.cjs');
const { applyJobMatches } = require('./match.cjs');
const { logger } = require('./logger.cjs');
const loginManager = require('./login-manager.cjs');
const {
  applyResultToCart,
  isSubmissionSuccess,
  validateCartRules,
  taskStatusForAutomation
} = require('./review-state.cjs');
const { createBackup, restoreBackup } = require('./backup.cjs');
const {
  runResumeSync,
  ResumeSyncSession,
  expandResumeSyncTargets,
  createResumeSyncExecutionQueue,
  isWorkspaceGenerationStale,
  createResumeSyncGenerationRegistry
} = require('./resume-sync.cjs');
const { createRedactedSnapshot } = require('./redact.cjs');
const { manualApplicationOutcome } = require('./workspace-outcome.cjs');
const { resolveResumeFilePath } = require('./resume-files.cjs');

let window;
let store;
let agentServer;
let resumeSyncSession = null;
let resumeSyncSessionGeneration = null;
const resumeSyncGenerations = createResumeSyncGenerationRegistry({ limit: 64 });
const resumeSyncExecutionQueue = createResumeSyncExecutionQueue();

function cancelledResumeSyncResult() {
  return {
    ok: false,
    status: 'cancelled',
    message: '已取消本轮简历同步',
    results: [],
    completed: false,
    session: resumeSyncSession?.snapshot() || null
  };
}

function resumeSyncWorkspace(generation) {
  const closeOwnWorkspace = async () => {
    const activeGeneration = loginManager.getStatus().context?.resumeSyncGeneration;
    if (activeGeneration === generation) await loginManager.closeWorkspaceIfOpen();
  };
  return {
    ...loginManager,
    openWorkspace: async (options = {}) => {
      if (resumeSyncGenerations.isCancelled(generation)) {
        const error = new Error('已取消本轮简历同步');
        error.code = 'RESUME_SYNC_CANCELLED';
        throw error;
      }
      const result = await loginManager.openWorkspace({
        ...options,
        context: { ...(options.context || {}), resumeSyncGeneration: generation }
      });
      if (resumeSyncGenerations.isCancelled(generation)) {
        await closeOwnWorkspace();
        const error = new Error('已取消本轮简历同步');
        error.code = 'RESUME_SYNC_CANCELLED';
        throw error;
      }
      return result;
    },
    closeWorkspaceIfOpen: closeOwnWorkspace
  };
}

function resumeSyncTargets(currentState) {
  return currentState.companies.filter((company) => {
    const capability = company.capabilities?.resume;
    return ['verified', 'degraded', 'manual'].includes(capability) && registry.getAdapter(company.id)?.fillResume;
  });
}

async function executeResumeSync({ startCompanyId, resumeSyncGeneration, pauseOnReview = true, createTasks = false, newRun = false } = {}) {
  if (resumeSyncGenerations.isCancelled(resumeSyncGeneration)) return cancelledResumeSyncResult();
  if (loginManager.isActive()) {
    return {
      ok: false,
      status: 'workspace-active',
      message: '当前有网页正在登录或核对，请先用顶部栏完成或取消',
      results: [],
      session: resumeSyncSession?.snapshot() || null
    };
  }
  const currentState = store.get();
  const recruitType = currentState.settings?.jobs?.recruitType || 'social';
  const targets = expandResumeSyncTargets(resumeSyncTargets(currentState), recruitType);
  const targetIds = targets.map((company) => company.syncTargetId);
  const targetSetChanged = resumeSyncSession
    && JSON.stringify(resumeSyncSession.companyIds) !== JSON.stringify(targetIds);
  if (!resumeSyncSession || resumeSyncSession.completed || newRun || targetSetChanged) {
    resumeSyncSession = new ResumeSyncSession(targetIds);
  }
  resumeSyncSessionGeneration = resumeSyncGeneration;
  const sessionForRun = resumeSyncSession;
  const taskIds = new Map();
  // 简历附件：用户在软件里上传过 PDF/DOC 时，把绝对路径传给适配器用于自动上传
  const attachmentFilename = currentState.resume?.basic?.resumeFile || '';
  let attachmentPath = null;
  if (attachmentFilename) {
    try {
      const fsMod = require('node:fs');
      const candidate = path.join(app.getPath('userData'), 'resumes', attachmentFilename);
      attachmentPath = fsMod.existsSync(candidate) ? candidate : null;
    } catch { attachmentPath = null; }
  }
  const result = await runResumeSync({
    resume: currentState.resume,
    attachmentPath,
    companies: targets,
    getAdapter: (companyId) => registry.getAdapter(companyId),
    recruitType,
    workspace: resumeSyncWorkspace(resumeSyncGeneration),
    startCompanyId: sessionForRun.startCompanyId() || startCompanyId,
    pauseOnReview,
    shouldAbort: () => resumeSyncGenerations.isCancelled(resumeSyncGeneration),
    onCompanyStart: createTasks
      ? (company) => {
          const direction = ['campus', 'summer-intern', 'daily-intern'].includes(company.resumeRecruitType) ? '校招' : '社招';
          const syncTargetId = company.syncTargetId || company.id;
          const taskId = addTask({
            type: 'browser',
            title: `更新简历到${company.name}（${direction}）`,
            detail: `正在打开${company.name}${direction}简历页…`
          });
          taskIds.set(syncTargetId, taskId);
          return taskId;
        }
      : undefined,
    onStep: (info) => {
      // 字段级进度日志：广播给渲染进程的填写日志栏
      if (window && !window.isDestroyed()) {
        window.webContents.send('resume:fill-log', {
          step: info.step || '',
          message: info.message || '',
          syncTargetId: info.syncTargetId || null,
          companyId: info.companyId || null,
          at: Date.now()
        });
      }
      const taskId = taskIds.get(info.syncTargetId);
      if (taskId) updateTaskLive(taskId, { detail: info.message });
    }
  });
  const cancelled = result.status === 'cancelled' || resumeSyncGenerations.isCancelled(resumeSyncGeneration);
  if (cancelled) return { ...result, status: 'cancelled', session: resumeSyncSession?.snapshot() || null };
  for (const entry of result.results || []) {
    const taskId = taskIds.get(entry.companyId);
    if (taskId) finishTask(taskId, taskStatusForAutomation(entry.status), entry.message);
  }
  if (resumeSyncSessionGeneration !== resumeSyncGeneration || resumeSyncSession !== sessionForRun) {
    return { ...result, ignored: true, session: resumeSyncSession?.snapshot() || null };
  }
  sessionForRun.acceptStage(result);
  return { ...result, session: sessionForRun.snapshot() };
}

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
  logger.info('Agent 命令', { action: command.action });
  if (command.action === 'refresh_jobs') return refreshJobs();
  if (command.action === 'open_company') return openCompany(command.companyId);
  if (command.action === 'favorite_job') {
    await toggleFavorite(command.jobId);
    return { jobId: command.jobId };
  }
  if (command.action === 'export_snapshot') return exportSnapshot(false);
  // ===== Agent 开放数据写入（design: 「当大型 skill」——AI 可自由读写本地数据）=====
  // 这些都是纯本地数据操作，立即生效、无需用户确认（外部写入如投递/填简历到官网仍需确认）。
  // update_resume：改 active profile 的任意字段（basic/intention/education/experience/projects/skills/extras）
  if (command.action === 'update_resume') {
    if (!command.patch || typeof command.patch !== 'object') throw new Error('update_resume 需要 patch 字段（对象）');
    const next = store.update((state) => {
      state.resume = patchResume(state.resume, command.patch, { merge: command.merge !== false });
      if (Array.isArray(state.jobs)) applyJobMatches(state.jobs, state.resume);
      return state;
    });
    broadcast();
    return { ok: true, completion: next.resume.completion, activeProfileId: next.resume.activeProfileId };
  }
  // manage_profile：新建/切换/删除/重命名 profile
  if (command.action === 'manage_profile') {
    const op = command.op; // 'add' | 'switch' | 'delete' | 'rename'
    let result;
    const next = store.update((state) => {
      if (op === 'add') {
        const newId = addProfile(state.resume, command.label);
        result = { op, profileId: newId };
      } else if (op === 'switch') {
        switchProfile(state.resume, command.profileId);
        result = { op, activeProfileId: command.profileId };
      } else if (op === 'delete') {
        deleteProfile(state.resume, command.profileId);
        result = { op, deleted: command.profileId, activeProfileId: state.resume.activeProfileId };
      } else if (op === 'rename') {
        renameProfile(state.resume, command.profileId, command.label);
        result = { op, profileId: command.profileId, label: command.label };
      } else {
        throw new Error('manage_profile 的 op 必须是 add/switch/delete/rename');
      }
      return state;
    });
    broadcast();
    return { ok: true, ...result, profiles: next.resume.profiles.map((p) => ({ id: p.id, label: p.label })) };
  }
  // batch_cart：批量加岗位到购物车（按 jobIds 或按筛选条件）
  if (command.action === 'batch_cart') {
    let added;
    const next = store.update((state) => {
      let jobIds = command.jobIds;
      if (!Array.isArray(jobIds)) {
        // 按筛选条件找
        const matched = findJobs(state.jobs, command.filter || {});
        jobIds = matched.map((j) => j.id);
      }
      added = batchAddToCart(state, jobIds);
      return state;
    });
    broadcast();
    return { ok: true, ...added };
  }
  // search_jobs：按条件筛岗位（只读，但通过 commands 走方便 AI 统一调用）
  if (command.action === 'search_jobs') {
    const state = store.get();
    const matched = findJobs(state.jobs, command.filter || {});
    return { count: matched.length, jobs: matched };
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
// registry 里每个 entry 用 listJobs/id/...，这里转成 refreshJobs 期望的字段名（fetch/companyId），
// 让 refreshJobs 不用改。后续 refreshJobs 重构时可直接消费 registry.listJobAdapters()。
const JOB_ADAPTERS = registry.listJobAdapters().map((adapter) => ({
  companyId: adapter.id,
  name: adapter.name,
  idPrefix: adapter.idPrefix,
  fetch: (opts) => adapter.listJobs(opts)
}));

// 启动时检查是否需要自动刷新岗位（settings.jobs.autoRefresh + 距上次>24h）
function maybeAutoRefreshJobs() {
  try {
    const settings = store.get().settings;
    if (!settings.jobs?.autoRefresh) return;
    const last = settings.jobs.lastRefreshAt ? new Date(settings.jobs.lastRefreshAt).getTime() : 0;
    if (Date.now() - last < 24 * 3600 * 1000) return;
    logger.info('自动刷新岗位（距上次超过 24 小时）');
    refreshJobs().catch((e) => logger.warn('自动刷新岗位失败', { error: e.message }));
  } catch (e) {
    logger.warn('自动刷新检查失败', { error: e.message });
  }
}

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
  const currentState = store.get();
  const favorites = new Map(currentState.jobs.filter((job) => job.favorite).map((job) => [job.id, job]));
  // 用当前简历给新岗位算匹配度（T3.9 #23），已存在的岗位也重算（简历可能改过）
  const allJobs = [
    ...currentState.jobs.filter((job) => !job.id.startsWith(idPrefix)),
    ...newJobs.map((job) => (favorites.has(job.id) ? { ...job, favorite: true } : job))
  ];
  applyJobMatches(allJobs, currentState.resume);
  store.update((state) => {
    state.jobs = allJobs;
    return state;
  });
}

async function openCompany(companyId) {
  const company = store.get().companies.find((item) => item.id === companyId);
  if (!company) throw new Error('未找到公司');
  const id = addTask({ type: 'browser', title: `打开 ${company.name} 招聘官网`, detail: '正在使用系统默认浏览器打开官网。' });
  try {
    await shell.openExternal(company.portal);
    finishTask(id, 'done', `已在系统浏览器打开 ${company.name} 招聘官网。`);
    return { ok: true, url: company.portal, browser: 'system-default' };
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
// 每家公司的投递由对应适配器执行，底层复用 persist:<companyId> session。
// registry 里 prepareApplication 为 null 的公司，applyCart 会标 manual-required（让用户手动接管）。
function getApplyAdapter(companyId) {
  const adapter = registry.getAdapter(companyId);
  return adapter?.prepareApplication ? adapter : null;
}

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
  const adapter = getApplyAdapter(job.companyId);
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
      const adapterResult = await adapter.prepareApplication(job, {
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
      // adapter 抛错时 workspace 可能还开着（loadURL 之后的脚本错误不会走 openWorkspace 内部 catch），
      // 必须兜底关闭，否则腾讯页会卡在窗口上。
      await loginManager.closeWorkspaceIfOpen();
      result = {
        id: job.id,
        status: 'failed',
        message: error.message
      };
      logger.error('投递准备失败', { job: job.id, error: error.message });
    }
  }

  // adapter 返回 failed（如岗位下线/404）时，adapter 内部理论上已关 workspace，
  // 但这里再保险关一次（closeWorkspaceIfOpen 是幂等的）——绝不能让原生页残留把用户困住。
  // review-required / manual-required / login-required 的 workspace 故意保留（留给用户接管）。
  if (result.status === 'failed') {
    await loginManager.closeWorkspaceIfOpen();
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
  const snapshot = createRedactedSnapshot(store.get());
  const outputDirectory = path.join(app.getPath('documents'), '一键投递导出');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const file = path.join(outputDirectory, `求职快照-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  if (showDialog) await dialog.showMessageBox(window, { type: 'info', title: '导出完成', message: '求职快照已导出', detail: file });
  return { file };
}

// 导出投递记录（T3.10 #24）：CSV 格式，方便 Excel/复盘
async function exportApplied() {
  const state = store.get();
  const applied = state.applied || [];
  const companies = new Map((state.companies || []).map((c) => [c.id, c.name]));
  const outputDirectory = path.join(app.getPath('documents'), '一键投递导出');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const file = path.join(outputDirectory, `投递记录-${new Date().toISOString().slice(0, 10)}.csv`);
  const header = '公司,岗位,城市,投递时间,当前状态,状态更新时间,数据来源\n';
  const rows = applied.map((job) => {
    const cells = [
      companies.get(job.companyId) || job.companyId || '',
      job.title || '',
      job.city || '',
      job.appliedAt || '',
      job.applyStatus || '已投递',
      job.lastStatusUpdate || '',
      job.statusSource || ''
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    return cells.join(',');
  });
  // 加 BOM 让 Excel 正确识别 UTF-8
  fs.writeFileSync(file, `\uFEFF${header}${rows.join('\n')}\n`, 'utf8');
  await dialog.showMessageBox(window, { type: 'info', title: '导出完成', message: `已导出 ${applied.length} 条投递记录`, detail: file });
  return { file, count: applied.length };
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
  // 真正替换当前状态，再由 store 的迁移器补齐新版字段；Token/邮箱授权码已由 restoreBackup 保留。
  migrateFlatResumeToProfiles(restored.resume);
  store.replace(restored);
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

// 正常启动时锁定 userData 路径为 'yijian-toudi'（不跟随 productName 变成中文「一键投递」）。
// UI 测试会显式传 --user-data-dir=<临时目录>；必须尊重这个参数，避免测试读取或修改真实简历数据。
// 必须在 app.whenReady() 之前调用。
const userDataArgument = process.argv.find((argument) => argument.startsWith('--user-data-dir='));
const requestedUserDataPath = userDataArgument?.slice('--user-data-dir='.length);
app.setPath(
  'userData',
  requestedUserDataPath
    ? path.resolve(requestedUserDataPath)
    : path.join(app.getPath('appData'), 'yijian-toudi')
);

app.whenReady().then(async () => {
  store = new JsonStore(app.getPath('userData'));
  store.init();
  await startAgentServer();
  createWindow();
  // 启动时若开启自动刷新且距上次超过 24 小时，后台抓一次岗位（T3.2 #8）
  maybeAutoRefreshJobs();

  ipcMain.handle('state:get', () => store.get());
  ipcMain.handle('app:data-path', () => app.getPath('userData'));
  ipcMain.handle('resume:save', (_event, resume) => {
    const next = store.update((state) => {
      state.resume = applyResumeEdit(state.resume, resume);
      // 简历改了，重新计算所有岗位的匹配度
      if (Array.isArray(state.jobs)) applyJobMatches(state.jobs, state.resume);
      return state;
    });
    broadcast();
    return next;
  });
  // 多份简历：切换/新建/删除/重命名。这些操作只改 profiles 结构，不碰字段内容。
  ipcMain.handle('resume:switch-profile', (_event, profileId) => {
    const next = store.update((state) => { switchProfile(state.resume, profileId); return state; });
    broadcast();
    return next;
  });
  ipcMain.handle('resume:add-profile', (_event, label) => {
    let newId;
    const next = store.update((state) => { newId = addProfile(state.resume, label); return state; });
    broadcast();
    return { state: next, profileId: newId };
  });
  ipcMain.handle('resume:delete-profile', (_event, profileId) => {
    const next = store.update((state) => { deleteProfile(state.resume, profileId); return state; });
    broadcast();
    return next;
  });
  ipcMain.handle('resume:rename-profile', (_event, profileId, label) => {
    const next = store.update((state) => { renameProfile(state.resume, profileId, label); return state; });
    broadcast();
    return next;
  });
  // ===== 简历 JSON 导出/导入（统一模板格式，见 electron/resume-json.cjs）=====
  const { createResumeExport, parseResumeImport } = require('./resume-json.cjs');
  // 导出 JSON Resume 标准格式：导入 rxresu.me（Reactive Resume）选 50+ 模板一键生成 PDF
  const { createJsonResume } = require('./resume-to-jsonresume.cjs');
  ipcMain.handle('resume:export-jsonresume', async () => {
    const payload = createJsonResume(store.get().resume);
    const defaultPath = path.join(
      app.getPath('documents'),
      `JSONResume-${(store.get().resume.basic?.name || '简历').replace(/\s+/g, '')}.json`
    );
    const selected = await dialog.showSaveDialog(window, {
      title: '导出 JSON Resume 标准格式',
      defaultPath,
      filters: [{ name: 'JSON Resume', extensions: ['json'] }]
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    fs.writeFileSync(selected.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { canceled: false, file: selected.filePath };
  });
  ipcMain.handle('resume:export-json', async () => {
    const payload = createResumeExport(store.get().resume, app.getVersion());
    const defaultPath = path.join(
      app.getPath('documents'),
      `一键投递简历-${new Date().toISOString().slice(0, 10)}.json`
    );
    const selected = await dialog.showSaveDialog(window, {
      title: '导出简历 JSON',
      defaultPath,
      filters: [{ name: '一键投递简历', extensions: ['json'] }]
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    fs.writeFileSync(selected.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { canceled: false, file: selected.filePath };
  });
  ipcMain.handle('resume:import-json', async () => {
    const selected = await dialog.showOpenDialog(window, {
      title: '导入简历 JSON',
      properties: ['openFile'],
      filters: [{ name: '一键投递简历', extensions: ['json'] }]
    });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    let imported;
    try {
      imported = parseResumeImport(fs.readFileSync(selected.filePaths[0], 'utf8'));
    } catch (error) {
      await dialog.showMessageBox(window, { type: 'error', title: '导入失败', message: error.message });
      return { canceled: true, error: error.message };
    }
    const confirmation = await dialog.showMessageBox(window, {
      type: 'warning',
      title: '确认导入简历',
      message: '导入会替换当前所有简历内容（含全部 profile）。',
      detail: '岗位、购物车、消息、Agent Token 和邮箱授权码不受影响。',
      buttons: ['取消', '确认导入'],
      defaultId: 0,
      cancelId: 0
    });
    if (confirmation.response !== 1) return { canceled: true };
    store.update((state) => { state.resume = imported; return state; });
    broadcast();
    return { canceled: false, profileCount: (imported.profiles || []).length || 1 };
  });
  // 简历一键更新到腾讯：用已登录 session 打开腾讯简历页自动填表（agent.md 核心目标）
  // 按当前 recruitType 选社招页（careers.tencent.com）或校招页（join.qq.com）。
  ipcMain.handle('resume:fill-tencent', () => resumeSyncExecutionQueue.run(async () => {
    const currentState = store.get();
    const resume = currentState.resume;
    const company = currentState.companies.find((item) => item.id === 'tencent');
    const adapter = registry.getAdapter('tencent');
    const recruitType = currentState.settings?.jobs?.recruitType || 'social';
    if (recruitType === 'all') {
      return { ok: false, status: 'direction-required', message: '“全部都要”包含社招和校招，请使用「一键更新」按两个方向依次核对' };
    }
    if (loginManager.isActive()) {
      return { ok: false, status: 'workspace-active', message: '当前有网页正在登录或核对，请先用顶部栏完成或取消' };
    }
    const campus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
    const direction = campus ? '校招' : '社招';
    const id = addTask({ type: 'browser', title: `更新简历到腾讯（${direction}）`, detail: `正在打开腾讯${direction}简历页…` });
    try {
      const attachmentFilename = resume?.basic?.resumeFile || '';
      let attachmentPath = null;
      if (attachmentFilename) {
        try {
          const candidate = path.join(app.getPath('userData'), 'resumes', attachmentFilename);
          attachmentPath = require('node:fs').existsSync(candidate) ? candidate : null;
        } catch { attachmentPath = null; }
      }
      const result = await adapter.fillResume(resume, {
        workspace: loginManager,
        company,
        taskId: id,
        recruitType,
        attachmentPath,
        onStep: (info) => {
          if (window && !window.isDestroyed()) {
            window.webContents.send('resume:fill-log', {
              step: info.step || '',
              message: info.message || '',
              syncTargetId: 'tencent',
              companyId: 'tencent',
              at: Date.now()
            });
          }
          updateTaskLive(id, { detail: info.message });
        }
      });
      finishTask(id, taskStatusForAutomation(result.status), result.message);
      logger.info('简历填写腾讯', { status: result.status, filled: result.filledCount, recruitType: campus ? 'campus' : 'social' });
      return result;
    } catch (error) {
      finishTask(id, 'error', error.message);
      throw error;
    }
  }));
  // 一键更新所有支持简历填写的平台（agent.md 核心目标）：遍历 resume 能力非 unsupported 的公司
  // （含腾讯 verified 自动填 + 五家 manual 打开官网手动填）。每家独立 workspace，遇到 login/captcha 停下。
  // 跟随当前 recruitType：校招模式只更校招简历页，社招模式只更社招页。
  ipcMain.handle('resume:fill-all', async (_event, request = {}) => {
    const { startCompanyId, resumeSyncGeneration } = typeof request === 'object'
      ? request
      : { startCompanyId: request, resumeSyncGeneration: null };
    const targets = resumeSyncTargets(store.get());
    if (targets.length === 0) return { ok: false, message: '当前没有公司支持简历更新', results: [] };
    logger.info('一键更新简历开始', { targets: targets.map((company) => company.id) });
    resumeSyncGenerations.start(resumeSyncGeneration);
    try {
      const result = await resumeSyncExecutionQueue.run(() => executeResumeSync({
        startCompanyId,
        resumeSyncGeneration,
        createTasks: true,
        pauseOnReview: true
      }));
      logger.info('一键更新简历阶段结束', { status: result.status, summary: result.summary, nextCompanyId: result.nextCompanyId });
      return result;
    } finally {
      resumeSyncGenerations.finish(resumeSyncGeneration);
    }
  });
  // 读取简历同步能力矩阵：哪些公司支持简历更新、状态如何
  ipcMain.handle('resume:sync-status', () => {
    const currentState = store.get();
    return currentState.companies
      .filter((c) => c.capabilities?.jobs && c.capabilities.jobs !== 'unsupported')
      .map((c) => ({ id: c.id, name: c.name, resume: c.capabilities.resume, logoUrl: c.logoUrl, color: c.color, short: c.short }));
  });
  ipcMain.handle('job:favorite', (_event, id) => toggleFavorite(id));
  ipcMain.handle('cart:toggle', (_event, id) => toggleCart(id));
  ipcMain.handle('cart:apply', () => resumeSyncExecutionQueue.run(() => applyCart()));
  // 刷新已投递岗位状态：目前只有腾讯实现了 inspectApplicationStatus（capabilities.status=manual）
  ipcMain.handle('applied:refresh-status', () => resumeSyncExecutionQueue.run(async () => {
    if (loginManager.isActive()) {
      return { ok: false, status: 'workspace-active', message: '当前有网页正在登录或核对，请先用顶部栏完成或取消' };
    }
    const currentState = store.get();
    const tencent = currentState.companies.find((item) => item.id === 'tencent');
    const adapter = registry.getAdapter('tencent');
    if (!adapter?.inspectApplicationStatus) {
      return { ok: false, message: '当前没有公司支持自动状态刷新，请在各招聘网站手动查看' };
    }
    const id = addTask({ type: 'browser', title: '刷新腾讯投递状态', detail: '正在打开腾讯「我的投递」…' });
    try {
      const result = await adapter.inspectApplicationStatus({
        workspace: loginManager,
        company: tencent,
        taskId: id,
        onStep: (info) => updateTaskLive(id, { detail: info.message })
      });
      if (result.status === 'inspected' && Array.isArray(result.records)) {
        // 合并到 state.applied
        const next = store.update((state) => {
          state.applied = require('./adapters/tencent-status.cjs').mergeTencentApplicationStatus(state.applied || [], result.records);
          return state;
        });
        finishTask(id, 'done', `已读取 ${result.count} 条腾讯投递记录`);
        return { ok: true, state: next, count: result.count };
      }
      // login-required/manual-required 的 workspace 留给用户接管；其余失败状态关闭，避免卡住。
      if (result.status !== 'login-required' && result.status !== 'manual-required') {
        await loginManager.closeWorkspaceIfOpen();
      }
      finishTask(id, taskStatusForAutomation(result.status), result.message);
      return { ok: false, message: result.message, status: result.status };
    } catch (error) {
      // 抛错时 workspace 可能还开着（adapter 内 loadURL 之后的脚本错误），兜底关闭。
      if (error.code !== 'WORKSPACE_ACTIVE') await loginManager.closeWorkspaceIfOpen();
      finishTask(id, 'error', error.message);
      return { ok: false, message: error.message };
    }
  }));
  ipcMain.handle('jobs:refresh', () => refreshJobs());
  ipcMain.handle('company:open', (_event, id) => openCompany(id));
  ipcMain.handle('email:sync', async (_event, credentials) => {
    const address = credentials.address || store.get().settings.email.address;
    const authorizationCode = credentials.authorizationCode || decryptSecret(store.get().settings.email.encryptedCode);
    const id = addTask({ type: 'email', title: '同步 QQ 邮箱招聘信息', detail: '正在读取最近邮件并只保留招聘相关内容…' });
    try {
      const messages = await syncQqMail({ address, authorizationCode });
      // 同步前已知 message id，用于判断哪些是「新邮件」，新面试/Offer 触发桌面通知（T3.8 #19）
      const knownIds = new Set((store.get().messages || []).map((m) => m.id));
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
      // 对新增的面试/Offer 邮件发桌面通知
      const newImportant = messages.filter((m) => !knownIds.has(m.id) && (m.stage === '面试' || m.stage === 'Offer'));
      for (const m of newImportant) {
        try {
          new Notification({ title: `${m.stage}：${m.company || '招聘方'}`, body: m.subject || '点击查看' }).show();
        } catch (e) { /* 通知失败不影响同步 */ }
      }
      finishTask(id, 'done', `已识别 ${messages.length} 封招聘相关邮件${newImportant.length ? `（含 ${newImportant.length} 封新的面试/Offer）` : ''}。`);
      return next;
    } catch (error) {
      finishTask(id, 'error', `邮箱同步失败：${error.message}`);
      throw error;
    }
  });
  ipcMain.handle('update:check', async () => {
    // 仓库地址写死（这是捞鱼自己的 APP，不该让用户填）。settings.githubRepo 保留做向后兼容。
    const repo = (store.get().settings.githubRepo || '').trim() || 'lyzbcy/yijian-toudi';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { configured: false, current: app.getVersion() };
    const release = await requestJson(`https://api.github.com/repos/${repo}/releases/latest`);
    const latest = String(release.tag_name || '').replace(/^v/, '');
    // 找 macOS arm64 zip 资产和 SHA256 文件，供一键更新使用
    const assets = release.assets || [];
    const zipAsset = assets.find((a) => /macOS.*arm64\.zip$/i.test(a.name) || /arm64.*\.zip$/i.test(a.name));
    const shaAsset = assets.find((a) => /sha256/i.test(a.name));
    return {
      configured: true,
      current: app.getVersion(),
      latest,
      updateAvailable: Boolean(latest && latest !== app.getVersion()),
      url: release.html_url,
      releaseNotes: release.body || '',
      // 一键更新需要的资产信息（#3）
      download: zipAsset ? { url: zipAsset.browser_download_url, name: zipAsset.name, size: zipAsset.size } : null,
      sha256: shaAsset ? { url: shaAsset.browser_download_url, name: shaAsset.name } : null
    };
  });
  // 一键更新（#3）：下载 zip 到下载目录、校验 SHA256、打开文件夹、弹教学窗。
  // 刻意不自动替换 .app / 重启——那需要 helper 进程和真实发布环境验收，风险高。
  // 当前做到「点一下→下载好→打开文件夹→告诉用户怎么替换」，已比「只给 GitHub 链接」友好得多。
  let downloadInProgress = false;
  ipcMain.handle('update:download', async (_event, { downloadUrl, downloadName, sha256Url }) => {
    if (downloadInProgress) return { ok: false, message: '已有下载在进行中' };
    if (!downloadUrl) return { ok: false, message: '没有找到可下载的安装包' };
    downloadInProgress = true;
    const downloadsDir = app.getPath('downloads');
    const zipPath = path.join(downloadsDir, downloadName || '一键投递-update.zip');
    try {
      // 下载 zip
      await new Promise((resolve, reject) => {
        const req = net.request({ url: downloadUrl, redirect: 'follow' });
        const chunks = [];
        req.on('response', (resp) => {
          if (resp.statusCode >= 300) { reject(new Error(`下载失败 HTTP ${resp.statusCode}`)); return; }
          resp.on('data', (c) => chunks.push(c));
          resp.on('end', () => { fs.writeFileSync(zipPath, Buffer.concat(chunks)); resolve(); });
        });
        req.on('error', reject);
        req.end();
      });
      // 校验 SHA256（如果有提供）
      let shaOk = null;
      let expectedSha = null;
      if (sha256Url) {
        try {
          expectedSha = await new Promise((resolve, reject) => {
            const req = net.request({ url: sha256Url, redirect: 'follow' });
            let txt = '';
            req.on('response', (r) => r.on('data', (c) => txt += c.toString()).on('end', () => resolve(txt)));
            req.on('error', reject);
            req.end();
          });
          // SHA256 文件格式通常：「<hash>  <filename>」取前 64 位
          expectedSha = (expectedSha.match(/[0-9a-fA-F]{64}/) || [])[0];
          if (expectedSha) {
            const fileBuf = fs.readFileSync(zipPath);
            const actualSha = crypto.createHash('sha256').update(fileBuf).digest('hex');
            shaOk = actualSha === expectedSha.toLowerCase();
          }
        } catch (e) { shaOk = null; /* 校验失败不阻塞，只标注 */ }
      }
      // 打开下载目录，让用户看到文件
      shell.showItemInFolder(zipPath);
      return { ok: true, file: zipPath, shaChecked: shaOk !== null, shaOk, expectedSha };
    } catch (error) {
      return { ok: false, message: error.message };
    } finally {
      downloadInProgress = false;
    }
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
      if (patch.autoRefreshJobs !== undefined) {
        state.settings.jobs = { ...state.settings.jobs, autoRefresh: patch.autoRefreshJobs };
        delete patch.autoRefreshJobs;
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
  // Agent Token 重置：旧 Token 立即失效，生成新 Token（T3.7 #15）
  ipcMain.handle('agent:reset-token', async () => {
    const next = store.update((state) => {
      state.settings.apiToken = crypto.randomBytes(18).toString('base64url');
      return state;
    });
    // Token 变了，Agent 服务要重启以加载新 Token
    await agentServer?.stop();
    agentServer = null;
    if (next.settings.apiEnabled) await startAgentServer();
    broadcast();
    return next;
  });
  ipcMain.handle('snapshot:export', () => exportSnapshot(true));
  ipcMain.handle('applied:export', () => exportApplied());
  ipcMain.handle('backup:export', () => exportBackup());
  ipcMain.handle('backup:restore', () => restoreBackupFromFile());
  ipcMain.handle('external:open', (_event, url) => {
    if (!/^https?:\/\//.test(url)) throw new Error('只允许打开 http(s) 链接');
    return shell.openExternal(url);
  });
  ipcMain.handle('item:show', (_event, itemPath) => shell.showItemInFolder(itemPath));
  // ===== 简历附件文件管理（用户上传自己设计的 PDF/DOC 简历）=====
  // 存储在 userData/resumes/ 下，basic.resumeFile 只保存应用生成的文件名；当前不会自动上传到官网。
  const resumesDir = path.join(app.getPath('userData'), 'resumes');
  if (!fs.existsSync(resumesDir)) fs.mkdirSync(resumesDir, { recursive: true });
  // 上传：用户选文件 → 复制到 resumes/ → 返回文件名（存到 basic.resumeFile）
  ipcMain.handle('resume:upload-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择简历文件',
      filters: [{ name: '简历文件', extensions: ['pdf', 'doc', 'docx'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const src = result.filePaths[0];
    const filename = `resume-${Date.now()}${path.extname(src)}`;
    const dest = path.join(resumesDir, filename);
    fs.copyFileSync(src, dest);
    // 更新 basic.resumeFile
    store.update((state) => { state.resume.basic.resumeFile = filename; return state; });
    broadcast();
    logger.info('简历文件已上传', { filename });
    return { canceled: false, filename, path: dest };
  });
  // 获取当前简历文件的完整路径（供用户本地查看；自动上传尚未开放）
  ipcMain.handle('resume:get-file-path', () => {
    const filename = store.get().resume?.basic?.resumeFile;
    if (!filename) return null;
    let filePath;
    try { filePath = resolveResumeFilePath(resumesDir, filename); } catch { return null; }
    return fs.existsSync(filePath) ? filePath : null;
  });
  // 列出 resumes/ 下所有文件（供前端展示历史简历）
  ipcMain.handle('resume:list-files', () => {
    return fs.readdirSync(resumesDir).map((name) => {
      const fp = path.join(resumesDir, name);
      const stat = fs.statSync(fp);
      return { name, size: stat.size, mtime: stat.mtime };
    }).sort((a, b) => b.mtime - a.mtime);
  });
  // 删除简历文件
  ipcMain.handle('resume:delete-file', (_event, filename) => {
    const fp = resolveResumeFilePath(resumesDir, filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    store.update((state) => {
      if (state.resume.basic.resumeFile === filename) state.resume.basic.resumeFile = '';
      return state;
    });
    broadcast();
    return { ok: true };
  });
  // 开发日志：返回内存中最近 50 条（见 logger.cjs）
  ipcMain.handle('log:get', () => logger.recent());

  // 嵌入式登录（见 login-manager.cjs）
  ipcMain.handle('login:open', (_event, companyId) => resumeSyncExecutionQueue.run(async () => {
    const company = store.get().companies.find((item) => item.id === companyId);
    if (!company) throw new Error('未找到公司');
    logger.info('打开嵌入式登录', { company: company.name, portal: company.portal });
    return loginManager.openLoginView(company);
  }));
  ipcMain.handle('login:close', () => resumeSyncExecutionQueue.run(async () => {
    logger.info('关闭嵌入式登录');
    await loginManager.closeLoginView();
    return { ok: true };
  }));
  ipcMain.handle('login:status', () => ({
    active: loginManager.isActive(),
    companyId: loginManager.getActiveCompanyId(),
    url: loginManager.getCurrentUrl()
  }));
  ipcMain.handle('workspace:status', () => loginManager.getStatus());
  ipcMain.handle('workspace:finish', (_event, { resumeSyncGeneration } = {}) => {
    resumeSyncGenerations.start(resumeSyncGeneration);
    return resumeSyncExecutionQueue.run(async () => {
      const activeStatus = loginManager.getStatus();
      const activeGeneration = activeStatus.context?.resumeSyncGeneration;
      if (isWorkspaceGenerationStale(activeGeneration, resumeSyncGeneration)
        || resumeSyncGenerations.isCancelled(activeGeneration)) {
        return {
          status: 'ignored',
          stale: true,
          workspace: activeStatus,
          session: resumeSyncSession?.snapshot() || null
        };
      }
      const result = await loginManager.finishWorkspace();
      const context = result.status?.context;
      const workspaceGeneration = context?.resumeSyncGeneration;
      if (isWorkspaceGenerationStale(workspaceGeneration, resumeSyncGeneration)
        || resumeSyncGenerations.isCancelled(workspaceGeneration)) {
        return { ...result, resumeSyncDecision: 'ignored', stale: true };
      }
      if (['fill-resume', 'manual-fill-resume'].includes(context?.action)) {
        const company = store.get().companies.find((item) => item.id === context.companyId);
        const syncTargetId = context.syncTargetId || context.companyId;
        const pendingStatus = resumeSyncSession?.pendingStatus(syncTargetId);
        if (context.taskId) finishTask(
          context.taskId,
          pendingStatus === 'login-required' ? 'waiting' : 'done',
          pendingStatus === 'login-required'
            ? `已结束${company?.name || '该平台'}登录处理，等待重新检查简历页`
            : `用户已结束${company?.name || '该平台'}简历核对（未验证官网保存）`
        );
        if (resumeSyncSession?.hasPending(syncTargetId)) {
          const session = resumeSyncSession.finish(syncTargetId);
          return { ...result, resumeSyncDecision: 'advance', companyId: syncTargetId, session };
        }
        return result;
      }
      if (context?.action === 'manual-apply' && context.jobId) {
        const applicationResult = manualApplicationOutcome('finish', context.jobId);
        if (context.taskId) finishTask(context.taskId, applicationResult.taskStatus, applicationResult.message);
        return {
          ...result,
          applicationResult
        };
      }
      if (context?.action !== 'apply-job' || !context.jobId) return result;

      const submitted = isSubmissionSuccess(result.snapshot);
      const applicationResult = {
        id: context.jobId,
        status: submitted ? 'submitted' : 'review-required',
        toastType: submitted ? 'success' : 'error',
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
    }).finally(() => resumeSyncGenerations.finish(resumeSyncGeneration));
  });
  ipcMain.handle('workspace:cancel', async (_event, { resumeSyncGeneration } = {}) => {
    resumeSyncGenerations.cancel(resumeSyncGeneration);
    const status = loginManager.getStatus();
    const activeGeneration = status.context?.resumeSyncGeneration;
    if (isWorkspaceGenerationStale(activeGeneration, resumeSyncGeneration)) {
      return {
        status: 'ignored',
        stale: true,
        workspace: status,
        session: resumeSyncSession?.snapshot() || null
      };
    }
    const result = await loginManager.cancelWorkspace();
    const context = status.context;
    if (['fill-resume', 'manual-fill-resume'].includes(context?.action)) {
      const company = store.get().companies.find((item) => item.id === context.companyId);
      if (context.taskId) finishTask(context.taskId, 'error', `用户取消了${company?.name || '该平台'}简历核对`);
      const syncTargetId = context.syncTargetId || context.companyId;
      if (resumeSyncSession?.hasPending(syncTargetId)) {
        const session = resumeSyncSession.cancel(syncTargetId);
        return { ...result, resumeSyncDecision: 'retry', companyId: syncTargetId, session };
      }
      return result;
    }
    if (context?.action === 'manual-apply' && context.jobId) {
      const applicationResult = manualApplicationOutcome('cancel', context.jobId);
      if (context.taskId) finishTask(context.taskId, applicationResult.taskStatus, applicationResult.message);
      return {
        ...result,
        applicationResult
      };
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
  await agentServer?.stop();
  if (process.platform !== 'darwin') app.quit();
});

// 退出前关闭工作区：把会话 Cookie 升级为持久 Cookie 并落盘，保证「记住本机登录态」跨重启生效。
app.on('before-quit', () => {
  try { loginManager.closeWorkspaceIfOpen(); } catch {}
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
