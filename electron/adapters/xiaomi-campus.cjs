// 小米校招岗位适配器（DOM 渲染模式）
// 与字节同源飞书 ATS，校招页 xiaomi.jobs.f.mioffice.cn/campus/position
// 复用 bytedance-campus.cjs 的 DOM 渲染逻辑，仅换 host。

const fs = require('node:fs');

const START_URL = 'https://xiaomi.jobs.f.mioffice.cn/campus/position';
const BROWSER_CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
};

function findBrowser() {
  return (BROWSER_CANDIDATES[process.platform] || []).find((p) => fs.existsSync(p));
}

async function listXiaomiCampusJobs({ recruitType = 'campus', onProgress } = {}) {
  const executablePath = findBrowser();
  if (!executablePath) {
    if (onProgress) onProgress({ error: '未找到 Chrome/Edge', collected: 0 });
    return [];
  }
  // 复用字节的解析逻辑
  const { parseCardText } = require('./bytedance-campus.cjs');
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  const collected = [];
  const seen = new Set();
  try {
    const page = await browser.newPage();
    await page.goto(START_URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    for (let scrollRound = 0; scrollRound < 8; scrollRound++) {
      const links = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('a[href*="/campus/position/"]').forEach((a) => {
          const text = a.innerText.trim();
          if (text.length > 10 && a.href.includes('/detail')) results.push({ href: a.href, text });
        });
        return results;
      });
      let newCount = 0;
      for (const link of links) {
        const parsed = parseCardText(link.text, link.href);
        const id = `xiaomi-campus-${parsed.postId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (recruitType === 'daily-intern' && parsed.jobType !== '日常实习') continue;
        if (recruitType === 'summer-intern' && !/实习/.test(parsed.jobType)) continue;
        collected.push({
          id, companyId: 'xiaomi',
          title: parsed.title, department: parsed.code || '小米', city: parsed.city,
          type: '全职', experience: '不限', education: '详见要求', salary: '',
          jobType: parsed.jobType, tags: [parsed.jobType].filter(Boolean),
          postedAt: '', source: '小米校招官网', favorite: false, match: 0,
          url: link.href, summary: link.text.slice(0, 120)
        });
        newCount += 1;
      }
      if (onProgress) onProgress({ scrollRound, collected: collected.length, latestJob: collected.length ? collected[collected.length - 1].title : '' });
      if (newCount === 0) break;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(2000);
    }
  } finally {
    await browser.close();
  }
  return collected;
}

module.exports = { listXiaomiCampusJobs };
