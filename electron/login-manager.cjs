// 可见浏览器工作区
//
// 登录、简历核对和投递核对统一复用挂载在主窗口内的 WebContentsView。
// 每家公司使用 persist:<companyId> session，关闭前刷新 cookie 与存储。

const { WebContentsView, session } = require('electron');
const { attachStealth } = require('./captcha.cjs');

let currentView = null;
let currentCompanyId = null;
let currentMode = null;
let currentTitle = null;
let currentContext = null;
let parentWindow = null;
let onChangeCallback = null;
let stealthCleanup = null;

const SIDEBAR_WIDTH = 248;
const TOP_OFFSET = 0;       // workspace 激活时前端会隐藏 sidebar，view 从顶部 0 开始铺满
const BOTTOM_BAR_HEIGHT = 56; // 底部留出空间给「取消/完成」控制条（原生 view 盖 HTML，放底部避免被盖）
const SNAPSHOT_TEXT_LIMIT = 2400;

function setParent(win) {
  parentWindow = win;
  win.on('resize', () => updateBounds());
}

function updateBounds() {
  if (!currentView || !parentWindow || parentWindow.isDestroyed()) return;
  const [winW, winH] = parentWindow.getSize();
  // workspace 激活时：view 铺满除底部控制条外的整个窗口（前端会隐藏 sidebar）。
  // 底部留 BOTTOM_BAR_HEIGHT 给「取消/完成」原生 HTML 控制条——原生 view 盖 HTML，
  // 把控制条放底部、view 不覆盖底部，才能保证按钮可点。
  currentView.setBounds({
    x: 0,
    y: 0,
    width: Math.max(0, winW),
    height: Math.max(0, winH - BOTTOM_BAR_HEIGHT)
  });
}

function onChange(callback) {
  onChangeCallback = callback;
}

// 暴露当前 webContents，供 captcha 等需要直接操作页面的模块使用。
// 调用方负责判空和 isDestroyed 检查。
function getWebContents() {
  return currentView?.webContents || null;
}

function getCurrentUrl() {
  return currentView?.webContents?.getURL?.() || '';
}

function getStatus() {
  return {
    active: Boolean(currentView),
    companyId: currentCompanyId,
    mode: currentMode,
    title: currentTitle,
    url: getCurrentUrl(),
    context: currentContext
  };
}

function notifyChange() {
  if (onChangeCallback) onChangeCallback(getStatus());
}

async function flushCurrentSession() {
  if (!currentCompanyId) return;
  const activeSession = session.fromPartition(`persist:${currentCompanyId}`);
  await activeSession.cookies.flushStore().catch(() => {});
  await activeSession.flushStorageData().catch(() => {});
}

function destroyCurrentView() {
  if (stealthCleanup) { try { stealthCleanup(); } catch (e) {} stealthCleanup = null; }
  if (currentView && parentWindow && !parentWindow.isDestroyed()) {
    parentWindow.contentView.removeChildView(currentView);
  }
  if (currentView?.webContents && !currentView.webContents.isDestroyed()) {
    currentView.webContents.destroy();
  }
  currentView = null;
  currentCompanyId = null;
  currentMode = null;
  currentTitle = null;
  currentContext = null;
}

async function closeWorkspace() {
  if (!currentView) return;
  await flushCurrentSession();
  destroyCurrentView();
  notifyChange();
}

async function openWorkspace({
  company,
  url = company?.portal,
  mode = 'browse',
  title = company?.name || '浏览器工作区',
  context = null
}) {
  if (!parentWindow || parentWindow.isDestroyed()) throw new Error('主窗口未就绪');
  if (!company?.id) throw new Error('缺少公司信息');
  if (!/^https?:\/\//.test(url || '')) throw new Error('工作区只允许打开 http(s) 链接');

  await closeWorkspace();

  currentCompanyId = company.id;
  currentMode = mode;
  currentTitle = title;
  currentContext = context;
  currentView = new WebContentsView({
    webPreferences: {
      partition: `persist:${company.id}`,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  parentWindow.contentView.addChildView(currentView);
  updateBounds();
  notifyChange();

  // 注入 stealth（隐藏 webdriver 等自动化特征，让腾讯 tcaptcha 尽量不弹验证码）
  stealthCleanup = attachStealth(currentView.webContents);

  currentView.webContents.on('did-navigate', notifyChange);
  currentView.webContents.on('did-navigate-in-page', notifyChange);

  try {
    await currentView.webContents.loadURL(url);
    notifyChange();
    return getStatus();
  } catch (error) {
    await closeWorkspace();
    throw new Error(`打开网页失败：${error.message}`);
  }
}

function openLoginView(company) {
  return openWorkspace({
    company,
    url: company.portal,
    mode: 'login',
    title: `登录 ${company.name}`,
    context: { action: 'login', companyId: company.id }
  });
}

async function run(script) {
  if (!currentView?.webContents || currentView.webContents.isDestroyed()) {
    throw new Error('浏览器工作区未打开');
  }
  return currentView.webContents.executeJavaScript(script);
}

async function snapshot() {
  if (!currentView) return null;
  return run(`(() => ({
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || '').slice(0, ${SNAPSHOT_TEXT_LIMIT})
  }))()`).catch(() => ({
    url: getCurrentUrl(),
    title: '',
    text: ''
  }));
}

async function finishWorkspace() {
  const status = getStatus();
  const page = await snapshot();
  await closeWorkspace();
  return { status, snapshot: page };
}

async function cancelWorkspace() {
  const status = getStatus();
  await closeWorkspace();
  return { status: 'cancelled', workspace: status };
}

async function detectLogin(detector) {
  if (!currentView) return false;
  try {
    return Boolean(await run(`(function(){ try { return ${detector}; } catch(e){ return false; } })()`));
  } catch {
    return false;
  }
}

module.exports = {
  setParent,
  openWorkspace,
  openLoginView,
  closeWorkspace,
  closeLoginView: closeWorkspace,
  finishWorkspace,
  cancelWorkspace,
  run,
  snapshot,
  getStatus,
  getWebContents,
  isActive: () => Boolean(currentView),
  getActiveCompanyId: () => currentCompanyId,
  getCurrentUrl,
  detectLogin,
  onChange
};
