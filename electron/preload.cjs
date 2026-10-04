const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oneClick', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveResume: (resume) => ipcRenderer.invoke('resume:save', resume),
  switchProfile: (profileId) => ipcRenderer.invoke('resume:switch-profile', profileId),
  addProfile: (label) => ipcRenderer.invoke('resume:add-profile', label),
  deleteProfile: (profileId) => ipcRenderer.invoke('resume:delete-profile', profileId),
  renameProfile: (profileId, label) => ipcRenderer.invoke('resume:rename-profile', profileId, label),
  exportResumeJson: () => ipcRenderer.invoke('resume:export-json'),
  exportJsonResume: () => ipcRenderer.invoke('resume:export-jsonresume'),
  importResumeJson: () => ipcRenderer.invoke('resume:import-json'),
  fillResumeToTencent: () => ipcRenderer.invoke('resume:fill-tencent'),
  fillResumeToAll: (startCompanyId, resumeSyncGeneration) => ipcRenderer.invoke('resume:fill-all', { startCompanyId, resumeSyncGeneration }),
  resumeBatchCatalog: () => ipcRenderer.invoke('resume:batch-catalog'),
  resumeBatchStart: request => ipcRenderer.invoke('resume:batch-start', request),
  resumeBatchAction: request => ipcRenderer.invoke('resume:batch-action', request),
  onResumeBatchChanged: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('resume:batch-changed', listener);
    return () => ipcRenderer.removeListener('resume:batch-changed', listener);
  },
  getResumeSyncStatus: () => ipcRenderer.invoke('resume:sync-status'),
  onFillLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('resume:fill-log', listener);
    return () => ipcRenderer.removeListener('resume:fill-log', listener);
  },
  toggleFavorite: (jobId) => ipcRenderer.invoke('job:favorite', jobId),
  toggleCart: (jobId) => ipcRenderer.invoke('cart:toggle', jobId),
  applyCart: () => ipcRenderer.invoke('cart:apply'),
  refreshAppliedStatus: () => ipcRenderer.invoke('applied:refresh-status'),
  refreshJobs: () => ipcRenderer.invoke('jobs:refresh'),
  openCompany: (companyId) => ipcRenderer.invoke('company:open', companyId),
  syncEmail: (credentials) => ipcRenderer.invoke('email:sync', credentials),
  checkUpdate: (info) => ipcRenderer.invoke('update:check', info),
  downloadUpdate: (info) => ipcRenderer.invoke('update:download', info),
  installUpdate: info => ipcRenderer.invoke('update:install', info),
  updateInstallStatus: () => ipcRenderer.invoke('update:install-status'),
  onUpdateProgress: callback => {
    const handler=(_event,progress)=>callback(progress);
    ipcRenderer.on('update:progress',handler);
    return ()=>ipcRenderer.removeListener('update:progress',handler);
  },
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  openFeedback: kind=>ipcRenderer.invoke('feedback:open',kind),
  feedbackMetadata: ()=>ipcRenderer.invoke('feedback:metadata'),
  sendFeedback: input=>ipcRenderer.invoke('feedback:submit',input),
  checkFeedbackReceipt: ()=>ipcRenderer.invoke('feedback:receipt'),
  closeFeedback: ()=>ipcRenderer.invoke('feedback:close'),
  dismissPromotion: ()=>ipcRenderer.invoke('promo:dismiss'),
  // 企微通知 / Kimi 桥 / Boss 批量（2026-09-20）
  testWecomNotify: () => ipcRenderer.invoke('wecom:test'),
  kimiStatus: () => ipcRenderer.invoke('kimi:status'),
  kimiRestart: () => ipcRenderer.invoke('kimi:restart'),
  bossBatchStart: (request) => ipcRenderer.invoke('boss:batch:start', request),
  bossBatchStop: () => ipcRenderer.invoke('boss:batch:stop'),
  bossBatchResolve: (request) => ipcRenderer.invoke('boss:batch:resolve', request),
  bossBatchStatus: () => ipcRenderer.invoke('boss:batch:status'),
  debugKimi: (request) => ipcRenderer.invoke('debug:kimi', request),
  // 账号管理（Boss 代投商业化，2026-09-22）
  accountList: () => ipcRenderer.invoke('account:list'),
  accountCreate: (request) => ipcRenderer.invoke('account:create', request),
  accountSelect: (accountId) => ipcRenderer.invoke('account:select', { accountId }),
  accountLaunch: (accountId, startUrl) => ipcRenderer.invoke('account:launch', { accountId, startUrl }),
  accountClose: (accountId) => ipcRenderer.invoke('account:close', { accountId }),
  accountVerify: (accountId) => ipcRenderer.invoke('account:verify', { accountId }),
  exportSnapshot: () => ipcRenderer.invoke('snapshot:export'),
  exportApplied: () => ipcRenderer.invoke('applied:export'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  resetAgentToken: () => ipcRenderer.invoke('agent:reset-token'),
  showItem: (path) => ipcRenderer.invoke('item:show', path),
  getLogs: () => ipcRenderer.invoke('log:get'),
  getDataPath: () => ipcRenderer.invoke('app:data-path'),
  openLogin: (companyId, recruitType = 'social') => ipcRenderer.invoke('login:open', companyId, recruitType),
    closeLogin: () => ipcRenderer.invoke('login:close'),
    restartLogin: () => ipcRenderer.invoke('login:restart'),
  loginStatus: () => ipcRenderer.invoke('login:status'),
  // 简历附件文件管理（用户上传自己设计的简历 PDF/DOC）
  uploadResumeFile: () => ipcRenderer.invoke('resume:upload-file'),
  getResumeFilePath: () => ipcRenderer.invoke('resume:get-file-path'),
  listResumeFiles: () => ipcRenderer.invoke('resume:list-files'),
  deleteResumeFile: (filename) => ipcRenderer.invoke('resume:delete-file', filename),
  workspaceStatus: () => ipcRenderer.invoke('workspace:status'),
  finishWorkspace: ({ resumeSyncGeneration } = {}) => ipcRenderer.invoke('workspace:finish', { resumeSyncGeneration }),
  cancelWorkspace: ({ resumeSyncGeneration } = {}) => ipcRenderer.invoke('workspace:cancel', { resumeSyncGeneration }),
  onWorkspaceChanged: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.removeListener('workspace:changed', handler);
  },
  onStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  }
});
