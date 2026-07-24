// 嵌入式登录管理器
//
// 在主窗口内嵌入招聘官网（WebContentsView），用户在里面登录，
// 登录态通过 persist:<companyId> session 隔离并持久化，后续投递复用。
//
// 设计（见 doc/specs 子项目 C）：
//   - BrowserView 在 Electron 30 废弃，这里用 WebContentsView（Electron 43 验证可用）
//   - 通过 window.contentView.addChildView(view) 嵌入现有 BrowserWindow
//   - view 覆盖主区域（留出侧边栏宽度 248px + 顶栏高度）
//   - 每家公司独立 session.fromPartition('persist:<companyId>')，cookie 隔离持久化

const { WebContentsView, session } = require('electron');

let currentView = null;
let currentCompanyId = null;
let parentWindow = null;
let onChangeCallback = null;

// 侧边栏宽度 + 主区域内边距（与 styles.css 的 .sidebar width 和 .main padding 对齐）
const SIDEBAR_WIDTH = 248;
const TOP_OFFSET = 52; // 嵌入视图顶部的控制条高度

function setParent(win) {
  parentWindow = win;
  // 窗口 resize 时同步调整嵌入视图大小
  win.on('resize', () => updateBounds());
}

function updateBounds() {
  if (!currentView || !parentWindow || parentWindow.isDestroyed()) return;
  const [winW, winH] = parentWindow.getSize();
  // 视图占据侧边栏右侧的主区域，顶部留出控制条空间
  currentView.setBounds({
    x: SIDEBAR_WIDTH,
    y: TOP_OFFSET,
    width: Math.max(0, winW - SIDEBAR_WIDTH),
    height: Math.max(0, winH - TOP_OFFSET)
  });
}

function onChange(cb) {
  onChangeCallback = cb;
}

function notifyChange() {
  if (onChangeCallback) onChangeCallback({ activeCompanyId: currentCompanyId });
}

/**
 * 打开某公司的嵌入式登录视图
 * @param {Object} company { id, name, portal }
 */
function openLoginView(company) {
  if (!parentWindow || parentWindow.isDestroyed()) throw new Error('主窗口未就绪');
  // 已有视图先关掉
  closeLoginView();

  // 每家公司独立 session，登录态隔离持久化（重启后保留）
  const partition = `persist:${company.id}`;
  const ses = session.fromPartition(partition);

  currentView = new WebContentsView({ session: ses });
  currentCompanyId = company.id;
  parentWindow.contentView.addChildView(currentView);
  currentView.webContents.loadURL(company.portal);
  updateBounds();
  notifyChange();
  return { ok: true, companyId: company.id, url: company.portal };
}

// 关闭登录视图：必须先 flush session（把 cookie 写盘），否则登录态会丢
async function closeLoginView() {
  if (!currentView) return;
  // 先 flush 当前 session 的 cookie 到磁盘
  const partition = currentCompanyId ? `persist:${currentCompanyId}` : null;
  if (partition) {
    const ses = session.fromPartition(partition);
    await ses.cookies.flushStore().catch(() => {});
    await ses.flushStorageData().catch(() => {});
  }
  if (parentWindow && !parentWindow.isDestroyed()) {
    parentWindow.contentView.removeChildView(currentView);
  }
  if (currentView?.webContents && !currentView.webContents.isDestroyed()) {
    currentView.webContents.destroy();
  }
  currentView = null;
  currentCompanyId = null;
  notifyChange();
}

function isActive() {
  return currentView !== null;
}

function getActiveCompanyId() {
  return currentCompanyId;
}

/**
 * 检测当前嵌入视图的登录状态。
 * @param {string} detector 可执行的 JS 表达式，返回 truthy 表示已登录
 * @returns {Promise<boolean>}
 */
async function detectLogin(detector) {
  if (!currentView) return false;
  try {
    const result = await currentView.webContents.executeJavaScript(`(function(){ try { return ${detector}; } catch(e){ return false; } })()`);
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * 获取当前视图的 URL（用于前端显示地址栏）
 */
function getCurrentUrl() {
  return currentView?.webContents?.getURL?.() || '';
}

module.exports = {
  setParent,
  openLoginView,
  closeLoginView,
  isActive,
  getActiveCompanyId,
  detectLogin,
  getCurrentUrl,
  onChange
};
