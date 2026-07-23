const fs = require('node:fs');
const path = require('node:path');

const CHROME_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium']
};

function findBrowserExecutable() {
  return (CHROME_CANDIDATES[process.platform] || []).find((candidate) => fs.existsSync(candidate)) || null;
}

class BrowserAutomation {
  constructor(userDataDirectory) {
    this.userDataDirectory = userDataDirectory;
    this.context = null;
  }

  async openPortal(company) {
    const executablePath = findBrowserExecutable();
    if (!executablePath) {
      throw new Error('未找到 Chrome 或 Edge，请先安装浏览器');
    }
    const { chromium } = require('playwright-core');
    if (!this.context) {
      const profile = path.join(this.userDataDirectory, 'browser-profile');
      fs.mkdirSync(profile, { recursive: true });
      this.context = await chromium.launchPersistentContext(profile, {
        executablePath,
        headless: false,
        viewport: null,
        locale: 'zh-CN',
        args: ['--start-maximized']
      });
      this.context.on('close', () => { this.context = null; });
    }
    const page = this.context.pages()[0] || await this.context.newPage();
    await page.goto(company.portal, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.bringToFront();
    return { ok: true, url: page.url(), browser: path.basename(executablePath) };
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
  }
}

module.exports = { BrowserAutomation, findBrowserExecutable };
