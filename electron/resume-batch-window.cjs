const { BrowserWindow, screen } = require('electron');
const { createLoginManager } = require('./login-manager.cjs');
const { tileBounds } = require('./resume-batch.cjs');
const {inspectWorkspace}=require('./workspace-diagnostics.cjs');

async function createResumeBatchWindow(parent, target, index, count, onClose, onReadiness) {
  const area = screen.getDisplayMatching(parent.getBounds()).workArea;
  const bounds = tileBounds(area, count, index);
  bounds.x += 4; bounds.y += 4; bounds.width -= 8; bounds.height -= 8;
  const title = `${target.name} · ${target.resumeRecruitType === 'social' ? '社招' : '校招/实习'} · 简历核对`;
  const win = new BrowserWindow({ ...bounds, show: false, title, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const manager = createLoginManager({ fitViewport: true, boundsForWindow: (w, h) => ({ x: 0, y: 52, width: w, height: Math.max(0, h - 52) }) });
  manager.setParent(win);
  const escapedTitle = title.replace(/[<>&"']/g, '');
  // Local header only: no preload/IPC or navigation changes in official frames.
  win.webContents.on('will-navigate',(event,url)=>{
    event.preventDefault();
    if(url==='yjt-view://fit'&&manager.getStatus().viewport)void manager.setViewportMode('fit');
    else if(url==='yjt-view://actual'&&manager.getStatus().viewport)void manager.setViewportMode('actual');
    else if(url==='yjt-view://expand'){if(win.isMaximized())win.unmaximize();else win.maximize();}
  });
  let monitorTimer=null,monitorEpoch=0;
  manager.onChange(status => {
    if(!win.isDestroyed()&&status.viewport){const s=status.viewport;const text=s.error?'适应未完成，请放大窗口':s.pending?'正在适应…':s.tooSmall?'屏幕较小，请放大窗口':`${s.mode==='fit'?'自动适应':'原始大小'} ${Math.round(s.scale*100)}%`;void win.webContents.executeJavaScript(`(()=>{const e=document.getElementById('viewportStatus');if(e)e.textContent=${JSON.stringify(text)};})()`).catch(()=>{});}
    const epoch=++monitorEpoch;clearTimeout(monitorTimer);
    if(status.active&&status.mode==='resume-review'&&onReadiness)monitorTimer=setTimeout(async()=>{const state=await inspectWorkspace(manager);if(epoch===monitorEpoch&&!win.isDestroyed())onReadiness(state);},1200);
    const last = status.diagnostics?.at(-1);
    if ((!last && !status.auth) || win.isDestroyed()) return;
    const text = status.auth?.message || `登录诊断：${last.kind} ${last.origin}${last.path || ''}；当前页面已保留`;
    void win.webContents.executeJavaScript(`(()=>{const e=document.getElementById('workspaceNotice');if(e)e.textContent=${JSON.stringify(text)};})()`).catch(() => {});
  });
  let disposed = false;
  async function dispose() {
    if (disposed) return;
    disposed = true;clearTimeout(monitorTimer);monitorEpoch++;
    try { await manager.closeWorkspaceIfOpen(); }
    finally { if (!win.isDestroyed()) win.destroy(); }
  }
  win.on('close', event => { event.preventDefault(); onClose(); });
  parent.once('closed', dispose);
  win.once('closed', () => parent.removeListener('closed', dispose));
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>${escapedTitle}</title><style>body{margin:0;background:#f5f3ee;font:13px system-ui;color:#333}header{padding:4px 10px;line-height:20px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 8px}b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}nav{display:flex;gap:8px}a{color:#5548ba;text-decoration:none}a:focus-visible{outline:2px solid #5548ba}#viewportStatus{font-size:11px}#workspaceNotice{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><header><b>${escapedTitle}</b><nav><a href="yjt-view://fit">适应</a><a href="yjt-view://actual">100%</a><a href="yjt-view://expand">放大/还原</a></nav><span id="workspaceNotice">Alt+Tab 回主窗；关闭继续队列。</span><span id="viewportStatus">自动适应</span></header>`));
    if (disposed || parent.isDestroyed()) throw new Error('主窗口已关闭');
  } catch (error) { await dispose(); throw error; }
  if (process.env.YIJIAN_BACKGROUND_TEST !== '1') win.showInactive();
  return { ...manager, dispose, focus: () => { if (!win.isDestroyed()) { win.show(); win.focus(); } } };
}
module.exports = { createResumeBatchWindow };

