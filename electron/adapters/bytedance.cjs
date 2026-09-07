// 字节跳动社招岗位适配器
//
// 数据来源：jobs.bytedance.com（React SPA，岗位数据走 XHR JSON 接口）
//   两步法（无需登录账号，仅需 CSRF token）：
//   1. POST https://jobs.bytedance.com/api/v1/csrf/token  → 拿到 atsx-csrf-token cookie
//   2. POST https://jobs.bytedance.com/api/v1/search/job/posts （带 token cookie + Referer）→ 岗位 JSON
//
// 已知坑（2026-07-24 调研实测）：
//   - token 与会话绑定，几分钟到几十分钟失效（失效返回 405，不是 401）；
//   - 必须「取 token → 立即查岗位」在同一会话内完成；
//   - Referer 和完整 Chrome UA 强制校验，缺失会 405/空响应；
//   - keyword="" 返回全量（封顶 10000），keyword 具体值返回过滤结果；
//   - city 参数实测无效，城市筛选需拿到结果后本地按 city_info.name 过滤。

const https = require('node:https');

const HOST = 'jobs.bytedance.com';
const TOKEN_URL = 'https://jobs.bytedance.com/api/v1/csrf/token';
const SEARCH_URL = 'https://jobs.bytedance.com/api/v1/search/job/posts';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_TOTAL = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 轻量 cookie + JSON POST：返回 { status, json, cookies }
function request(method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(url, {
      timeout: 20000,
      method,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        Referer: 'https://jobs.bytedance.com/',
        Origin: 'https://jobs.bytedance.com',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'application/json, text/plain, */*',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      req.on('timeout', () => { req.destroy(new Error('字节接口超时(20s)')); });
      response.on('end', () => {
        // 收集 Set-Cookie（可能是数组）
        const setCookies = response.headers['set-cookie'] || [];
        const cookies = setCookies.map((line) => line.split(';')[0]).join('; ');
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* 非 JSON 响应 */ }
        resolve({ status: response.statusCode, json, cookies, raw: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('字节 API 请求超时')));
    if (payload) req.write(payload);
    req.end();
  });
}

// 合并两个 cookie 字符串
function mergeCookies(...parts) {
  const map = new Map();
  for (const part of parts.filter(Boolean)) {
    for (const pair of part.split(/;\s*/)) {
      const idx = pair.indexOf('=');
      if (idx > 0) map.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function normalizeJob(post) {
  const publishTime = Number(post.publish_time);
  const postedAt = publishTime > 0 ? new Date(publishTime).toISOString().slice(0, 10) : '';
  // 字节有 recruit_type，能真实区分社招/正式/实习（parent.name = 社招/校招）
  const recruitType = post.recruit_type?.parent?.name || '社招';
  const tags = [recruitType, post.job_category?.name].filter(Boolean);
  const city = post.city_info?.name || '未标注城市';
  return {
    id: `bytedance-${post.id}`,
    companyId: 'bytedance',
    title: post.title || '未命名岗位',
    department: post.code || '字节跳动',
    city,
    type: '全职',
    experience: '不限',
    education: '详见要求',
    salary: '',
    jobType: recruitType,
    tags,
    postedAt,
    source: '字节跳动招聘官网',
    favorite: false,
    match: 0,
    url: `https://jobs.bytedance.com/experienced/position/${post.id}/detail`,
    // 职责 + 任职要求拼接，字节两个文本都很完整
    summary: [post.description, post.requirement].filter(Boolean).join('\n\n任职要求：\n')
  };
}

/**
 * 抓取字节跳动社招岗位。
 * @param {Object} options
 * @param {number} options.daysBack 只保留最近 N 天内发布的岗位，默认 30
 * @param {number} options.pageSize 每页条数，默认 20
 * @param {Function} [options.onProgress] 进度回调
 * @returns {Promise<Array>}
 */
async function listBytedanceJobs({ daysBack = 30, pageSize = 20, recruitType = 'social', onProgress } = {}) {
  // 校招/实习模式：字节校招 API 需复杂 session，改用 playwright 渲染 DOM 抓取
  const isCampus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
  if (isCampus) {
    const { listBytedanceCampusJobs } = require('./bytedance-campus.cjs');
    return listBytedanceCampusJobs({ recruitType, onProgress });
  }
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysBack);

  // 第一步：取 CSRF token
  const tokenRes = await request('POST', TOKEN_URL, { body: { portal_entrance: 1 } });
  if (tokenRes.status !== 200 || !tokenRes.json?.data?.token) {
    throw new Error(`获取字节 CSRF token 失败（${tokenRes.status}）`);
  }
  let cookie = tokenRes.cookies; // 含 atsx-csrf-token=...

  const collected = [];
  const seen = new Set();
  let offset = 0;
  let total = 0;

  while (collected.length < MAX_TOTAL) {
    const res = await request('POST', SEARCH_URL, {
      body: { keyword: '', limit: pageSize, offset },
      cookie
    });

    if (res.status === 405) {
      // token 失效，重新取一次再重试本页
      const retry = await request('POST', TOKEN_URL, { body: { portal_entrance: 1 } });
      if (retry.json?.data?.token) {
        cookie = retry.cookies;
        const res2 = await request('POST', SEARCH_URL, { body: { keyword: '', limit: pageSize, offset }, cookie });
        if (res2.status !== 200 || !res2.json?.data) {
          if (onProgress) onProgress({ offset, error: `重试仍失败（${res2.status}）`, collected: collected.length });
          break;
        }
        Object.assign(res, { json: res2.json });
      } else {
        if (onProgress) onProgress({ offset, error: 'token 失效且刷新失败', collected: collected.length });
        break;
      }
    }

    if (res.status !== 200 || !res.json?.data) {
      if (onProgress) onProgress({ offset, error: `字节接口返回 ${res.status}`, collected: collected.length });
      break;
    }

    const posts = res.json.data.job_post_list || [];
    total = res.json.data.count || total;

    let tooOldCount = 0;
    for (const post of posts) {
      const job = normalizeJob(post);
      // 按用户选择的 recruitType 过滤：字节用 recruit_type.parent.name 区分社招/校招
      if (recruitType !== 'all') {
        const isCampus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
        const wantCampus = isCampus;
        const isJobCampus = job.jobType === '校招';
        if (wantCampus !== isJobCampus) continue;
      }
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      const posted = new Date(job.postedAt);
      if (job.postedAt && !Number.isNaN(posted.getTime()) && posted < cutoff) {
        tooOldCount += 1;
        continue;
      }
      collected.push(job);
    }

    if (onProgress) onProgress({ offset, fetched: posts.length, total, collected: collected.length, latestJob: collected.length ? collected[collected.length - 1].title : '' });

    if (posts.length < pageSize || tooOldCount === posts.length) break;
    offset += pageSize;
    await sleep(400);
  }

  return collected.slice(0, MAX_TOTAL);
}

module.exports = { listBytedanceJobs, normalizeJob, request };
