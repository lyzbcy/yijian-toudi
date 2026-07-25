const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oneClick', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveResume: (resume) => ipcRenderer.invoke('resume:save', resume),
  switchProfile: (profileId) => ipcRenderer.invoke('resume:switch-profile', profileId),
  addProfile: (label) => ipcRenderer.invoke('resume:add-profile', label),
  deleteProfile: (profileId) => ipcRenderer.invoke('resume:delete-profile', profileId),
  renameProfile: (profileId, label) => ipcRenderer.invoke('resume:rename-profile', profileId, label),
  fillResumeToTencent: () => ipcRenderer.invoke('resume:fill-tencent'),
  fillResumeToAll: () => ipcRenderer.invoke('resume:fill-all'),
  getResumeSyncStatus: () => ipcRenderer.invoke('resume:sync-status'),
  toggleFavorite: (jobId) => ipcRenderer.invoke('job:favorite', jobId),
  toggleCart: (jobId) => ipcRenderer.invoke('cart:toggle', jobId),
  applyCart: () => ipcRenderer.invoke('cart:apply'),
  refreshAppliedStatus: () => ipcRenderer.invoke('applied:refresh-status'),
  refreshJobs: () => ipcRenderer.invoke('jobs:refresh'),
  openCompany: (companyId) => ipcRenderer.invoke('company:open', companyId),
  syncEmail: (credentials) => ipcRenderer.invoke('email:sync', credentials),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (info) => ipcRenderer.invoke('update:download', info),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  exportSnapshot: () => ipcRenderer.invoke('snapshot:export'),
  exportApplied: () => ipcRenderer.invoke('applied:export'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  resetAgentToken: () => ipcRenderer.invoke('agent:reset-token'),
  showItem: (path) => ipcRenderer.invoke('item:show', path),
  getLogs: () => ipcRenderer.invoke('log:get'),
  getDataPath: () => ipcRenderer.invoke('app:data-path'),
  openLogin: (companyId) => ipcRenderer.invoke('login:open', companyId),
  closeLogin: () => ipcRenderer.invoke('login:close'),
  loginStatus: () => ipcRenderer.invoke('login:status'),
  workspaceStatus: () => ipcRenderer.invoke('workspace:status'),
  finishWorkspace: () => ipcRenderer.invoke('workspace:finish'),
  cancelWorkspace: () => ipcRenderer.invoke('workspace:cancel'),
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
