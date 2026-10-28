const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const previewUrl = process.env.SITE_PREVIEW_URL || 'http://127.0.0.1:4173/';
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const candidates = [
    process.env.CHROME_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error('未找到可用于页面验证的 Chrome、Edge 或 Chromium');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await desktop.goto(previewUrl, { waitUntil: 'networkidle' });
    await desktop.waitForSelector('.preview-card');
    const heading = await desktop.locator('h1').textContent();
    if (!heading.includes('少一点重复')) throw new Error(`介绍页标题不正确：${heading}`);
    const sourceVersion = require('../package.json').version;
    const descriptor = require('../launcher-adapter.json');
    const windowsVersion = descriptor.version;
    const metadataResponse = await desktop.request.get(new URL('version.json', previewUrl).href);
    if (!metadataResponse.ok()) throw new Error(`页面版本元数据不可读：HTTP${metadataResponse.status()}`);
    const pageVersion = (await metadataResponse.json()).v;
    if (!Number.isSafeInteger(pageVersion) || pageVersion < 1) throw new Error('页面版本元数据无效');
    if (!process.env.SITE_PREVIEW_URL && pageVersion !== require('../site/version.json').v) throw new Error('默认预览未提供当前源码页面元数据');
    const candidateCopies = [];
    async function verifyCopies(page, viewport) {
      const markers = await page.evaluate(() => ({ data: Number(document.documentElement.getAttribute('data-page-v')), inline: window.PAGE_V }));
      if (markers.data !== pageVersion || markers.inline !== pageVersion) throw new Error(`页面版本不同步：${viewport}; expected=${pageVersion}; actual=${JSON.stringify(markers)}`);
      for (const selector of ['.hero .microcopy', '#install-guide .section-head p']) {
        const copy = await page.locator(selector).textContent();
        const source = /源码\s*v(\d+\.\d+\.\d+)/.exec(copy)?.[1];
        const packaged = /Windows 包内候选\s*v(\d+\.\d+\.\d+)/.exec(copy)?.[1];
        const ordinary = /普通EXE(?:已测)?\s*v(\d+\.\d+\.\d+)/.exec(copy)?.[1];
        if (source !== sourceVersion || packaged !== windowsVersion || ordinary !== windowsVersion) throw new Error(`候选说明不同步：${selector}; viewport=${viewport}; source=${source}; packaged=${packaged}; ordinary=${ordinary}; expected=${sourceVersion}/${windowsVersion}`);
        if (descriptor.releaseStatus === 'candidate-unpublished' && !copy.includes('尚未公开')) throw new Error(`未公开候选提示缺失：${viewport}/${selector}`);
        candidateCopies.push({ viewport, selector, source, packaged, ordinary });
      }
    }
    await verifyCopies(desktop, 'desktop');
    const brokenImages = await desktop.locator('img').evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src));
    if (brokenImages.length) throw new Error(`介绍页图片加载失败：${brokenImages.join(', ')}`);
    await desktop.screenshot({ path: path.join(output, 'site-desktop.png'), fullPage: true });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await mobile.goto(previewUrl, { waitUntil: 'networkidle' });
    await verifyCopies(mobile, 'mobile');
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`移动端出现 ${overflow}px 横向溢出`);
    await mobile.screenshot({ path: path.join(output, 'site-mobile.png'), fullPage: true });
    console.log(JSON.stringify({ ok: true, heading: heading.trim(), brokenImages, overflow, candidateCopies }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
