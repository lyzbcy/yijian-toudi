// ByteDance's observed first-visit introduction covers the login form. Dismiss
// only that introduction via its own "稍后再说" button; never consent or captcha.
function installBytedanceLoginUi() {
  if (window.__yjtBytePromoInstalled) return;
  window.__yjtBytePromoInstalled = true;
  const dismiss = () => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')]
      .filter(b => b.getClientRects().length && (b.innerText || '').trim() === '稍后再说');
    for (const button of buttons) {
      let box = button.parentElement;
      for (let depth = 0; box && box !== document.body && depth < 7; depth++, box = box.parentElement) {
        const text = (box.innerText || '').replace(/\s+/g, '');
        if (text.includes('AI求职搭子') && text.includes('个性化荐岗') && text.includes('线上咨询')) {
          button.click(); window.__yjtBytePromoDismissed = true; return true;
        }
      }
    }
    return false;
  };
  if (dismiss()) return;
  const observer = new MutationObserver(() => { if (dismiss()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30000);
}
module.exports = { INSTALL_BYTEDANCE_LOGIN_UI: `(${installBytedanceLoginUi.toString()})()` };
