const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oneClick', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveResume: (resume) => ipcRenderer.invoke('resume:save', resume),
  toggleFavorite: (jobId) => ipcRenderer.invoke('job:favorite', jobId),
  refreshJobs: () => ipcRenderer.invoke('jobs:refresh'),
  openCompany: (companyId) => ipcRenderer.invoke('company:open', companyId),
  syncEmail: (credentials) => ipcRenderer.invoke('email:sync', credentials),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  exportSnapshot: () => ipcRenderer.invoke('snapshot:export'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  showItem: (path) => ipcRenderer.invoke('item:show', path),
  onStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  }
});
