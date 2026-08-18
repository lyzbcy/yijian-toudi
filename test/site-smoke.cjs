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
    const brokenImages = await desktop.locator('img').evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src));
    if (brokenImages.length) throw new Error(`介绍页图片加载失败：${brokenImages.join(', ')}`);
    await desktop.screenshot({ path: path.join(output, 'site-desktop.png'), fullPage: true });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await mobile.goto(previewUrl, { waitUntil: 'networkidle' });
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`移动端出现 ${overflow}px 横向溢出`);
    await mobile.screenshot({ path: path.join(output, 'site-mobile.png'), fullPage: true });
    console.log(JSON.stringify({ ok: true, heading: heading.trim(), brokenImages, overflow }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
