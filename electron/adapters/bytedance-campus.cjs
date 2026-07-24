// 字节跳动校招岗位适配器（DOM 渲染模式）
//
// 字节校招 API 的 session 逆向较复杂（前端 JS 计算 header），
// 这里改用 playwright 渲染校招页，从 DOM 读取岗位（agent.md 推荐的"浏览器自动化爬取"方式）。
//
// 数据来源：jobs.bytedance.com/campus/position（React SPA，渲染后 DOM 有岗位卡片）
// 慢于 API（需等渲染），但稳定且能拿到实习类型细分（日常实习/校招等）。

const fs = require('node:fs');

const START_URL = 'https://jobs.bytedance.com/campus/position';
const BROWSER_CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
};

function findBrowser() {
  return (BROWSER_CANDIDATES[process.platform] || []).find((p) => fs.existsSync(p));
}

// 从岗位卡片的文本提取结构化字段
function parseCardText(text, href) {
  // text 格式示例：
  // "商业产品（短剧出海方向）实习生 - 国际化内容与服务广告\n北京实习产品日常实习职位 ID：A19916"
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  const secondLine = lines[1] || '';
  // 标题在第一行，城市+类型在第二行
  const title = firstLine;
  // 从第二行提取城市（中文城市名在前）
  const cityMatch = secondLine.match(/(北京|上海|深圳|杭州|广州|成都|武汉|南京|苏州|无锡)/);
  const city = cityMatch ? cityMatch[1] : '未标注城市';
  // 实习类型：日常实习/暑期实习/校招
  let jobType = '校招';
  if (/日常实习/.test(secondLine)) jobType = '日常实习';
  else if (/暑期实习/.test(secondLine)) jobType = '暑期实习';
  else if (/实习/.test(secondLine)) jobType = '实习';
  else if (/校招/.test(secondLine)) jobType = '校招';
  // 职位 ID
  const idMatch = secondLine.match(/职位 ?ID[：:]([A-Z0-9]+)/);
  const code = idMatch ? idMatch[1] : '';
  // 从 href 提取岗位数字 ID
  const postIdMatch = href.match(/position\/(\d+)\//);
  const postId = postIdMatch ? postIdMatch[1] : '';
  return { title, city, jobType, code, postId };
}

/**
 * 抓取字节校招岗位（DOM 渲染模式）。
 * @param {Object} options
 * @param {string} options.recruitType 'campus'|'summer-intern'|'daily-intern'
 * @param {Function} [options.onProgress]
 * @returns {Promise<Array>}
 */
async function listBytedanceCampusJobs({ recruitType = 'campus', onProgress } = {}) {
  const executablePath = findBrowser();
  if (!executablePath) {
    if (onProgress) onProgress({ error: '未找到 Chrome/Edge，无法渲染字节校招页', collected: 0 });
    return [];
  }
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  const collected = [];
  const seen = new Set();
  try {
    const page = await browser.newPage();
    await page.goto(START_URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    // 翻页：滚动加载 + 点击"加载更多"（字节用滚动或分页按钮）
    for (let scrollRound = 0; scrollRound < 10; scrollRound++) {
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
        const id = `bytedance-campus-${parsed.postId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        // 按用户选的 recruitType 过滤
        if (recruitType === 'daily-intern' && parsed.jobType !== '日常实习') continue;
        if (recruitType === 'summer-intern' && !/实习/.test(parsed.jobType)) continue;
        collected.push({
          id, companyId: 'bytedance',
          title: parsed.title, department: parsed.code || '字节跳动', city: parsed.city,
          type: '全职', experience: '不限', education: '详见要求', salary: '',
          jobType: parsed.jobType, tags: [parsed.jobType].filter(Boolean),
          postedAt: '', source: '字节跳动校招官网', favorite: false, match: 0,
          url: link.href, summary: link.text.slice(0, 120)
        });
        newCount += 1;
      }
      if (onProgress) onProgress({ scrollRound, collected: collected.length, latestJob: collected.length ? collected[collected.length - 1].title : '' });
      if (newCount === 0) break; // 没有新岗位了
      // 滚动到底部触发加载
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(2000);
    }
  } finally {
    await browser.close();
  }
  return collected;
}

module.exports = { listBytedanceCampusJobs, parseCardText, findBrowser };
