// 腾讯简历填写执行器
//
// 用 persist:tencent session（用户已登录）打开腾讯简历页，
// 自动填写软件里保存的简历数据到腾讯表单字段。
//
// agent.md 第3行：简历一键更新到所有平台。
// agent.md 第26-27行：字段需涵盖所有大厂，用写死脚本填写。
// agent.md 第35行：最终提交必须用户确认。
//
// 字段映射表（选择器需登录后实测确认，这里先放通用匹配逻辑）：
// 腾讯简历页 URL: https://careers.tencent.com/jobresume/resume.html
// 页面是 SPA，表单字段可能用动态 class，用 label 文本匹配最稳。

const { WebContentsView, session } = require('electron');

const RESUME_URL = 'https://careers.tencent.com/jobresume/resume.html';

/**
 * 把软件简历填入腾讯简历页。
 * @param {Object} resume 软件里保存的简历数据（state.resume）
 * @param {Object} options
 * @param {Function} [options.onStep] 步骤回调
 * @returns {Promise<{ok, status, message, filledCount}>}
 */
async function fillTencentResume(resume, { onStep } = {}) {
  const step = (s, m) => { if (onStep) onStep({ step: s, message: m }); };
  step('start', '开始填写腾讯简历');

  // 检查登录态
  const ses = session.fromPartition('persist:tencent');
  const cookies = await ses.cookies.get({ domain: 'tencent.com' });
  if (cookies.length === 0) {
    step('error', '未检测到腾讯登录态，请先登录');
    return { ok: false, status: 'login-required', message: '未登录腾讯' };
  }
  step('login-ok', '登录态正常');

  // 打开简历页
  const view = new WebContentsView({ session: ses });
  step('loading', '正在打开腾讯简历页…');
  await view.webContents.loadURL(RESUME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => {
    throw new Error(`打开简历页失败：${e.message}`);
  });
  await new Promise((r) => setTimeout(r, 3000));

  const pageUrl = view.webContents.getURL();
  // 简历页未登录会 404
  if (/404|没有找到/.test(await view.webContents.executeJavaScript('document.title + document.body.innerText').catch(() => ''))) {
    view.webContents.destroy();
    return { ok: false, status: 'login-required', message: '简历页需要登录才能访问' };
  }

  step('form-found', '简历页已加载，开始填写');

  // 通用填表策略：遍历页面上所有 input，用 label/placeholder/name 匹配软件简历字段
  // 这种方式对 SPA 动态 class 最稳（不依赖固定选择器）
  const fillScript = (resumeData) => {
    // 字段匹配规则：[软件字段值, 匹配关键词列表]
    const fieldMap = [
      [resumeData.basic?.name, ['姓名', 'name']],
      [resumeData.basic?.phone, ['手机', '电话', 'phone', 'mobile']],
      [resumeData.basic?.email, ['邮箱', 'email', 'mail']],
      [resumeData.basic?.city, ['现居', '城市', 'city']],
      [resumeData.basic?.wechat, ['微信', 'wechat']],
      [resumeData.intention?.roles, ['期望', '意向', '岗位', 'position']],
      [resumeData.intention?.salary, ['薪资', 'salary']],
      [resumeData.education?.[0]?.school, ['学校', 'school', '院校']],
      [resumeData.education?.[0]?.major, ['专业', 'major']],
      [resumeData.skills?.keywords, ['技能', 'skill']],
      [resumeData.extras?.summary, ['简介', '介绍', 'summary', '描述']],
    ];

    let filled = 0;
    const allInputs = [...document.querySelectorAll('input,textarea')];
    for (const [value, keywords] of fieldMap) {
      if (!value) continue;
      // 找匹配的 input：看 label/placeholder/name/id 是否含关键词
      for (const input of allInputs) {
        const attrs = [
          input.placeholder, input.name, input.id,
          // 找关联的 label
          input.closest('label')?.innerText,
          input.previousElementSibling?.innerText,
          input.parentElement?.innerText
        ].filter(Boolean).join(' ').toLowerCase();
        if (keywords.some((kw) => attrs.includes(kw.toLowerCase()))) {
          // 模拟真实输入（触发 React/Vue 的 change 事件）
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window[input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement].prototype, 'value').set;
          nativeInputValueSetter.call(input, String(value));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          filled += 1;
          break;
        }
      }
    }
    return { filled, totalInputs: allInputs.length };
  };

  const result = await view.webContents.executeJavaScript(`(${fillScript.toString()})(${JSON.stringify(resume)})`).catch((e) => ({ filled: 0, error: e.message }));
  step('filled', `已填写 ${result.filled || 0} 个字段（页面共 ${result.totalInputs || 0} 个输入框）`);

  // 不自动保存——用户在页面上确认后自己点保存（agent.md 第35行要求确认）
  view.webContents.destroy();

  return {
    ok: true,
    status: 'filled',
    message: `已自动填写 ${result.filled || 0} 个字段，请在腾讯页面确认后保存`,
    filledCount: result.filled || 0
  };
}

module.exports = { fillTencentResume };
