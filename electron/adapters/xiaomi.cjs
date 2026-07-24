// 小米社招岗位适配器
//
// 数据来源：xiaomi.jobs.f.mioffice.cn（飞书 mioffice ATS，与字节 jobs.bytedance.com 同一套系统）
// 技术路径与 bytedance.cjs 完全一致：CSRF token 两步法。
//
// 实测（2026-07-24）：匿名 csrf 流程通，count≈2109，字段含 title/description/requirement/city_info.name 等。

const https = require('node:https');

const HOST = 'xiaomi.jobs.f.mioffice.cn';
const TOKEN_URL = 'https://xiaomi.jobs.f.mioffice.cn/api/v1/csrf/token';
const SEARCH_URL = 'https://xiaomi.jobs.f.mioffice.cn/api/v1/search/job/posts';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_TOTAL = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function request(method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(url, {
      method,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        Referer: 'https://xiaomi.jobs.f.mioffice.cn/',
        Origin: 'https://xiaomi.jobs.f.mioffice.cn',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'application/json, text/plain, */*',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        const setCookies = response.headers['set-cookie'] || [];
        const cookies = setCookies.map((line) => line.split(';')[0]).join('; ');
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* 非 JSON */ }
        resolve({ status: response.statusCode, json, cookies, raw: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('小米 API 请求超时')));
    if (payload) req.write(payload);
    req.end();
  });
}

function normalizeJob(post) {
  const publishTime = Number(post.publish_time);
  const postedAt = publishTime > 0 ? new Date(publishTime).toISOString().slice(0, 10) : '';
  const recruitType = post.recruit_type?.parent?.name || '社招';
  const tags = [recruitType, post.job_category?.name].filter(Boolean);
  return {
    id: `xiaomi-${post.id}`,
    companyId: 'xiaomi',
    title: post.title || '未命名岗位',
    department: post.code || '小米',
    city: post.city_info?.name || '未标注城市',
    type: '全职',
    experience: '不限',
    education: '详见要求',
    salary: '',
    jobType: recruitType,
    tags,
    postedAt,
    source: '小米招聘官网',
    favorite: false,
    match: 0,
    url: `https://xiaomi.jobs.f.mioffice.cn/experienced/position/${post.id}/detail`,
    summary: [post.description, post.requirement].filter(Boolean).join('\n\n任职要求：\n')
  };
}

async function listXiaomiJobs({ daysBack = 30, pageSize = 20, recruitType = 'social', onProgress } = {}) {
  // 校招/实习模式：用 playwright 渲染 DOM 抓取（同字节飞书 ATS）
  const isCampus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
  if (isCampus) {
    const { listXiaomiCampusJobs } = require('./xiaomi-campus.cjs');
    return listXiaomiCampusJobs({ recruitType, onProgress });
  }
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysBack);

  const tokenRes = await request('POST', TOKEN_URL, { body: { portal_entrance: 1 } });
  if (tokenRes.status !== 200 || !tokenRes.json?.data?.token) {
    throw new Error(`获取小米 CSRF token 失败（${tokenRes.status}）`);
  }
  let cookie = tokenRes.cookies;

  const collected = [];
  const seen = new Set();
  let offset = 0;
  let total = 0;

  while (collected.length < MAX_TOTAL) {
    const res = await request('POST', SEARCH_URL, { body: { keyword: '', limit: pageSize, offset }, cookie });

    if (res.status === 405) {
      const retry = await request('POST', TOKEN_URL, { body: { portal_entrance: 1 } });
      if (retry.json?.data?.token) {
        cookie = retry.cookies;
        const res2 = await request('POST', SEARCH_URL, { body: { keyword: '', limit: pageSize, offset }, cookie });
        if (res2.status !== 200 || !res2.json?.data) break;
        Object.assign(res, { json: res2.json });
      } else break;
    }

    if (res.status !== 200 || !res.json?.data) {
      if (onProgress) onProgress({ offset, error: `小米接口返回 ${res.status}`, collected: collected.length });
      break;
    }

    const posts = res.json.data.job_post_list || [];
    total = res.json.data.count || total;

    let tooOldCount = 0;
    for (const post of posts) {
      const job = normalizeJob(post);
      // 按用户选择的 recruitType 过滤（同字节飞书 ATS）
      if (recruitType !== 'all') {
        const wantCampus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
        if (wantCampus !== (job.jobType === '校招')) continue;
      }
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      const posted = new Date(job.postedAt);
      if (job.postedAt && !Number.isNaN(posted.getTime()) && posted < cutoff) { tooOldCount += 1; continue; }
      collected.push(job);
    }

    if (onProgress) onProgress({ offset, fetched: posts.length, total, collected: collected.length, latestJob: collected.length ? collected[collected.length - 1].title : '' });
    if (posts.length < pageSize || tooOldCount === posts.length) break;
    offset += pageSize;
    await sleep(400);
  }

  return collected.slice(0, MAX_TOTAL);
}

module.exports = { listXiaomiJobs, normalizeJob, request };
