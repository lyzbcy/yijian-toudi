// Playwright-CDP 桥适配器（2026-09-22，Kimi 扩展断供时的备胎，本轮只备不切）
// 与 kimi-bridge 满足同一三方法契约：navigate(url) / snapshot() / click(refOrSelector)，
// boss-batch 引擎无感切换。差异：click 用 Playwright 的真实输入（isTrusted=true）；
// snapshot 返回 {data:{url, ...a11y树}} 形状——引擎只用 JSON.stringify 粗查 + findRef 提取链接，
// 这里返回简化结构 {data:{url, links:[{role:'link', name, ref}]}} 即可兼容 extractJobLinks/findRef。
// 使用前提：目标 Edge 以 --remote-debugging-port=<port> 启动（复用其登录态）。
const { chromium } = require('playwright-core');

class PlaywrightBridgeAdapter {
  constructor({ cdpEndpoint, log } = {}) {
    this.cdpEndpoint = cdpEndpoint || 'http://127.0.0.1:9223';
    this.log = log || (() => {});
    this.browser = null;
    this.page = null;
  }

  async ensure() {
    if (this.page) return this.page;
    this.browser = await chromium.connectOverCDP(this.cdpEndpoint);
    const ctx = this.browser.contexts()[0] || await this.browser.newContext();
    this.page = ctx.pages()[0] || await ctx.newPage();
    return this.page;
  }

  async navigate(url, _opts) {
    const page = await this.ensure();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return { success: true, url: page.url() };
  }

  // 引擎契约：返回 JSON 里含 "role":"link","name":"...","ref":"@eN" 的结构
  async snapshot(_opts) {
    const page = await this.ensure();
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).slice(0, 200).map((a, i) => {
        const t = (a.textContent || '').trim();
        return t ? { role: 'link', name: t.slice(0, 60), ref: `@p${i}`, href: a.href } : null;
      }).filter(Boolean);
    });
    return { data: { url: page.url(), links } };
  }

  // ref 形如 @pN（snapshot 里登记的序号）或 CSS 选择器
  async click(ref, _opts) {
    const page = await this.ensure();
    if (/^@p\d+$/.test(ref)) {
      const idx = Number(ref.slice(2));
      const handles = await page.$$('a');
      const h = handles[idx];
      if (!h) return { success: false, error: 'ref-not-found' };
      await h.click({ timeout: 20000 });
      return { success: true };
    }
    await page.click(ref, { timeout: 20000 });
    return { success: true };
  }

  async stop() {
    try { await this.browser?.close(); } catch {}
    this.browser = null;
    this.page = null;
  }
}

module.exports = { PlaywrightBridgeAdapter };
