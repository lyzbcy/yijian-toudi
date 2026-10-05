const { BrowserWindow, screen } = require('electron');
const { createLoginManager } = require('./login-manager.cjs');
const { tileBounds } = require('./resume-batch.cjs');
const path = require('node:path');

async function createResumeBatchWindow(parent, target, index, count, onClose) {
  const area = screen.getDisplayMatching(parent.getBounds()).workArea;
  const bounds = tileBounds(area, count, index);
  bounds.x += 4; bounds.y += 4; bounds.width -= 8; bounds.height -= 8;
  const title = `${target.name} · ${target.resumeRecruitType === 'social' ? '社招' : '校招/实习'} · 简历核对`;
  const win = new BrowserWindow({ ...bounds, show: false, title, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'src', 'assets', 'stickers', 'mascot.png'),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#f5f6fa', symbolColor: '#52566f', height: 40 } } : {}),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const manager = createLoginManager({ boundsForWindow: (w, h) => ({ x: 0, y: 52, width: w, height: Math.max(0, h - 52) }) });
  manager.setParent(win);
  const escapedTitle = title.replace(/[<>&"']/g, '');
  manager.onChange(status => {
    const last = status.diagnostics?.at(-1);
    if ((!last && !status.auth) || win.isDestroyed()) return;
    const text = status.auth?.message || `登录诊断：${last.kind} ${last.origin}${last.path || ''}；当前页面已保留`;
    void win.webContents.executeJavaScript(`(()=>{const e=document.getElementById('workspaceNotice');if(e)e.textContent=${JSON.stringify(text)};})()`).catch(() => {});
  });
  let disposed = false;
  async function dispose() {
    if (disposed) return;
    disposed = true;
    try { await manager.closeWorkspaceIfOpen(); }
    finally { if (!win.isDestroyed()) win.destroy(); }
  }
  win.on('close', event => { event.preventDefault(); onClose(); });
  parent.once('closed', dispose);
  win.once('closed', () => parent.removeListener('closed', dispose));
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>${escapedTitle}</title><style>body{margin:0;background:#f5f6fa;font:12px system-ui;color:#52566f}header{box-sizing:border-box;height:52px;padding:6px ${process.platform === 'win32' ? 148 : 12}px 6px 12px;line-height:20px;-webkit-app-region:drag}b,#workspaceNotice{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}b{color:#202236;font-size:13px}#workspaceNotice{font-size:11px}</style><header><b>${escapedTitle}</b><span id="workspaceNotice">Alt+Tab 回主窗口重试；关闭窗口继续队列。可最大化。</span></header>`));
    if (disposed || parent.isDestroyed()) throw new Error('主窗口已关闭');
  } catch (error) { await dispose(); throw error; }
  if (process.env.YIJIAN_BACKGROUND_TEST !== '1') win.showInactive();
  return { ...manager, dispose, focus: () => { if (!win.isDestroyed()) { win.show(); win.focus(); } } };
}
module.exports = { createResumeBatchWindow };
