// 百度社招岗位适配器
//
// 数据来源：talent.baidu.com 社招列表页（SSR，岗位数据嵌在首屏 HTML 的 window.__INITIAL_DATA__）
//   GET https://talent.baidu.com/jobs/social-list?search={关键词}
//   每次请求返回一页约 10 条，翻页靠换关键词分批覆盖。
//
// 特点（优于腾讯）：
//   - 首屏就带 serviceCondition（任职要求全文）和 workContent（工作内容全文），不用进详情页；
//   - 不需要登录、不需要 CSRF 令牌，直接 GET HTML 解析即可。
//
// 已知坑（2026-07-24 实测）：
//   - __INITIAL_DATA__ 是 JS 字面量不是严格 JSON，含 undefined，需替换成 null 再 JSON.parse；
//   - 赋值后紧跟其他 script，不能用行尾做边界，要用括号深度配平提取完整 JSON；
//   - education / workYears 字段常为空字符串，需兜底；
//   - 每页固定 10 条，全量需按关键词遍历。

const https = require('node:https');

// 社招用 social-list，校招用 list（两个 SSR 页面结构一致，校招页含 recruitType 字段区分 GRADUATE/INTERN/SOCIAL）
const SOCIAL_BASE = 'https://talent.baidu.com/jobs/social-list';
const CAMPUS_BASE = 'https://talent.baidu.com/jobs/list';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_TOTAL = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchText(url, referer) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Referer: referer || url,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`百度社招页返回 ${response.statusCode}`));
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    });
    request.on('error', reject);
    request.setTimeout(20_000, () => request.destroy(new Error('百度社招页请求超时')));
    request.end();
  });
}

// 从 HTML 里按括号深度配平提取 __INITIAL_DATA__ 的完整 JSON 对象
function extractInitialData(html) {
  const marker = '__INITIAL_DATA__';
  const markerIdx = html.indexOf(marker);
  if (markerIdx < 0) return null;
  const eq = html.indexOf('=', markerIdx);
  if (eq < 0) return null;
  let i = html.indexOf('{', eq);
  if (i < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = html.slice(html.indexOf('{', eq), i + 1);
        // 百度的赋值含 undefined 等 JS 字面量，替换成 null 让 JSON.parse 通过
        return JSON.parse(raw.replace(/\bundefined\b/g, 'null'));
      }
    }
  }
  return null;
}

function normalizeJob(post, mode) {
  // 百度用 updateDate 作为活跃时间（比 publishDate 新），用它做日期过滤和排序
  const date = post.updateDate || post.publishDate || '';
  // 校招页无 recruitType 字段，用抓取模式决定 jobType
  const jobType = mode === 'campus' ? '校招' : '社招';
  const tags = [jobType, post.postType, post.bgShortName].filter(Boolean);
  return {
    id: `baidu-${post.postId}`,
    companyId: 'baidu',
    title: post.name || '未命名岗位',
    department: post.bgShortName || '百度',
    city: post.workPlace || '未标注城市',
    type: '全职',
    experience: post.workYears || '不限',
    education: post.education || '详见要求',
    salary: '',
    jobType,
    tags,
    postedAt: date,
    source: '百度招聘官网',
    favorite: false,
    match: 0,
    url: `https://talent.baidu.com/jobs/social-list/detail/${post.postId}`,
    // 百度首屏即带工作内容 + 任职要求全文，拼接让摘要更丰富
    summary: [post.workContent, post.serviceCondition].filter(Boolean).join('\n\n任职要求：\n')
  };
}

// 默认关键词列表：覆盖百度主流技术方向，每个关键词约返回 10 条
const DEFAULT_KEYWORDS = ['java', '前端', 'python', 'go', 'c++', '算法', '产品', '测试', '数据', '运维', '安全', '设计'];

/**
 * 抓取百度岗位。
 * @param {Object} options
 * @param {number} options.daysBack 只保留最近 N 天内更新的岗位，默认 30
 * @param {string} options.recruitType 'social'|'campus'|'summer-intern'|'daily-intern'|'all'，决定走社招页还是校招页
 * @param {string[]} options.keywords 关键词列表，默认覆盖主流方向
 * @param {Function} [options.onProgress] 进度回调 ({ keyword, fetched, keep })
 * @returns {Promise<Array>} 归一化后的岗位数组
 */
async function listBaiduJobs({ daysBack = 30, recruitType = 'social', keywords = DEFAULT_KEYWORDS, onProgress } = {}) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysBack);

  // 校招/实习方向走 campus 页（/jobs/list，本身就是校招数据），社招/all 走 social 页
  const isCampus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
  const base = isCampus ? CAMPUS_BASE : SOCIAL_BASE;

  const seen = new Set();
  const collected = [];

  for (const keyword of keywords) {
    if (collected.length >= MAX_TOTAL) break;
    const url = `${base}?search=${encodeURIComponent(keyword)}`;
    let html;
    try {
      html = await fetchText(url, base);
    } catch (error) {
      if (onProgress) onProgress({ keyword, error: error.message, collected: collected.length });
      await sleep(500);
      continue;
    }
    const data = extractInitialData(html);
    const posts = data?.listData?.listDetailData || [];
    let keep = 0;
    for (const post of posts) {
      const job = normalizeJob(post, isCampus ? 'campus' : 'social');
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      const updated = new Date(job.postedAt);
      // 日期过滤：解析失败（NaN）的保守保留
      if (!Number.isNaN(updated.getTime()) && updated < cutoff) continue;
      collected.push(job);
      keep += 1;
    }
    if (onProgress) onProgress({ keyword, fetched: posts.length, keep, collected: collected.length, latestJob: collected.length ? collected[collected.length - 1].title : '' });
    await sleep(500); // 控频
  }

  return collected.slice(0, MAX_TOTAL);
}

module.exports = { listBaiduJobs, normalizeJob, extractInitialData, fetchText };
