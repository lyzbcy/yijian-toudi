// Shared, read-only parent-document evidence. Never reads iframe contents/cookies,
// navigates, submits, or equates a QR scan with an authenticated account.
function inspectPageAuthentication() {
  const bodyText = document.body?.innerText || '';
  const jsonNeedLogin = /"status"\s*:\s*"need-login"|need login!/i.test(bodyText.slice(0, 300));
  const loginControl = document.querySelector('a[href*="login"], button[class*="login"], button[class*="signin"], .tis-login, [data-testid*="login"], [class*="login-button"], [class*="signin-button"]');
  const authField = document.querySelector('input[type="password"], input[autocomplete="one-time-code"], input[autocomplete="tel"], input[placeholder*="手机号"], input[placeholder*="验证码"], input[name*="captcha"], input[name*="password"], input[name="phone"], input[name="mobile"]');
  const parts = (location.pathname + location.search).toLowerCase().split(/[\/?&#=_-]+/).filter(Boolean).map(p => p.replace(/\.(html?|aspx|php|jsp|htm)$/i, ''));
  const authRoute = parts.some(p => ['login', 'passport', 'signin', 'auth', 'sso'].includes(p) || p.startsWith('sso'));
  const authPrompt = /手机号登录|扫码登录|验证码登录|密码登录|获取验证码|立即登录|登录账号/.test(bodyText.slice(0, 1200));
  const strongAuthField = document.querySelector('input[type="password"], input[autocomplete="one-time-code"], input[placeholder*="验证码"], input[name*="captcha"], input[name*="password"]');
  const visible = frame => {
    try {
      if (!frame.getClientRects().length) return false;
      for (let node = frame; node; node = node.parentElement) {
        // aria-hidden affects accessibility, not whether the auth frame is drawn.
        if (node.hidden) return false;
        const style = getComputedStyle(node);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
      }
      return true;
    } catch { return false; }
  };
  // Verified JD campus modal: the parent keeps a source select while its own
  // passport iframe covers the resume. A hidden stale frame must not block it.
  const loginFrameVisible = location.origin === 'https://campus.jd.com' && [...document.querySelectorAll('iframe')].some(frame => {
    try {
      const u = new URL(frame.getAttribute('src') || frame.src || '', location.href);
      return u.origin === 'https://campus.jd.com' && /^\/passport(?:\/|$)/.test(u.pathname) && visible(frame);
    } catch { return false; }
  });
  return { loginRequired: Boolean(jsonNeedLogin || strongAuthField || authRoute || loginFrameVisible || (authField && authPrompt) || (loginControl && authPrompt)) };
}
module.exports = { inspectPageAuthentication };
