// 可见浏览器工作区
//
// 登录、简历核对和投递核对统一复用挂载在主窗口内的 WebContentsView。
// 每家公司使用 persist:<companyId> session，关闭前刷新 cookie 与存储。

const { WebContentsView, session } = require('electron');
const { calculateWorkspaceBounds } = require('./workspace-layout.cjs');
const {
  assertAllowedWorkspaceUrl,
  isAllowedWorkspaceUrl,
  isRecoverableNavigationAbort
} = require('./navigation-policy.cjs');

let currentView = null;
let currentCompanyId = null;
let currentMode = null;
let currentTitle = null;
let currentContext = null;
let parentWindow = null;
let onChangeCallback = null;
// 当前工作区打开的 SSO 弹窗子窗口（与主视图共用 persist:<companyId> 分区）
const popupWindows = new Set();

// 控制条放顶部：顶部位置稳定（紧贴标题栏），且原生 view 不覆盖顶部，按钮 100% 可见可点；
// 放底部时一旦 bounds 算偏或腾讯页内底部有「返回首页」按钮，用户就找不到「取消」。
const SNAPSHOT_TEXT_LIMIT = 2400;

// 标准 macOS Chrome UA：去掉 Electron 标识，避免招聘站 WAF 拦截
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const CHROME_UA_PREFIX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/';
const CHROME_SEC_CH_UA = '"Google Chrome";v="132", "Chromium";v="132", "Not_A Brand";v="99"';

function setParent(win) {
  parentWindow = win;
  // 任何可能改变窗口内容区尺寸的事件都要刷新 bounds，否则原生 view 会停在旧尺寸/旧位置。
  // resize 覆盖大部分；maximize/unmaximize/fullscreen 在某些 macOS 版本不冒泡到 resize，显式补上。
  for (const evt of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(evt, () => updateBounds());
  }
}

function updateBounds() {
  if (!currentView || !parentWindow || parentWindow.isDestroyed()) return;
  // 必须用 getContentSize()：它返回的是「内容区」尺寸（不含原生标题栏/边框），
  // 而 getSize() 返回外框尺寸——WebContentsView 的 bounds 是相对内容区的。
  // 用 getSize 会让 view 偏高 ~28px，盖住顶部红绿黄交通灯。
  const [contentW, contentH] = parentWindow.getContentSize();
  currentView.setBounds(calculateWorkspaceBounds(contentW, contentH));
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
  // 某些 Electron 版本/会话状态下 flushStore/flushStorageData 可能返回 undefined 而非 Promise，
  // 对 undefined 调 .catch 会抛「Cannot read properties of undefined (reading 'catch')」。
  // 用 Promise.resolve 包一层，保证永远是 thenable。
  await Promise.resolve(activeSession.cookies.flushStore()).catch(() => {});
  await Promise.resolve(activeSession.flushStorageData()).catch(() => {});
}

function destroyCurrentView() {
  // 先关掉本工作区拉起的 SSO 弹窗子窗口，避免留下游离的原生窗口
  for (const popup of popupWindows) {
    if (!popup.isDestroyed()) popup.destroy();
  }
  popupWindows.clear();
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

// 幂等关闭：view 不存在时直接 resolve，不抛错、不广播。
// 供 adapter 在失败分支（404/抛错）安全调用，避免「必关未关」泄漏原生页。
async function closeWorkspaceIfOpen() {
  if (!currentView) return;
  await closeWorkspace();
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
  // 程序主动 loadURL 不依赖 will-navigate 兜底：创建带持久登录分区的 view 前先做平台官网白名单校验。
  assertAllowedWorkspaceUrl(company.id, url);
  if (currentView) {
    const error = new Error('当前有网页正在登录或核对，请先点顶部“完成”或“取消并返回”');
    error.code = 'WORKSPACE_ACTIVE';
    throw error;
  }

  currentCompanyId = company.id;
  currentMode = mode;
  currentTitle = title;
  currentContext = context;
  // 百度 talent 等站点的 WAF 会拦截带 Electron 标识的 UA（返回 illegal-visit）。
  // 分区统一伪装成主流 macOS Chrome UA，并把 sec-ch-ua 客户端提示头对齐，
  // 避免「UA 说 Chrome/132、sec-ch-ua 说 Chromium/43」的自相矛盾被风控识别。
  const persistSession = session.fromPartition(`persist:${company.id}`);
  if (!persistSession.getUserAgent().startsWith(CHROME_UA_PREFIX)) {
    persistSession.setUserAgent(CHROME_UA);
  }
  // 请求头对齐每次注册（onBeforeSendHeaders 是单监听器，重复注册幂等）
  persistSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (headers['sec-ch-ua'] || headers['Sec-CH-UA']) {
      headers['sec-ch-ua'] = CHROME_SEC_CH_UA;
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"macOS"';
    }
    callback({ requestHeaders: headers });
  });
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

  // SSO 弹窗子窗口：微信扫码等登录流需要真正的 window.open 弹窗（window.opener/postMessage 回调才成立），
  // 且子窗口必须共用同一 persist:<companyId> 分区，Cookie 才会写进我们的登录态而不是丢失。
  // 只允许白名单内的 URL 开子窗口；未知域名仍然一律拦截。
  for (const popup of popupWindows) {
    if (!popup.isDestroyed()) popup.destroy();
  }
  popupWindows.clear();
  currentView.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    if (isAllowedWorkspaceUrl(company.id, popupUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 480,
          height: 640,
          title: `${company.name || company.id} 登录`,
          webPreferences: {
            partition: `persist:${company.id}`,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
          }
        }
      };
    }
    // 未知域名一律拦截；官网不能在无用户确认时强制拉起外部网站。
    return { action: 'deny' };
  });
  currentView.webContents.on('did-create-window', (childWindow) => {
    popupWindows.add(childWindow);
    const enforceChildPolicy = (event, targetUrl) => {
      if (isAllowedWorkspaceUrl(company.id, targetUrl)) return;
      event.preventDefault();
    };
    childWindow.webContents.on('will-navigate', enforceChildPolicy);
    childWindow.webContents.on('will-redirect', enforceChildPolicy);
    childWindow.on('closed', () => popupWindows.delete(childWindow));
    // 子窗口登录完成后通常自关闭；主视图跳转时要刷新状态
    childWindow.webContents.on('did-navigate', notifyChange);
  });
  const enforceNavigationPolicy = (event, targetUrl) => {
    if (isAllowedWorkspaceUrl(company.id, targetUrl)) return;
    event.preventDefault();
  };
  currentView.webContents.on('will-navigate', enforceNavigationPolicy);
  currentView.webContents.on('will-redirect', enforceNavigationPolicy);

  currentView.webContents.on('did-navigate', notifyChange);
  currentView.webContents.on('did-navigate-in-page', notifyChange);

  try {
    await currentView.webContents.loadURL(url);
    notifyChange();
    return getStatus();
  } catch (error) {
    // Electron 在某些服务端/JS 重定向中会让初始 loadURL 以 ERR_ABORTED 结束，
    // 即使 WebContents 已经正常落到白名单内的登录页。此时保留工作区给用户登录；
    // 其他错误或越域落点仍立即关闭，不扩大导航权限。
    const landedUrl = getCurrentUrl();
    if (isRecoverableNavigationAbort(error, company.id, landedUrl)) {
      notifyChange();
      return getStatus();
    }
    await closeWorkspace();
    throw new Error(`打开网页失败：${error.message}`);
  }
}

function openLoginView(company) {
  const { resolvePlatformUrl } = require('./platform-manifests.cjs');
  return openWorkspace({
    company,
    url: resolvePlatformUrl(company.id, 'social', 'login'),
    mode: 'login',
    title: `登录 ${company.name}`,
    context: { action: 'login', companyId: company.id }
  });
}

async function run(script) {
  if (!currentView?.webContents || currentView.webContents.isDestroyed()) {
    throw new Error('浏览器工作区未打开');
  }
  // 页面在脚本执行期间跳转（如重定向到登录页）会让 executeJavaScript 的 Promise 永远不 settle。
  // 必须加超时兜底，否则一键更新会永久卡在当前站点。
  const SCRIPT_TIMEOUT_MS = 15000;
  return Promise.race([
    currentView.webContents.executeJavaScript(script),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('页面脚本执行超时（页面可能正在跳转），请稍后重试')), SCRIPT_TIMEOUT_MS);
    })
  ]);
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
  closeWorkspaceIfOpen,
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
