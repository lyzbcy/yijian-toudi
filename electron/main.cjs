const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, net, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Match the NSIS shortcut identity; keep it stable across product versions.
if (process.platform === 'win32') app.setAppUserModelId('com.lyzbcy.yijiantoudi');
const { JsonStore, calculateResumeCompletion, applyResumeEdit, switchProfile, addProfile, deleteProfile, renameProfile, migrateFlatResumeToProfiles, patchResume, batchAddToCart, findJobs } = require('./store.cjs');
const { recoverInterruptedTasks } = require('./task-recovery.cjs');
const { AgentServer } = require('./agent-server.cjs');
const { syncQqMail } = require('./mail.cjs');
const career = require('./career-tracker.cjs');
const mailAccounts=require('./mail-accounts.cjs');
const {BrowserMailbox}=require('./browser-mail.cjs');
const browserMailbox=new BrowserMailbox();
let emailSyncPromise = null;
let requestCareerRefresh;
const registry = require('./adapters/registry.cjs');
const { applyJobMatches } = require('./match.cjs');
const { logger } = require('./logger.cjs');
const loginManager = require('./login-manager.cjs');
const {windowTheme}=require('./window-theme.cjs');
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
const { mergeJobSnapshot, singleFlight } = require('./job-refresh.cjs');
const { shouldAutoRefreshJobs } = require('./job-auto-refresh.cjs');
const wecomNotify = require('./wecom-notify.cjs');
const { KimiBridge } = require('./kimi-bridge.cjs');
const { startInstalledDaemon } = require('./kimi-daemon-client.cjs');
const { BossBatchController } = require('./boss-control.cjs');
const { BOSS_ACCOUNT_ENTRY, classifyBossBinding, normalizePhoneMask } = require('./boss-binding.cjs');
const { AccountBrowserManager } = require('./account-browser.cjs');
const { createDesktopUpdater } = require('./desktop-updater.cjs');
const windowsUpdate=require('./windows-update.cjs');
const {diagnosticEntries}=require('./diagnostics.cjs');
const {normalizeTrack}=require('./platform-manifests.cjs');
const {shouldPrompt,migratePromotion,dismissPromotion}=require('./promo-policy.cjs');
const {endpointUrl,payloadForFeedback,createFeedbackClient}=require('./feedback.cjs');

let kimiBridge = null;
let bossBatchController = null;
let accountBrowsers = null;
let accountVerificationInProgress = false;
let manualSelfApproval = null;
let bossConnectionGeneration = 0;
const { selfIdentity, consumeApproval } = require('./boss-self-confirm.cjs');

async function startKimiBridge() {
  if (kimiBridge) return;
  kimiBridge = new KimiBridge({ log: (msg) => logger.info('[kimi-bridge]', msg) });
  kimiBridge.on('connected', () => broadcast({ type: 'kimi-bridge', connected: true }));
  kimiBridge.on('disconnected', () => { bossConnectionGeneration++; manualSelfApproval = null; broadcast({ type: 'kimi-bridge', connected: false }); });
  try {
    const client = kimiBridge;
    await client.start();
    if (kimiBridge === client && client.reason === 'daemon-unavailable' && !backgroundTest && !localPreview) {
      const launch = await startInstalledDaemon();
      if (launch.started) for (let n = 0; n < 3; n++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (kimiBridge !== client || !client.started) break;
        if (await client.refresh()) break;
      }
    }
  } catch (err) {
    // 客户端初始化失败不阻断APP启动；daemon仍由官方安装管理。
    logger.warn('[kimi-bridge] start failed:', err.message);
    kimiBridge = null;
  }
}

function stopKimiBridge() {
  manualSelfApproval = null;
  if (kimiBridge) { kimiBridge.stop(); kimiBridge = null; }
  broadcast();
}


let desktopUpdater,stagedDesktopUpdate=null,installInProgress=false;
const updateDirectory=()=>path.join(app.getPath('userData'),'desktop-updates');
async function canInstallDesktopUpdate(){
 if(process.platform!=='win32'||process.arch!=='x64'||!app.isPackaged||localPreview||backgroundTest)return false;
 try{return windowsUpdate.installationMatches(await windowsUpdate.readInstallation(),{executable:process.execPath,current:app.getVersion(),platform:process.platform,arch:process.arch,packaged:app.isPackaged,userData:app.getPath('userData')});}catch{return false;}
}
function getDesktopUpdater(){
 if(!desktopUpdater)desktopUpdater=createDesktopUpdater({store,directory:path.join(app.getPath('userData'),'desktop-updates'),fetchFn:(...args)=>net.fetch(...args),current:app.getVersion(),platform:process.platform,arch:process.arch,onProgress:progress=>{if(window&&!window.isDestroyed())window.webContents.send('update:progress',progress);}});
 return desktopUpdater;
}
let window;
let store;
let agentServer;
let feedbackWindow=null,feedbackClient=null,feedbackSession=null;
function getUiState(){const state=store.get();state.meta.starPromptDue=shouldPrompt(state.meta);state.messages=(state.messages||[]).filter(m=>m.accountId===(state.activeAccountId||'default')&&m.profileId===(state.resume?.activeProfileId||'default'));return state;}
function ensureFeedbackClient(){if(!feedbackClient)feedbackClient=createFeedbackClient({file:path.join(app.getPath('userData'),'feedback-outbox.json')});return feedbackClient;}
function assertFeedbackSender(event){if(!feedbackWindow||event.sender!==feedbackWindow.webContents)throw Error('feedback-window-required');}
async function openFeedback(kind='bug'){
  if(feedbackWindow&&!feedbackWindow.isDestroyed()){feedbackWindow.focus();return{opened:true};}
  const pending=ensureFeedbackClient().pending();
  feedbackSession={kind:pending?.payload.kind||(kind==='review'?'review':'bug'),requestId:pending?.payload.requestId||crypto.randomUUID(),logs:diagnosticEntries(logger.recent()),pending};
  feedbackWindow=new BrowserWindow({parent:window,modal:true,show:false,width:1100,height:820,minWidth:520,minHeight:600,title:'遇到问题反馈 · 一键投递',...windowTheme(),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  feedbackWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));feedbackWindow.on('closed',()=>{feedbackWindow=null;feedbackSession=null;});
  try{await feedbackWindow.loadFile(path.join(__dirname,'..','src','feedback.html'));if(!backgroundTest)feedbackWindow.show();return{opened:true};}catch{feedbackWindow?.destroy();return{opened:false};}
}
const backgroundTest = process.env.YIJIAN_BACKGROUND_TEST === '1';
const localPreview = process.argv.includes('--yjt-local-preview');
if (backgroundTest && !process.argv.some((arg) => arg.startsWith('--user-data-dir='))) {
  throw new Error('后台测试必须指定隔离的 --user-data-dir');
}
let resumeBatch = null;
function getResumeBatch() {
  if (!resumeBatch) {
    const { ResumeBatch } = require('./resume-batch.cjs');
    const { createResumeBatchWindow } = require('./resume-batch-window.cjs');
    resumeBatch = new ResumeBatch({
      store,
      getTargets: () => expandResumeSyncTargets(resumeSyncTargets(store.get()), store.get().settings?.jobs?.recruitType || 'social'),
      getAdapter: id => registry.getAdapter(id),
      createWorkspace: (...args) => createResumeBatchWindow(window, ...args),
      createPersistenceProbe: (target,resume,onChange)=>require('./meituan-persistence.cjs').createMeituanPersistenceProbe({BrowserWindow,parent:window,target,resume,onChange}),
      attachmentPath: resume => {
        const name = resume?.basic?.resumeFile;
        if (!name) return null;
        const file = resolveResumeFilePath(path.join(app.getPath('userData'), 'resumes'), name);
        return fs.existsSync(file) ? file : null;
      },
      backupProjects: snapshot=>{
        if(!/^[a-f0-9-]{36}$/.test(snapshot.planId))throw Error('项目备份标识无效');
        const directory=path.join(app.getPath('userData'),'resume-sync-backups');fs.mkdirSync(directory,{recursive:true});
        const file=path.join(directory,'projects-'+snapshot.planId+'.json');
        fs.writeFileSync(file,JSON.stringify({at:new Date().toISOString(),...snapshot},null,2)+'\n',{flag:'wx',mode:0o600});
      },
      onChange: status => {
        if (window && !window.isDestroyed()) window.webContents.send('resume:batch-changed', status);
      }
    });
    loginManager.setExternalBusy(() => resumeBatch.isActive());
  }
  return resumeBatch;
}
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
  // 不打扰的求好评：累计完成 3 次成功同步后，标记提醒一次（用户关闭后不再出现）
  try {
    if (result.status === 'verified' || (result.summary && result.summary.verifiedPlatforms >= 1)) {
      store.update((state) => {
        state.meta.fillCompletedCount = (state.meta.fillCompletedCount || 0) + 1;
        state.meta.starPromptDue=shouldPrompt(state.meta);
        return state;
      });
    }
  } catch {}
  return { ...result, session: sessionForRun.snapshot() };
}

function createWindow() {
  window = new BrowserWindow({
    show: !backgroundTest,
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    ...windowTheme(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: !backgroundTest
    }
  });
  windowsUpdate.bindRestartConfirmation(window, updateDirectory(), {
    version: app.getVersion(), executable: process.execPath,
    onConfirmed: result => {
      store.update(state => { state.meta.desktopInstallStatus = { status: 'restarted', version: result.version }; return state; });
      broadcast();
    },
    onError: error => logger.warn('update-restart-confirm-failed', { message: error.message })
  });
  window.loadFile(path.join(__dirname, '..', 'src', 'index.html'), { query: { appVersion: app.getVersion(), ...(localPreview ? { localPreview: '1', ...(app.commandLine.hasSwitch('remote-debugging-port') ? { aiDebug: '1' } : {}) } : {}) } });
  window.once('close', () => { void resumeBatch?.stop(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (!backgroundTest && process.argv.includes('--dev')) window.webContents.openDevTools({ mode: 'detach' });
  loginManager.setParent(window);
  loginManager.onChange((status) => {
    if (window && !window.isDestroyed()) window.webContents.send('workspace:changed', status);
  });
}

function broadcast() {
  if (window && !window.isDestroyed()) window.webContents.send('state:changed', getUiState());
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

// ==== Boss 批量投递控制面（IPC 与 Agent API 共用；2026-09-22 抽出）====
function getBossBatchController() {
  if (!bossBatchController) bossBatchController = new BossBatchController({
    store,
    getBridge: async (accountId) => {
      const verification = await verifyAccountBinding(accountId, { reservedBatch: true });
      if (!verification.verified) throw new Error(verification.error || 'account-binding-required');
      return kimiBridge;
    },
    notify: (message) => wecomNotify.notify(message),
    log: (message) => logger.info('[boss-batch]', message),
    onChanged: () => broadcast()
  });
  return bossBatchController;
}

function bossBatchStatus() { return { ...getBossBatchController().status(), selfConfirmationReady: Boolean(manualSelfApproval && Date.now() - manualSelfApproval.at <= 900000) }; }
function stopBossBatch() { return getBossBatchController().stop(); }
function resolveBossBatch(request) { return getBossBatchController().resolve(request); }

function listBossAccounts() {
  const state = store.get();
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  return {
    activeAccountId: state.activeAccountId || null,
    accounts: accounts.map((a) => ({
      id: a.id, name: a.name, phoneMasked: a.phoneMasked || '',
      totalApplied: (a.boss && a.boss.applied ? a.boss.applied.length : 0),
      createdAt: a.createdAt, lastActiveAt: a.lastActiveAt || null
    }))
  };
}

async function startBossBatch(request = {}) {
  if (accountVerificationInProgress) return { error: 'account-verification-in-progress' };
  return getBossBatchController().start(request);
}

function touchAccount(accountId) {
  try {
    store.update((state) => {
      const acc = (state.accounts || []).find((a) => a.id === accountId);
      if (acc) acc.lastActiveAt = new Date().toISOString();
      return state;
    });
  } catch {}
}

// ==== 账号管理面（Boss 代投商业化，2026-09-22）====
function ensureAccountBrowsers() {
  if (!accountBrowsers) {
    accountBrowsers = new AccountBrowserManager({
      getUserDataPath: () => require('node:path').join(app.getPath('userData')),
      log: (msg) => logger.info('[account-browser]', msg)
    });
  }
  return accountBrowsers;
}

function createBossAccount({ name, phoneMasked, clientName } = {}) {
  if (!name || !String(name).trim()) return { error: 'name-required' };
  const normalizedPhone = normalizePhoneMask(phoneMasked);
  if (phoneMasked && !normalizedPhone) return { error: 'account-phone-required' };
  const id = 'acc-' + Date.now().toString(36);
  const account = {
    id,
    name: String(name).trim(),
    phoneMasked: normalizedPhone || '',
    dataDir: id,
    // 授权留痕：扫码登录=授权行为本身；记录客户名与确认时间备查
    consent: { confirmedAt: new Date().toISOString(), clientName: clientName || String(name).trim() },
    boss: { applied: [], banCompanies: [], preferences: null },
    createdAt: new Date().toISOString(),
    lastActiveAt: null
  };
  store.update((state) => {
    state.accounts = state.accounts || [];
    state.accounts.push(account);
    return state;
  });
  logger.info('[account]', `created account ${id} (${account.name})`);
  return { created: true, account };
}

function selectBossAccount(accountId) {
  const state = store.get();
  const exists = (state.accounts || []).some((a) => a.id === accountId);
  if (!exists) return { error: 'account-not-found' };
  store.update((s) => { s.activeAccountId = accountId; return s; });
  return { selected: true, accountId };
}

// 手机号探测闭环：连接就绪后，导航到 Boss 用户页抓脱敏手机号与账号档案比对。
// 匹配 → 桥绑定该账号；不匹配 → 企微报警（防连接与账号错配串号）。
async function verifyAccountBinding(accountId, { reservedBatch = false } = {}) {
  if (accountVerificationInProgress || (!reservedBatch && bossBatchStatus().running)) return { error: 'already-running' };
  const state = store.get();
  const account = (state.accounts || []).find(a => a.id === accountId);
  if (!account) return { error: 'account-not-found' };
  if (!normalizePhoneMask(account.phoneMasked) && !(account.id === 'default' && normalizePhoneMask(state.resume?.basic?.phone))) return { error: 'account-phone-required' };
  accountVerificationInProgress = true;
  let client;
  try {
    if (!kimiBridge) await startKimiBridge();
    if (!kimiBridge) return { error: 'extension-not-connected' };
    client = kimiBridge;
    kimiBridge.bindAccount(null);
    await client.refresh();
    if (!client.isUp()) return { error: 'extension-not-connected' };
    await client.navigate(BOSS_ACCOUNT_ENTRY);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const snapshot = await client.snapshot();
    let result = classifyBossBinding(snapshot, account, { defaultPhone: state.resume?.basic?.phone });
    if (result.error === 'account-phone-unreadable' && account.id === 'default' && manualSelfApproval) {
      const approval = manualSelfApproval;
      manualSelfApproval = null;
      try {
        const identity = selfIdentity(snapshot, account, { name: state.resume?.basic?.name, phone: state.resume?.basic?.phone });
        if (approval.generation === bossConnectionGeneration && consumeApproval(approval, identity, client)) result = { verified: true, accountId, method: 'owner-confirmed-once' };
      } catch { /* The strict failure remains the result. */ }
    }
    if (!result.verified) return { ...result, message: '账号身份未核实，请检查登录、访问状态和账号手机号后重新核验。' };
    if (client !== kimiBridge || !client.isUp()) return { error: 'extension-not-connected' };
    client.bindAccount(accountId);
    return result;
  } catch {
    client?.bindAccount(null);
    return { error: 'account-verification-failed' };
  } finally { accountVerificationInProgress = false; }
}

function updateBossAccountPhone({ accountId, phoneMasked } = {}) {
  if (accountVerificationInProgress || bossBatchStatus().running) return { error: 'already-running' };
  const normalized = normalizePhoneMask(phoneMasked);
  if (!normalized) return { error: 'account-phone-required' };
  if (!store.get().accounts?.some(a => a.id === accountId)) return { error: 'account-not-found' };
  store.update(state => { state.accounts.find(a => a.id === accountId).phoneMasked = normalized; return state; });
  if (kimiBridge?.getBoundAccount() === accountId) kimiBridge.bindAccount(null);
  return { updated: true, accountId };
}

function handleResumeBatchAction({action,id,planId,confirmed}={}){
  const batch=getResumeBatch();
  if(action==='verify-saved')return batch.verifySaved(id);
  if(action==='query-saved')return batch.querySaved(id);
  if(action==='replace-projects')return batch.replaceProjects(id,planId,confirmed);
  if(action==='query-projects')return batch.queryProjects(id,planId);
  if(action==='refresh-projects')return batch.refreshProjects(id,planId);
  if(action==='query-widget')return batch.queryWidgetJob(id);
  if(action==='continue')return batch.continueWidgetJob(id);
  if(action==='retry-widget')return batch.retryWidgetJob(id);
  if(action==='stop')return batch.stop();
  if(action==='close')return batch.close(id);
  if(action==='retry'){if(loginManager.getStatus().active)throw Error('请先结束当前内嵌工作区');return batch.retry(id);}
  if(action==='confirm-saved')return batch.confirmSaved(id);
  if(action==='focus')return batch.focus(id);
  throw Error('未知简历批次操作');
}
async function startAgentServer() {
  const settings = store.get().settings;
  if (!settings.apiEnabled) return;
  agentServer = new AgentServer({ store, onCommand: handleCommand, careerRefresh:input=>requestCareerRefresh(input), onStateChange: broadcast,resumeBatchControl:{catalog:()=>getResumeBatch().catalog(),action:request=>handleResumeBatchAction(request)}, workspaceDiagnostics:async()=>{
    const {inspectWorkspace}=require('./workspace-diagnostics.cjs');
    const managers=[loginManager,...(resumeBatch?.workspaces()||[])].filter(m=>m.getStatus?.().active).slice(0,7);
    return{mechanism:'native-webcontents',remoteDebuggingEnabled:app.commandLine.hasSwitch('remote-debugging-port'),workspaces:await Promise.all(managers.map(m=>inspectWorkspace(m)))};
  }, bossControl: {
    start: (request) => startBossBatch(request || {}),
    stop: () => stopBossBatch(),
    resolve: (request) => resolveBossBatch(request),
    status: () => bossBatchStatus(),
    accounts: () => listBossAccounts(),
    createAccount: (request) => createBossAccount(request || {}),
    selectAccount: (request) => selectBossAccount((request || {}).accountId),
    launchAccount: (request) => {
      const acc = (store.get().accounts || []).find((a) => a.id === (request || {}).accountId);
      if (!acc) return { error: 'account-not-found' };
      return ensureAccountBrowsers().launch(acc, request.startUrl ? { startUrl: request.startUrl } : {});
    },
    closeAccount: (request) => ensureAccountBrowsers().close((request || {}).accountId),
    verifyAccount: async (request) => verifyAccountBinding((request || {}).accountId)
  } });
  try {
    const port = await agentServer.start(backgroundTest ? 0 : settings.apiPort);
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
    if (!shouldAutoRefreshJobs(store.get(), { backgroundTest, localPreview })) return;
    logger.info('自动刷新岗位（距上次超过 24 小时）');
    refreshJobs().catch((e) => logger.warn('自动刷新岗位失败', { error: e.message }));
  } catch (e) {
    logger.warn('自动刷新检查失败', { error: e.message });
  }
}

const refreshJobs = singleFlight(async function refreshJobsOnce() {
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
          pageSize: 100,
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
        logger.info(`抓取${adapter.name}完成`, { count: jobs.length });
        // 每抓完一家就合并入库，让用户 progressively 看到数据
        mergeJobs(adapter.idPrefix, jobs);
        results.push({ companyId: adapter.companyId, name: adapter.name, idPrefix: adapter.idPrefix, count: jobs.length, jobs, error: null });
        broadcast();
      } catch (error) {
        logger.error(`抓取${adapter.name}失败`, { error: error.message });
        results.push({ companyId: adapter.companyId, name: adapter.name, idPrefix: adapter.idPrefix, count: 0, jobs: [], error: error.message });
      }
    }

    const next = store.update((state) => {
      state.settings.jobs = { ...state.settings.jobs, lastRefreshAttemptAt: new Date().toISOString(),
        ...(results.every((result) => !result.error) ? { lastRefreshAt: new Date().toISOString() } : {}) };
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
    const failed = results.filter(result => result.error);
    return { mode: 'live', added: totalAdded, status: failed.length ? 'partial' : 'done',
      message: `已抓取 ${totalAdded} 个岗位${failed.length ? `；${failed.map(result => result.name).join('、')}刷新失败，已保留旧数据` : ''}` };
  } catch (error) {
    logger.error('刷新岗位异常', { error: error.message });
    finishTask(id, 'error', `抓取失败：${error.message}`);
    throw error;
  }
});

// 按 idPrefix 合并岗位：清掉该公司的旧数据，写入新数据，保留已收藏状态
function mergeJobs(idPrefix, newJobs) {
  const currentState = store.get();
  // 用当前简历给新岗位算匹配度（T3.9 #23），已存在的岗位也重算（简历可能改过）
  const allJobs = mergeJobSnapshot(currentState.jobs, newJobs, idPrefix);
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

const { installSingleProfileGate } = require('./single-profile.cjs');
const ownsProfile = installSingleProfileGate(app, () => window);

app.whenReady().then(async () => {
  if (!ownsProfile) return;
  store = new JsonStore(app.getPath('userData'));
  store.init();
  store.update(s=>{mailAccounts.ensure(s);career.importAgentReceipts(s);for(const m of s.messages||[])if(!m.accountId&&!m.profileId)Object.assign(m,mailAccounts.scope(s));return s;});
  logger.configure({ directory: path.join(app.getPath('userData'), 'logs'), diagnosticMode: store.get().settings.diagnosticLogging === true });
  store.update(state=>{
    const recovered = recoverInterruptedTasks(state);
    state.meta=migratePromotion(state.meta);
    if (recovered) logger.warn('上次运行的任务已中断，未自动继续', { count: recovered });
    return state;
  });
  wecomNotify.configure(store.get().settings.wecomWebhook);
  if (!localPreview && store.get().settings.kimiBridgeEnabled !== false) await startKimiBridge();
  await startAgentServer();
  createWindow();
  // 启动时若开启自动刷新且距上次超过 24 小时，后台抓一次岗位（T3.2 #8）
  maybeAutoRefreshJobs();

  ipcMain.handle('state:get', () => getUiState());
  ipcMain.handle('promo:dismiss',()=>{store.update(state=>{state.meta=dismissPromotion(state.meta);return state;});broadcast();return getUiState();});
  ipcMain.handle('feedback:open',(_event,kind)=>openFeedback(kind));
  ipcMain.handle('feedback:metadata',event=>{assertFeedbackSender(event);return{version:app.getVersion(),kind:feedbackSession.kind,requestId:feedbackSession.requestId,logs:feedbackSession.logs,configured:!!store.get().settings.feedbackEndpoint,pending:feedbackSession.pending?{message:feedbackSession.pending.payload.message,category:feedbackSession.pending.payload.category,includeLogs:!!feedbackSession.pending.payload.logs}:null};});
  ipcMain.handle('feedback:submit',async(event,input)=>{
    assertFeedbackSender(event);if(input?.requestId!==feedbackSession.requestId)return{ok:false,code:'feedback-id-conflict'};
    try{const payload=payloadForFeedback({...input,kind:feedbackSession.kind},{version:app.getVersion(),platform:process.platform,entries:feedbackSession.logs});return await ensureFeedbackClient().send(store.get().settings.feedbackEndpoint,payload);}catch{return{ok:false,code:'feedback-message-required'};}
  });
  ipcMain.handle('feedback:receipt',event=>{assertFeedbackSender(event);return ensureFeedbackClient().check(feedbackSession.requestId);});
  ipcMain.handle('feedback:close',event=>{assertFeedbackSender(event);feedbackWindow.close();return{closed:true};});
  ipcMain.handle('app:data-path', () => app.getPath('userData'));
  ipcMain.handle('boss:account:confirm-self', async (event) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('main-window-required');
    if (accountVerificationInProgress || bossBatchStatus().running) return { error: 'already-running' };
    const client = kimiBridge, state = store.get(), generation = bossConnectionGeneration;
    if (!client?.isUp()) return { error: 'extension-not-connected' };
    const account = state.accounts.find(a => a.id === 'default');
    const profile = { name: state.resume?.basic?.name, phone: state.resume?.basic?.phone };
    accountVerificationInProgress = true;
    try {
      await client.navigate(BOSS_ACCOUNT_ENTRY);
      await new Promise(resolve => setTimeout(resolve, 5000));
      const identity = selfIdentity(await client.snapshot(), account, profile);
      const answer = await dialog.showMessageBox(window, {
        type: 'question', title: '请本人确认当前 Boss 自用账号',
        message: `姓名：${identity.name}\n手机号：${identity.phone}\n请核对浏览器中的登录账号确实是本人。`,
        detail: 'Boss 仅显示末两位，本次确认补充自动校验。只适用于当前连接的默认自用账号，15分钟内单次有效；断线、身份变化即失效。不会直接发送投递。',
        buttons: ['取消', '本人已核对，确认本次账号'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (answer.response !== 1) return { confirmed: false };
      const current = selfIdentity(await client.snapshot(), account, profile);
      if (client !== kimiBridge || !client.isUp() || generation !== bossConnectionGeneration || current.fingerprint !== identity.fingerprint) return { error: 'account-changed' };
      manualSelfApproval = { fingerprint: current.fingerprint, client, generation, at: Date.now() };
      return { confirmed: true, expiresInSeconds: 900 };
    } catch (error) { return { error: error.message }; }
    finally { accountVerificationInProgress = false; }
  });
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
  ipcMain.handle('resume:batch-catalog', () => getResumeBatch().catalog());
  ipcMain.handle('resume:batch-start', (_event, request) => {
    if (loginManager.isActive()) throw new Error('请先结束当前网页登录、核对或简历批次');
    return getResumeBatch().start(request);
  });
  ipcMain.handle('resume:batch-action', (_event, request) =>handleResumeBatchAction(request));
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
  // Legacy Tencent-only inspector; no longer advertised as a whole-dashboard refresh.
  ipcMain.handle('applied:refresh-tencent-legacy', () => resumeSyncExecutionQueue.run(async () => {
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
  ipcMain.handle('zhilian:campus',async(event,input={})=>{
    if(event.sender!==window.webContents)throw Error('main-window-required');
    if(input.open!==undefined&&typeof input.open!=='boolean')throw Error('invalid-campus-open');
    const selected=JSON.stringify(mailAccounts.scope(store.get()));
    const {campusBrowser,importCampus}=require('./zhilian-campus.cjs');
    const observation=await campusBrowser.read({open:input.open===true});
    if(selected!==JSON.stringify(mailAccounts.scope(store.get())))throw Error('账号或简历已切换，请重新读取智联校园');
    if(observation.status!=='ready')return {status:observation.status,imported:0};
    let report;store.update(next=>{report=importCampus(next,observation);return next;});broadcast();return {status:'ready',report};
  });
  ipcMain.handle('career:save', (event, input) => {
    if(event.sender !== window.webContents) throw Error('main-window-required');
    store.update(state => { career.upsert(state, input); return state; }); broadcast(); return getUiState();
  });
  const syncEmail = async (credentials = {}) => {
    const emailScope=mailAccounts.scope(store.get());
    const saved=structuredClone(mailAccounts.select(store.get(),credentials));
    const isBrowser=saved.method==='browser';
    const address=credentials.address||saved.address;
    if(!isBrowser&&credentials.address&&credentials.address.trim().toLowerCase()!==saved.address&&!credentials.authorizationCode)throw Error('更换邮箱时请填写对应邮箱的授权码');
    const authorizationCode=isBrowser?'':credentials.authorizationCode||decryptSecret(saved.encryptedCode);
    const id=addTask({type:'email',title:`同步${saved.provider==='jiangnan'?'江南大学':'QQ'}邮箱招聘信息`,detail:'读取招聘列表与已启用的正文安排，分邮箱核验…'});
    const guard=()=>{if(JSON.stringify(mailAccounts.scope(store.get()))!==JSON.stringify(emailScope))throw Error('账号或简历已切换，本轮邮件未导入');};
    try {
      const detailIds=(store.get().settings.email.readBody===true||credentials.details===true)?require('../src/career-board.js').build(store.get()).tasks.filter(t=>['笔试中','面试中'].includes(t.stage)&&t.mailId&&(credentials.details===true||!store.get().messages.find(m=>m.id===t.mailId)?.details?.status)).map(t=>t.mailId).concat((store.get().careerApplications||[]).filter(r=>career.visible(store.get(),r)).flatMap(r=>r.confirmedMailIds||[])):[];
      const web=isBrowser?await browserMailbox.sync({provider:saved.provider,connect:credentials.connect===true,expectedAddress:saved.address||'',detailIds,readRecruitingBodies:store.get().settings.email.readBody===true||credentials.details===true,knownMessageIds:(store.get().messages||[]).filter(m=>m.accountId===emailScope.accountId&&m.profileId===emailScope.profileId).map(m=>m.id),limit:store.get().settings.email.scanLimit||200}):null;
      guard();
      if(web&&web.status!=='connected'){
        if(saved.address)store.update(s=>{mailAccounts.commit(s,saved,{...web,address:saved.address});return s;});
        broadcast();finishTask(id,'waiting',web.status==='tab-required'?'此邮箱同步页已关闭，请点击该邮箱的继续同步':'请完成该邮箱登录后继续；本轮未导入');return getUiState();
      }
      const messages=(web?web.messages:await syncQqMail({address,authorizationCode})).map(m=>({...m,...emailScope,mailboxId:saved.id}));guard();
      const knownIds=new Set((store.get().messages||[]).filter(m=>m.accountId===emailScope.accountId&&m.profileId===emailScope.profileId).map(m=>m.id));
      store.update(s=>{
        const entry=mailAccounts.commit(s,saved,web||{status:'connected',address},{encryptedCode:authorizationCode?encryptSecret(authorizationCode):''});
        const byId=new Map((s.messages||[]).map(m=>[JSON.stringify([m.accountId,m.profileId,m.id]),m]));for(const m of messages){const key=JSON.stringify([m.accountId,m.profileId,m.id]);byId.set(key,{...byId.get(key),...m});}s.messages=[...byId.values()].sort((a,b)=>String(b.receivedAt||'').localeCompare(String(a.receivedAt||'')));
        if(credentials.connect===true&&entry.provider==='qq')career.bindMailbox(s,entry.address);
        career.reconcile(s,s.messages.filter(m=>m.accountId===emailScope.accountId&&m.profileId===emailScope.profileId),{importMissing:s.settings.email.importProgress===true});
        return s;
      });
      for(const m of messages.filter(m=>!knownIds.has(m.id)&&(m.stage==='面试'||m.stage==='Offer'))){try{new Notification({title:`${m.stage}：${m.company||'招聘方'}`,body:m.subject||'点击查看'}).show();}catch{}}
      broadcast();finishTask(id,'done',`扫描 ${web?.scanned??'最近'} 封，识别 ${messages.length} 封招聘邮件${web?.partial?'（局部列表）':''}；投递进度与待确认项已核对。`);return getUiState();
    }catch(error){
      if(saved.address){try{guard();store.update(s=>{mailAccounts.commit(s,saved,{status:'error',address:saved.address,error:'同步失败，保留已有数据'});return s;});broadcast();}catch{}}
      finishTask(id,'error',`邮箱同步失败：${error.message}`);throw error;
    }
  };
  const requestEmailSync=(credentials={})=>{
    if(emailSyncPromise)return Promise.reject(Error('邮箱同步正在进行，请稍后重试'));
    emailSyncPromise=(async()=>{
      if(!credentials.all)return syncEmail(credentials);
      const origin=mailAccounts.scope(store.get()),list=mailAccounts.accounts(store.get()).filter(a=>a.address&&a.enabled!==false),errors=[];
      for(const a of list){if(JSON.stringify(mailAccounts.scope(store.get()))!==JSON.stringify(origin))throw Error('账号或简历已切换');try{await syncEmail({mailboxId:a.id,connect:false,details:credentials.details===true});}catch{errors.push(a.id);}}
      if(!list.length)throw Error('请先连接一个邮箱');
      return getUiState();
    })().finally(()=>{emailSyncPromise=null;});return emailSyncPromise;
  };
  ipcMain.handle('email:sync',(event,credentials)=>{
    if(event.sender!==window.webContents)throw Error('main-window-required');return requestEmailSync(credentials);
  });
  const {createRefresh,OfficialStatusReader}=require('./career-refresh.cjs');
  const officialStatusReader=new OfficialStatusReader();
  requestCareerRefresh=createRefresh({store,broadcast,syncMailbox:requestEmailSync,readOfficialStatus:t=>officialStatusReader.read(t)});
  ipcMain.handle('applied:refresh-status',async(event)=>{
    if(event.sender!==window.webContents)throw Error('main-window-required');
    const result=await requestCareerRefresh({...mailAccounts.scope(store.get()),confirmRead:true,reconnect:true});
    return {...result,state:getUiState()};
  });
  const emailTimer=setInterval(()=>{
    const email=store.get().settings.email;
    if(!backgroundTest&&email.autoSync===true&&mailAccounts.accounts(store.get()).some(a=>a.address&&a.enabled!==false))requestEmailSync({all:true}).catch(()=>{});
  },10*60*1000);
  emailTimer.unref();
  app.once('before-quit',()=>clearInterval(emailTimer));
  ipcMain.handle('update:check' , async(event,input={}) => {
    if(event.sender!==window.webContents)throw Error('main-window-required');
    if(installInProgress)throw Error('update-install-in-progress');
    return {...await getDesktopUpdater().check({manual:input?.manual!==false}),canInstall:await canInstallDesktopUpdate()};
  });
  ipcMain.handle('update:download', async(event,input={}) => {
    if(event.sender!==window.webContents)throw Error('main-window-required');
    if(installInProgress)return {ok:false,message:'update-install-in-progress'};
    stagedDesktopUpdate=null;
    try {const result=await getDesktopUpdater().download(input);stagedDesktopUpdate=result;const canInstall=await canInstallDesktopUpdate();if(!canInstall)shell.showItemInFolder(result.file);return {...result,canInstall};}
    catch(error){return {ok:false,message:error.message};}
  });
  ipcMain.handle('update:install-status',async(event)=>{if(event.sender!==window.webContents)throw Error('main-window-required');try{const r=JSON.parse(fs.readFileSync(path.join(updateDirectory(),'install-result.json'),'utf8').replace(/^\uFEFF/,''));return {status:r.status,version:r.version,runningVersion:r.runningVersion,message:r.message,restored:r.restored};}catch{return null;}});
  ipcMain.handle('update:install',async(event,input={})=>{
    if(event.sender!==window.webContents)throw Error('main-window-required');
    if(installInProgress)return {ok:false,message:'update-install-in-progress'};
    installInProgress=true;let handoff,committed=false;
    try {
      if(input.confirmed!==true||input.version!==stagedDesktopUpdate?.version)throw Error('update-confirmation-required');
      if(loginManager.isActive()||resumeBatch?.isActive()||bossBatchController?.status().running)throw Error('finish-current-workspace-before-update');
      if(!await canInstallDesktopUpdate())throw Error('installed-windows-version-required');
      const staged=await windowsUpdate.validateStagedUpdate(stagedDesktopUpdate,{directory:updateDirectory(),current:app.getVersion()});
      const record=await windowsUpdate.readInstallation();
      window.webContents.send('update:progress',{phase:'preparing',percent:100});
      handoff=await windowsUpdate.launchUpdateHelper({pid:process.pid,version:staged.version,oldVersion:app.getVersion(),root:record.root,oldExe:process.execPath,userData:app.getPath('userData'),file:staged.file,sha256:staged.sha256,desktop:record.desktop},updateDirectory());
      store.flush();await require('electron').session.defaultSession.cookies.flushStore();
      await handoff.commit();committed=true;
      window.webContents.send('update:progress',{phase:'installing',percent:100});
      setImmediate(()=>app.quit());return {ok:true,status:'handoff-committed',version:staged.version};
    }catch(error){await handoff?.abort().catch(()=>{});window.webContents.send('update:progress',{phase:'failed',message:error.message});return {ok:false,message:error.message};}
    finally{if(!committed)installInProgress=false;}
  });
  ipcMain.handle('settings:update', async (_event, patch) => {
    patch = require('./public-defaults.cjs').normalizeFeedbackPatch(patch);
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
    if (before.wecomWebhook !== next.settings.wecomWebhook) {
      wecomNotify.configure(next.settings.wecomWebhook);
    }
    logger.configure({ diagnosticMode: next.settings.diagnosticLogging === true });
    if (before.kimiBridgeEnabled !== next.settings.kimiBridgeEnabled) {
      if (next.settings.kimiBridgeEnabled === false) stopKimiBridge();
      else await startKimiBridge();
    }
    broadcast();
    return next;
  });
  // —— 企微通知 / Kimi 桥 / Boss 批量（2026-09-20 固化，协议与规则见 doc/specs/2026-09-19 设计 §9/§10）——
  ipcMain.handle('wecom:test', async () => {
    const result = await wecomNotify.notify(`【一键投递】企微通知测试 ✅\n时间：${new Date().toLocaleString('zh-CN')}\n配置成功后，投递事件会从这个通道推送。`);
    return result;
  });
  ipcMain.handle('kimi:status', async () => {
    await kimiBridge?.refresh();
    return kimiBridge?.status() || { running: false, connected: false, port: null, boundAccount: null, transport: 'daemon-http', reason: 'not-started' };
  });
  ipcMain.handle('kimi:restart', async () => {
    stopKimiBridge();
    await startKimiBridge();
    return kimiBridge?.status() || { running: false, connected: false, reason: 'not-started', transport: 'daemon-http' };
  });
  // 临时诊断通道：直通 Kimi 桥发任意 tool（官网投递收尾用，后续会收敛为正式能力）
  ipcMain.handle('debug:kimi', async (_event, request = {}) => {
    if (!kimiBridge) return { error: 'kimi-bridge-unavailable' };
    if ((accountVerificationInProgress || bossBatchStatus().running) && !['list_tabs','snapshot','screenshot'].includes(request.tool)) return { error: 'browser-in-use' };
    try {
      const payload = await kimiBridge.sendTool(request.tool, request.args || {}, { timeoutMs: request.timeoutMs || 45000 });
      return payload;
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('boss:batch:status', () => bossBatchStatus());
  ipcMain.handle('boss:batch:stop', () => stopBossBatch());
  ipcMain.handle('boss:batch:resolve', (_event, request) => resolveBossBatch(request));
  ipcMain.handle('boss:batch:start', (_event, request = {}) => startBossBatch(request));
  // —— 账号管理（代投商业化）——
  ipcMain.handle('account:list', () => listBossAccounts());
  ipcMain.handle('account:create', (_event, request = {}) => createBossAccount(request));
  ipcMain.handle('account:select', (_event, request = {}) => selectBossAccount(request.accountId));
  ipcMain.handle('account:launch', (_event, request = {}) => {
    const acc = (store.get().accounts || []).find((a) => a.id === request.accountId);
    if (!acc) return { error: 'account-not-found' };
    if (request.startUrl) {
      return ensureAccountBrowsers().launch(acc, { startUrl: request.startUrl });
    }
    return ensureAccountBrowsers().launch(acc);
  });
  ipcMain.handle('account:close', (_event, request = {}) => ensureAccountBrowsers().close(request.accountId));
  ipcMain.handle('account:verify', (_event, request = {}) => verifyAccountBinding(request.accountId));
  ipcMain.handle('account:update-phone', (_event, request = {}) => updateBossAccountPhone(request));
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
  ipcMain.handle('log:get', () => diagnosticEntries(logger.recent()));

  // 嵌入式登录（见 login-manager.cjs）
  ipcMain.handle('login:open', (_event, companyId, recruitType = 'social') => resumeSyncExecutionQueue.run(async () => {
    const company = store.get().companies.find((item) => item.id === companyId);
    if (!company) throw new Error('未找到公司');
    logger.info('打开嵌入式登录', { company: company.name, portal: company.portal });
    return loginManager.openLoginView(company, normalizeTrack(recruitType));
  }));
  ipcMain.handle('login:close', () => resumeSyncExecutionQueue.run(async () => {
    logger.info('关闭嵌入式登录');
    await loginManager.closeLoginView();
    return { ok: true };
  }));
  ipcMain.handle('login:restart', () => resumeSyncExecutionQueue.run(() => loginManager.restartLogin()));
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
        const previousApplied = state.applied || [];
      state.applied = next.applied;
      career.recordConfirmed(state, previousApplied);
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
      const previousApplied = state.applied || [];
      state.applied = next.applied;
      career.recordConfirmed(state, previousApplied);
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
let drainingLogs = false, logsDrained = false;
app.on('before-quit', (event) => {
  if (!logsDrained) {
    event.preventDefault();
    if (!drainingLogs) { drainingLogs = true; logger.close().finally(() => { logsDrained = true; app.quit(); }); }
    return;
  }
  try { loginManager.closeWorkspaceIfOpen(); } catch {}
});

app.on('activate', () => {
  if (ownsProfile && BrowserWindow.getAllWindows().length === 0) createWindow();
});
