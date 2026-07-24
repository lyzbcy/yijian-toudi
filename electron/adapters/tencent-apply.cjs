// 腾讯投递执行器
//
// 用 persist:tencent session（用户已登录）打开岗位详情页，
// 点击"申请岗位"按钮，执行投递流程。
//
// agent.md 第35行：最终投递必须让用户确认。
// agent.md 第14行：通过浏览器自动化进行。
//
// 投递流程（腾讯）：
// 1. 打开岗位详情页 jobdesc.html?postId=xxx
// 2. 点击 .default-btn（"申请岗位"按钮）
// 3. 可能弹出确认/补充信息 → 暂停等用户
// 4. 用户确认提交

const { WebContentsView, session } = require('electron');

const APPLY_BUTTON_SELECTOR = '.default-btn';

/**
 * 投递单个腾讯岗位。
 * @param {Object} job 岗位对象（需含 url 或 postId）
 * @param {Object} options
 * @param {Function} [options.onStep] 步骤回调 ({ step, message })
 * @returns {Promise<{ok, status, message}>}
 */
async function applyTencentJob(job, { onStep } = {}) {
  const step = (s, m) => { if (onStep) onStep({ step: s, message: m }); };
  step('start', `开始投递 ${job.title}`);

  // 从岗位 url 或 postId 构造详情页 URL
  let detailUrl = job.url;
  if (!detailUrl && job.id) {
    // tencent-xxx 格式，提取 postId
    const postId = String(job.id).replace(/^tencent(-campus)?-/, '');
    detailUrl = `https://careers.tencent.com/jobdesc.html?postId=${postId}`;
  }
  if (!detailUrl) throw new Error('岗位缺少 URL，无法投递');

  // 用 persist:tencent session（WebContentsView 创建时会自动从磁盘加载 cookie）
  const ses = session.fromPartition('persist:tencent');
  const view = new WebContentsView({ session: ses });
  step('loading', '正在打开岗位详情页…');
  await view.webContents.loadURL(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => {
    throw new Error(`打开详情页失败：${e.message}`);
  });
  await new Promise((r) => setTimeout(r, 2000));

  // 通过页面内容判断登录态（比预读 cookie 更可靠，因为 cookie 可能未同步到内存）
  const loginCheck = await view.webContents.executeJavaScript(`(function(){
    var hasLoginBtn = !!document.querySelector('.tis-login, [class*="login"]');
    var bodyText = document.body ? document.body.innerText : '';
    return { hasLoginPrompt: /登录|登 录|请先登录/.test(bodyText.slice(0, 500)), is404: /404|没有找到/.test(document.title + bodyText) };
  })()`).catch(() => ({ hasLoginPrompt: true, is404: false }));

  // 检查是否真的是详情页（不是 404）+ 登录态
  if (loginCheck.is404) {
    view.webContents.destroy();
    return { ok: false, status: 'not-found', message: '岗位详情页不存在（可能已下线）' };
  }
  if (loginCheck.hasLoginPrompt) {
    view.webContents.destroy();
    step('error', '腾讯未登录，请先在「公司与邮箱」页登录');
    return { ok: false, status: 'login-required', message: '未登录腾讯，请先登录' };
  }
  const hasApplyBtn = await view.webContents.executeJavaScript(`!!document.querySelector('${APPLY_BUTTON_SELECTOR}')`).catch(() => false);
  const btnText = hasApplyBtn ? await view.webContents.executeJavaScript(`document.querySelector('${APPLY_BUTTON_SELECTOR}').innerText.trim()`).catch(() => '') : '';

  if (!hasApplyBtn) {
    view.webContents.destroy();
    return { ok: false, status: 'no-button', message: '未找到投递按钮' };
  }

  step('found-btn', `找到投递按钮："${btnText}"`);

  // 点击申请岗位按钮
  const clickResult = await view.webContents.executeJavaScript(`(() => {
    const btn = document.querySelector('${APPLY_BUTTON_SELECTOR}');
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  })()`).catch(() => ({ clicked: false }));

  step('clicked', clickResult.clicked ? '已点击申请按钮，等待投递流程…' : '未找到投递按钮');

  // 等待投递流程响应（可能跳转到投递表单页）
  await new Promise((r) => setTimeout(r, 3000));
  const afterClickUrl = view.webContents.getURL();

  // 检查投递后的页面状态
  const afterState = await view.webContents.executeJavaScript(`(() => ({
    url: location.href,
    title: document.title,
    hasForm: document.querySelectorAll('input,textarea').length > 3,
    bodyText: document.body.innerText.slice(0, 200)
  }))()`).catch(() => ({}));

  view.webContents.destroy();

  // 判断投递结果
  if (afterState.hasForm || /投递|简历|确认/.test(afterState.bodyText || '')) {
    step('form', '已进入投递表单页，请在浏览器中确认并提交');
    return { ok: true, status: 'form-opened', message: '已打开投递表单，请确认后提交', url: afterClickUrl };
  }
  if (/已投递|成功|提交成功/.test(afterState.bodyText || '')) {
    step('success', '投递成功');
    return { ok: true, status: 'submitted', message: '投递成功' };
  }
  step('manual', '投递流程需要手动确认，请在浏览器中完成');
  return { ok: true, status: 'manual-confirm', message: '投递流程已启动，请在浏览器中确认', url: afterClickUrl };
}

module.exports = { applyTencentJob };
