const LOGIN_AND_FORM_PROBE = `(() => new Promise((resolve) => {
  const inspect = () => {
    const bodyText = document.body?.innerText || '';
    const inputCount = document.querySelectorAll('input, textarea, select').length;
    const isNotFound = /404|页面不存在|没有找到/.test(document.title + bodyText.slice(0, 500));
    // 百度等站未登录时直接返回 JSON（如 {"status":"need-login"}），页面既无表单也无登录控件
    const jsonNeedLogin = /"status"\s*:\s*"need-login"|need login!/i.test(bodyText.slice(0, 300));
    const loginControl = document.querySelector('a[href*="login"], button[class*="login"], button[class*="signin"], .tis-login, [data-testid*="login"], [class*="login-button"], [class*="signin-button"]');
    const authField = document.querySelector('input[type="password"], input[autocomplete="one-time-code"], input[autocomplete="tel"], input[placeholder*="手机号"], input[placeholder*="验证码"], input[name*="captcha"], input[name*="password"], input[name="phone"], input[name="mobile"]');
    const routeParts = (location.pathname + location.search).toLowerCase().split(/[\\/?&#=_-]+/).filter(Boolean)
      // login.html / login.aspx 等带扩展名的路径要去掉扩展名再比对
      .map((part) => part.replace(/\.(html?|aspx|php|jsp)$/i, ''));
    const authRoute = routeParts.some((part) => ['login', 'passport', 'signin', 'auth', 'sso'].includes(part) || part.startsWith('sso'));
    const authPrompt = /手机号登录|扫码登录|验证码登录|密码登录|获取验证码|立即登录|登录账号/.test(bodyText.slice(0, 1200));
    const strongAuthField = document.querySelector('input[type="password"], input[autocomplete="one-time-code"], input[placeholder*="验证码"], input[name*="captcha"], input[name*="password"]');
    return { loginRequired: Boolean(jsonNeedLogin || strongAuthField || authRoute || (authField && authPrompt) || (loginControl && authPrompt)), isNotFound, inputCount };
  };
  const initial = inspect();
  // SPA 跳转登录页存在竞态：首帧可能还停在原路径且带残留输入框，立即按 inputCount 返回会漏判登录。
  // 至少观察 1.2s，只有连续两次都「无登录迹象且有表单」才认为表单页就绪。
  const startedAt = Date.now();
  const settleDelay = 1200;
  const timer = setInterval(() => {
    const result = inspect();
    const settled = Date.now() - startedAt >= settleDelay;
    if (result.inputCount > 0 && !result.loginRequired && !settled) return;
    if (result.inputCount > 0 || result.isNotFound || result.loginRequired || Date.now() - startedAt > 6000) {
      clearInterval(timer);
      resolve(result);
    }
  }, 250);
}))()`;

const INSPECT_FORM_FIELDS = `(() => {
  function describe(control) {
    const labelByFor = control.id ? document.querySelector('label[for="' + CSS.escape(control.id) + '"]')?.innerText : '';
    const ancestorTexts = [];
    let node = control.parentElement;
    for (let depth = 0; depth < 5 && node; depth += 1) {
      try {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('input,textarea,select').forEach((element) => element.remove());
        const text = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text && text.length < 100) ancestorTexts.push(text);
      } catch (error) {}
      node = node.parentElement;
    }
    return [
      labelByFor, control.closest('label')?.innerText, control.placeholder, control.name, control.id,
      control.getAttribute('aria-label'), control.getAttribute('autocomplete'), control.className,
      ancestorTexts.join(' ')
    ].filter(Boolean).join(' ').trim();
  }
  const controls = [...document.querySelectorAll('input, textarea, select')]
    .filter((control) => !control.disabled && control.type !== 'hidden' && control.type !== 'button' && control.type !== 'submit')
    .filter((control) => !control.closest('form[action*="login"], [class*="login"], [class*="captcha"], [class*="auth"], [role="dialog"]'));
  return controls.map((control, index) => ({
    index,
    label: describe(control).slice(0, 240),
    type: control.tagName.toLowerCase() + (control.type ? ':' + control.type : ''),
    value: control.type === 'radio'
      ? (control.checked ? (control.value || describe(control).split(/\\s+/).at(-1) || '是') : '')
      : (control.type === 'checkbox' ? (control.checked ? '是' : '否') : (control.value || '')),
    controlValue: control.value || '',
    name: control.name || '', id: control.id || '', placeholder: control.placeholder || '',
    ariaLabel: control.getAttribute('aria-label') || '', autocomplete: control.getAttribute('autocomplete') || '',
    options: control.tagName === 'SELECT' ? [...control.options].map((option) => option.textContent.trim()).slice(0, 30) : null
  }));
})()`;

module.exports = { LOGIN_AND_FORM_PROBE, INSPECT_FORM_FIELDS };
