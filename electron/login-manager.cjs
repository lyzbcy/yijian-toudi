// 可见浏览器工作区
//
// 登录、简历核对和投递核对统一复用挂载在主窗口内的 WebContentsView。
// 每家公司使用 persist:<companyId> session，关闭前刷新 cookie 与存储。

const { WebContentsView, session, webFrameMain } = require('electron');
const { calculateWorkspaceBounds } = require('./workspace-layout.cjs');
const { createJdAuthReturnTracker } = require('./jd-auth-return.cjs');
const { navigateOriginalFrame } = require('./frame-navigation.cjs');
const { createJdAuthStatus } = require('./jd-auth-status.cjs');
const {
  assertAllowedWorkspaceUrl,
  isAllowedWorkspaceUrl,
  createWorkspaceNavigationPolicy,
  isRecoverableNavigationAbort
} = require('./navigation-policy.cjs');

function createLoginManager({ boundsForWindow, authTiming = {} } = {}) {
let externalBusy = () => false;
let currentView = null;
let currentCompanyId = null;
let currentMode = null;
let currentTitle = null;
let currentContext = null;
let parentWindow = null;
let onChangeCallback = null;
let authMonitor = null, authPollTimer = null, currentRequest = null;
let checkCurrentAuth = null;
// 当前工作区打开的 SSO 弹窗子窗口（与主视图共用 persist:<companyId> 分区）
const popupWindows = new Set();
const closeTasks = new WeakMap();
function assertWorkspace(view) {
  if(view && currentView===view && !view.webContents.isDestroyed()) return;
  const error=new Error('原网页已关闭或切换，请在当前窗口重新操作');
  error.code='WORKSPACE_SUPERSEDED';throw error;
}

// 控制条放顶部：顶部位置稳定（紧贴标题栏），且原生 view 不覆盖顶部，按钮 100% 可见可点；
// 放底部时一旦 bounds 算偏或腾讯页内底部有「返回首页」按钮，用户就找不到「取消」。
const SNAPSHOT_TEXT_LIMIT = 2400;

// Keep Chromium's actual platform/version and client hints consistent.
// Do not replace native headers with a hardcoded macOS browser identity.
const { INSTALL_RESUME_UPLOAD_OBSERVER, waitForResumeRefresh } = require('./resume-upload.cjs');
const { logger } = require('./logger.cjs');
const { INSTALL_BYTEDANCE_LOGIN_UI } = require('./site-login-ui.cjs');
let diagnostics = [];
function diagnostic(kind, url = '') {
  let origin = '', path = ''; try { const target = new URL(url); origin = target.origin; path = target.pathname; } catch {}
  const item = { kind, origin, path, at: new Date().toISOString() };
  diagnostics.push(item); diagnostics = diagnostics.slice(-12);
  logger.warn('网页登录诊断', { companyId: currentCompanyId, ...item });
  notifyChange();
}
function refreshEnabled() {
  return ['baidu', 'alibaba', 'jd'].includes(currentCompanyId) && currentMode === 'resume-review';
}
async function installUploadObserver(view=currentView,companyId=currentCompanyId,mode=currentMode) {
  if (companyId === 'bytedance' && view?.webContents && !view.webContents.isDestroyed()) {
    await view.webContents.executeJavaScript(INSTALL_BYTEDANCE_LOGIN_UI).catch(() => {});
  }
  if (['baidu','alibaba','jd'].includes(companyId) && mode==='resume-review' && view?.webContents && !view.webContents.isDestroyed()) {
    await view.webContents.executeJavaScript(INSTALL_RESUME_UPLOAD_OBSERVER).catch(() => {});
  }
}

function setParent(win) {
  parentWindow = win;
  // 任何可能改变窗口内容区尺寸的事件都要刷新 bounds，否则原生 view 会停在旧尺寸/旧位置。
  // resize 覆盖大部分；maximize/unmaximize/fullscreen 在某些 macOS 版本不冒泡到 resize，显式补上。
  for (const evt of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore', 'show']) {
    win.on(evt, () => updateBounds());
  }
}

function updateBounds() {
  if (!currentView || !parentWindow || parentWindow.isDestroyed()) return;
  // 必须用 getContentSize()：它返回的是「内容区」尺寸（不含原生标题栏/边框），
  // 而 getSize() 返回外框尺寸——WebContentsView 的 bounds 是相对内容区的。
  // 用 getSize 会让 view 偏高 ~28px，盖住顶部红绿黄交通灯。
  const [contentW, contentH] = parentWindow.getContentSize();
  if(contentW<=0||contentH<=52)return;
  // 简历核对模式下右侧留出进度日志栏的真实空间，避免原生页面盖住面板
  currentView.setBounds(boundsForWindow ? boundsForWindow(contentW, contentH) : calculateWorkspaceBounds(contentW, contentH, { reserveFillLogRail: currentMode === 'resume-review' }));
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
    context: currentContext,
    auth: authMonitor?.snapshot() || null,
    diagnostics: [...diagnostics]
  };
}

function notifyChange() {
  if (onChangeCallback) onChangeCallback(getStatus());
}

async function flushCurrentSession(companyId=currentCompanyId) {
  if (!companyId) return;
  const activeSession = session.fromPartition(`persist:${companyId}`);
  // Flush the site's session unchanged: do not rewrite cookie expiration or SameSite.
  // 某些 Electron 版本/会话状态下 flushStore/flushStorageData 可能返回 undefined 而非 Promise，
  // 对 undefined 调 .catch 会抛「Cannot read properties of undefined (reading 'catch')」。
  // 用 Promise.resolve 包一层，保证永远是 thenable。
  await Promise.resolve(activeSession.cookies.flushStore()).catch(() => {});
  await Promise.resolve(activeSession.flushStorageData()).catch(() => {});
}

function destroyCurrentView() {
  clearTimeout(authPollTimer); authPollTimer=null; authMonitor=null; currentRequest=null;checkCurrentAuth=null;
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

function closeWorkspace(view=currentView) {
  if (!view) return Promise.resolve();
  if(closeTasks.has(view))return closeTasks.get(view);
  if(view!==currentView)return Promise.resolve();
  const companyId=currentCompanyId;
  const task=(async()=>{
    await flushCurrentSession(companyId);
    if(currentView===view){destroyCurrentView();notifyChange();}
  })().finally(()=>closeTasks.delete(view));
  closeTasks.set(view,task);return task;
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
  if (currentView || externalBusy()) {
    const error = new Error('当前有网页正在登录或核对，请先点顶部“完成”或“取消并返回”');
    error.code = 'WORKSPACE_ACTIVE';
    throw error;
  }
  if(parentWindow.isMinimized?.())parentWindow.restore();

  currentCompanyId = company.id;
  currentMode = mode;
  currentTitle = title;
  currentContext = context;
  currentRequest={company,url,mode,title,context};
  const campusLogin=company.id==='jd'&&['login','resume-review'].includes(mode)&&url.startsWith('https://campus.jd.com/#/resume');
  authMonitor=campusLogin?createJdAuthStatus(authTiming):null;
  diagnostics = [];
  const navigation = createWorkspaceNavigationPolicy(company.id);
  const jdAuthReturn = createJdAuthReturnTracker({companyId:company.id,initialUrl:url});
  navigation.observe(url, url);
  const persistSession = session.fromPartition(`persist:${company.id}`);
  persistSession.setUserAgent(session.defaultSession.getUserAgent());
  persistSession.webRequest.onBeforeSendHeaders(null);
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
  const workspaceView = currentView;
  const workspaceAuth=authMonitor;
  async function checkAuth(){
    if(!workspaceAuth||currentView!==workspaceView||workspaceView.webContents.isDestroyed())return;
    let probe=null;
    try {
      const u=new URL(workspaceView.webContents.getURL());
      if(u.origin==='https://campus.jd.com'){
        const [ui,cookies]=await Promise.all([
          run(`(()=>({isCampus:location.origin==='https://campus.jd.com',resumeSection:(document.body?.innerText||'').includes('基本信息'),loginVisible:[...document.querySelectorAll('a,button')].some(e=>e.innerText.trim()==='登录'&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')}))()`,workspaceView),
          Promise.resolve(persistSession.cookies.get?.({url:'https://campus.jd.com/'})||[])
        ]);
        probe={...ui,hasAuthCookie:cookies.some(c=>c.name==='thor'&&Boolean(c.value))};
      }
    } catch {}
    if(currentView!==workspaceView||workspaceView.webContents.isDestroyed())return;
      const before=JSON.stringify(workspaceAuth.snapshot());workspaceAuth.update(probe);
      if(JSON.stringify(workspaceAuth.snapshot())!==before)notifyChange();
      return Boolean(probe?.isCampus&&probe.resumeSection&&probe.loginVisible===false&&probe.hasAuthCookie===true);
  }
  async function probeAuth(){
    await checkAuth();
    if(!workspaceAuth||currentView!==workspaceView||workspaceView.webContents.isDestroyed())return;
    authPollTimer=setTimeout(probeAuth,authTiming.checkEveryMs||2000);authPollTimer.unref?.();
  }
  checkCurrentAuth=workspaceAuth?checkAuth:null;
  if(workspaceAuth){authPollTimer=setTimeout(probeAuth,authTiming.checkEveryMs||500);authPollTimer.unref?.();}
  function observeAuth(raw){if(currentView!==workspaceView)return;workspaceAuth?.observe(raw);if(workspaceAuth)notifyChange();}
  const resumeJdAuthReturn = async (landedUrl, childWindow=null) => {
    const returnUrl=jdAuthReturn.consume(landedUrl);
    if(!returnUrl||currentView!==workspaceView||workspaceView.webContents.isDestroyed())return;
    // Only after the observed callback has actually landed. Let the official
    // campus callback validate its own session; QR scan alone is never success.
    await flushCurrentSession();
    if(currentView!==workspaceView||workspaceView.webContents.isDestroyed())return;
    diagnostic('auth-return-resume',returnUrl);
    try { await workspaceView.webContents.loadURL(returnUrl); }
    catch { if(currentView===workspaceView)diagnostic('auth-return-error',returnUrl);return; }
    if(currentView!==workspaceView)return;
    if(childWindow&&!childWindow.isDestroyed())childWindow.close();
  };
  const popupHandler = (opener) => ({ url: popupUrl }) => {
    const from = opener.getURL() || getCurrentUrl();
    navigation.observe(from, popupUrl);
    jdAuthReturn.observe(popupUrl);
    observeAuth(popupUrl);
    if (navigation.allows(popupUrl) || ((!popupUrl || popupUrl === 'about:blank') && navigation.allows(from))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: process.env.YIJIAN_BACKGROUND_TEST !== '1',
          parent: parentWindow,
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
    diagnostic('popup-blocked', popupUrl);
    return { action: 'deny' };
  };
  // OAuth 入口可能位于校招站的登录 iframe 中。will-navigate 只报告主框架，
  // 因此还要从子框架导航读取 redirect_uri，才能在扫码回跳前学到精确回调路径。
  const observeFrameNavigation = (details) => {
    const from = details.initiator?.url || details.frame?.url || getCurrentUrl() || url;
    navigation.observe(from, details.url);
    jdAuthReturn.observe(details.url);
    observeAuth(details.url);
    // JS navigation inside an iframe may also use an HTTP SSO callback.
    // Keep it in the actual initiating frame, never promote it to the parent.
    const upgraded=upgradeToHttps(details.url);
    if(details.isMainFrame===false&&upgraded){
      details.preventDefault();
      void navigateOriginalFrame(workspaceView.webContents,details,upgraded).catch(()=>{
        if(currentView===workspaceView)diagnostic('frame-upgrade-failed',upgraded);
      });
    }
  };
  currentView.webContents.setWindowOpenHandler(popupHandler(currentView.webContents));
  const configurePopup = (childWindow) => {
    childWindow.webContents.setWindowOpenHandler(popupHandler(childWindow.webContents));
    childWindow.webContents.on('did-create-window', configurePopup);
    childWindow.webContents.on('will-frame-navigate', details=>{
      navigation.observe(details.initiator?.url||details.frame?.url||getCurrentUrl(),details.url);
      jdAuthReturn.observe(details.url);
      observeAuth(details.url);
      const upgraded=upgradeToHttps(details.url);
      if(details.isMainFrame===false&&upgraded){details.preventDefault();void navigateOriginalFrame(childWindow.webContents,details,upgraded).catch(()=>{
        if(currentView===workspaceView)diagnostic('popup-frame-upgrade-failed',upgraded);
      });}
    });
    popupWindows.add(childWindow);
    const enforceChildPolicy = (event, targetUrl,_inPlace,isMainFrame,frameProcessId,frameRoutingId) => {
      const from = childWindow.webContents.getURL();
      navigation.observe(!from || from === 'about:blank' ? getCurrentUrl() : from, targetUrl);
      jdAuthReturn.observe(targetUrl);
      observeAuth(targetUrl);
      if (navigation.allows(targetUrl)) return;
      const upgraded = upgradeToHttps(targetUrl);
      event.preventDefault();
      if (upgraded) void navigateOriginalFrame(childWindow.webContents,event,upgraded,{isMainFrame,frameProcessId,frameRoutingId,resolveFrame:webFrameMain.fromId}).catch(()=>{
        if(currentView===workspaceView)diagnostic('popup-frame-upgrade-failed',upgraded);
      });
      else diagnostic('popup-navigation-blocked', targetUrl);
    };
    childWindow.webContents.on('will-navigate', enforceChildPolicy);
    childWindow.webContents.on('will-redirect', enforceChildPolicy);
    // Preserve window.opener/postMessage. Closing an OAuth popup flushes its shared
    // session but never reloads the opener while the site's callback is executing.
    childWindow.on('closed', () => { popupWindows.delete(childWindow); void flushCurrentSession(); notifyChange(); });
    childWindow.webContents.on('did-navigate', notifyChange);
    childWindow.webContents.on('did-frame-finish-load', (_event,_main,processId,routingId) => {
      const frame=webFrameMain.fromId(processId,routingId);
      if(frame)void resumeJdAuthReturn(frame.url,childWindow);
    });

  };
  currentView.webContents.on('did-create-window', configurePopup);
  currentView.webContents.on('will-frame-navigate', observeFrameNavigation);
  // 阿里 mozi SSO 等登录回跳可能使用 http:// 回调；白名单只认 https。
  // 处理方式：http 回调若域名在白名单内，自动升级为 https 继续导航，而不是拦截（拦截会让登录永远完不成）。
  const upgradeToHttps = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:') return null;
      const upgraded = parsed.href.replace(/^http:/, 'https:');
      return navigation.allows(upgraded) ? upgraded : null;
    } catch {
      return null;
    }
  };
  const enforceNavigationPolicy = (event, targetUrl,_inPlace,isMainFrame,frameProcessId,frameRoutingId) => {
    navigation.observe(getCurrentUrl() || url, targetUrl);
    jdAuthReturn.observe(targetUrl);
    observeAuth(targetUrl);
    if (navigation.allows(targetUrl)) return;
    const upgraded = upgradeToHttps(targetUrl);
    if (upgraded) {
      event.preventDefault();
      void navigateOriginalFrame(workspaceView.webContents,event,upgraded,{isMainFrame,frameProcessId,frameRoutingId,resolveFrame:webFrameMain.fromId}).catch(()=>{
        if(currentView===workspaceView)diagnostic('frame-upgrade-failed',upgraded);
      });
      return;
    }
    event.preventDefault();
    diagnostic('navigation-blocked', targetUrl);
  };
  currentView.webContents.on('will-navigate', enforceNavigationPolicy);
  currentView.webContents.on('will-redirect', enforceNavigationPolicy);

  currentView.webContents.on('did-finish-load', installUploadObserver);
  currentView.webContents.on('did-fail-load', (_event, code, _description, failedUrl, isMainFrame) => { if (isMainFrame && code !== -3) diagnostic(`load-error:${code}`, failedUrl); });
  currentView.webContents.on('did-navigate', notifyChange);
  currentView.webContents.on('did-navigate-in-page', notifyChange);
  currentView.webContents.on('did-frame-finish-load', (_event,_main,processId,routingId) => {
    const frame=webFrameMain.fromId(processId,routingId);
    if(frame)void resumeJdAuthReturn(frame.url);
  });

  try {
    await workspaceView.webContents.loadURL(url);
    assertWorkspace(workspaceView);
    await installUploadObserver(workspaceView,company.id,mode);
    assertWorkspace(workspaceView);
    // SSO 重定向循环自愈：服务端会话失效但本地 Cookie 残留时，SSO 页会报「重定向循环」。
    // 检测到即清空本分区 Cookie 并重载，让用户看到干净的登录页，而不是死循环错误页。
    try {
      const text = await workspaceView.webContents.executeJavaScript('(document.body ? document.body.innerText : "").slice(0, 500)');
      assertWorkspace(workspaceView);
      if (/重定向循环|too many redirects/i.test(String(text))) {
        const brokenSession = session.fromPartition(`persist:${company.id}`);
        await brokenSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
        assertWorkspace(workspaceView);
        await workspaceView.webContents.loadURL(url).catch(() => {});
      }
    } catch {}
    assertWorkspace(workspaceView);
    notifyChange();
    return getStatus();
  } catch (error) {
    assertWorkspace(workspaceView);
    // Electron 在某些服务端/JS 重定向中会让初始 loadURL 以 ERR_ABORTED 结束，
    // 即使 WebContents 已经正常落到白名单内的登录页。此时保留工作区给用户登录；
    // 其他错误或越域落点仍立即关闭，不扩大导航权限。
    // SSO 令牌回跳链（如 sendBucSSOToken.do）中途 loadURL 会 ERR_ABORTED，落点需要一点时间才稳定
    if (/ERR_ABORTED/.test(String(error.message))) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    assertWorkspace(workspaceView);
    const landedUrl = getCurrentUrl();
    if (isRecoverableNavigationAbort(error, company.id, landedUrl, navigation)) {
      notifyChange();
      return getStatus();
    }
    await closeWorkspace(workspaceView);
    throw new Error(`打开网页失败：${error.message}`);
  }
}

function openLoginView(company, recruitType = 'social') {
  const { resolvePlatformUrl } = require('./platform-manifests.cjs');
  return openWorkspace({
    company,
    url: resolvePlatformUrl(company.id, recruitType, 'login'),
    mode: 'login',
    title: `登录 ${company.name}`,
    context: { action: 'login', companyId: company.id }
  });
}

async function run(script,view=currentView) {
  if (!currentView?.webContents || currentView.webContents.isDestroyed()) {
    throw new Error('浏览器工作区未打开');
  }
  // 页面在脚本执行期间跳转（如重定向到登录页）会让 executeJavaScript 的 Promise 永远不 settle。
  // 必须加超时兜底，否则一键更新会永久卡在当前站点。
  const SCRIPT_TIMEOUT_MS = 15000;
  assertWorkspace(view);
  let timer;
  try { const result=await Promise.race([
    view.webContents.executeJavaScript(script),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('页面脚本执行超时（页面可能正在跳转），请稍后重试')), SCRIPT_TIMEOUT_MS);
    })
  ]);assertWorkspace(view);return result; } finally { clearTimeout(timer); }
}

// 给页面上的简历附件上传控件注入本地文件。
// Chromium 允许页内把 DataTransfer.files 赋给 input.files（与用户选文件等价的合法途径），
// 天然免疫 React/Vue 重渲染替换节点的问题（antd 等组件会消化文件后重置 input，属正常行为）。
// 只允许注入 userData/resumes/ 下由用户主动上传的简历文件（调用方负责校验路径）。
const RESUME_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

  async function setInputFiles(absolutePath) {
    const view=currentView;
  if (!currentView?.webContents || currentView.webContents.isDestroyed()) {
    throw new Error('浏览器工作区未打开');
  }
  const nodeFs = require('node:fs');
  const stat = nodeFs.statSync(absolutePath);
  if (!stat.isFile()) throw new Error('简历文件不存在');
  if (stat.size > RESUME_ATTACHMENT_MAX_BYTES) throw new Error('简历文件超过 15MB，多数招聘站不接受');
  const bytes = nodeFs.readFileSync(absolutePath);
  const filename = require('node:path').basename(absolutePath);
  const ext = require('node:path').extname(absolutePath).slice(1).toLowerCase();
  if(!['pdf','doc','docx'].includes(ext))throw new Error('简历附件仅支持 PDF、DOC、DOCX');
  const mime = ext === 'pdf' ? 'application/pdf' : ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword';
  const base64 = bytes.toString('base64');
  const needsRefresh=refreshEnabled();
  await installUploadObserver(view);
  assertWorkspace(view);
  const result = await run(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0));
    const file = new File([bytes], ${JSON.stringify(filename)}, { type: ${JSON.stringify(mime)} });
    // 评分定位「简历附件」输入框：accept 支持 pdf/doc 或旁标签含 简历/附件/resume
    const scored = [...document.querySelectorAll('input[type=file]')].map((input) => {
      const accept = (input.accept || '').toLowerCase();
      const labelText = [
        input.closest('label')?.innerText, input.parentElement?.innerText,
        input.getAttribute('aria-label'), input.name, input.id
      ].filter(Boolean).join(' ');
      let score = 0;
      if (/pdf|doc/.test(accept)) score += 4;
      if (/简历|附件|resume/.test(labelText)) score += 3;
      return { input, score };
    }).filter((item) => item.score >= 3).sort((a, b) => b.score - a.score);
    if (!scored.length) return { uploaded: false, reason: 'no-resume-file-input' };
    const input = scored[0].input;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    const attached = input.files && input.files.length === 1;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // antd 等组件会在 change 里立刻消化文件并重置 input，因此以「赋值瞬间成功」为判据
    return attached ? { uploaded: true, filename: ${JSON.stringify(filename)} } : { uploaded: false, reason: 'file-not-attached' };
  })()`,view);
  if (result?.uploaded && needsRefresh) {
    result.refresh = await waitForResumeRefresh({ run:script=>run(script,view) });
  }
  return result;
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
    const view=currentView;
    if(currentMode==='login'&&authMonitor){
      const currentlyVerified=await checkCurrentAuth?.();assertWorkspace(view);
      if(!currentlyVerified){
        const error=new Error(authMonitor.snapshot().state==='verified'?'当前页面尚未核对登录，请返回校招简历页。':authMonitor.snapshot().message);
        error.code='LOGIN_NOT_VERIFIED';throw error;
      }
  }
  const status = getStatus();
  const page = await snapshot();
  assertWorkspace(view);
  await closeWorkspace(view);
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

async function restartLogin(){
  if(currentMode!=='login'||currentCompanyId!=='jd'||!authMonitor||!currentRequest)throw new Error('只可重新打开当前京东校招登录页；简历编辑页保持不动');
  const request=currentRequest;await closeWorkspace();return openWorkspace(request);
}

return {
  setParent,
  openWorkspace,
  openLoginView,
  closeWorkspace,
  closeWorkspaceIfOpen,
  closeLoginView: closeWorkspace,
  finishWorkspace,
  cancelWorkspace,
  run,
  setInputFiles,
  snapshot,
  getStatus,
  getWebContents,
  isActive: () => Boolean(currentView) || externalBusy(),
  setExternalBusy: (fn) => { externalBusy = fn; },
  getActiveCompanyId: () => currentCompanyId,
  getCurrentUrl,
  detectLogin,
  restartLogin,
  onChange
};

}
module.exports = { ...createLoginManager(), createLoginManager };
