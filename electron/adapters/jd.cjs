// 京东社招岗位适配器
//
// 数据来源：zhaopin.jd.com（传统 jQuery+seajs，干净 REST 接口）
//   POST https://zhaopin.jd.com/web/job/job_list  body { pageNo, pageSize, jobType:3 }
//   POST https://zhaopin.jd.com/web/job/job_count → 总数
//
// 特点：无 token、无 Referer 校验、字段规整。实测 2026-07-24 总数≈1708。
// jobType: 3=社招（首页推荐位用其他 type，列表页固定 3）。

const https = require('node:https');

const LIST_URL = 'https://zhaopin.jd.com/web/job/job_list';
const COUNT_URL = 'https://zhaopin.jd.com/web/job/job_count';
const REFERER = 'https://zhaopin.jd.com/web/job/job_info_list/3';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_TOTAL = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        Referer: REFERER,
        Origin: 'https://zhaopin.jd.com',
        'Content-Length': Buffer.byteLength(payload),
        Accept: 'application/json, text/plain, */*'
      }
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* 非 JSON */ }
        resolve({ status: response.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('京东 API 请求超时')));
    req.write(payload);
    req.end();
  });
}

function normalizeJob(item) {
  // 京东日期字段 formatPublishTime 如 "2026-07-15"，publishTime 为时间戳
  const postedAt = item.formatPublishTime || (item.publishTime ? new Date(Number(item.publishTime)).toISOString().slice(0, 10) : '');
  return {
    id: `jd-${item.positionId}`,
    companyId: 'jd',
    title: item.positionName || item.positionNameOpen || '未命名岗位',
    department: item.positionDeptName || '京东',
    city: item.workCity || item.workPlace || item.city || '未标注城市',
    type: '全职',
    experience: item.workYear || '不限',
    education: item.education || '详见要求',
    salary: '',
    jobType: '社招',
    tags: ['社招', item.jobType].filter(Boolean),
    postedAt,
    source: '京东招聘官网',
    favorite: false,
    match: 0,
    url: `https://zhaopin.jd.com/web/job/job_detail/${item.positionId}`,
    summary: [item.workContent, item.qualification].filter(Boolean).join('\n\n任职资格：\n')
  };
}

async function listJdJobs({ daysBack = 30, pageSize = 20, recruitType = 'social', onProgress } = {}) {
  // 京东校招在独立站 campus.jd.com，社招 API 无法切换。校招需真人抓包适配，暂返回空。
  const isCampus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
  if (isCampus) {
    if (onProgress) onProgress({ error: '京东校招在独立站 campus.jd.com，待抓包适配', collected: 0 });
    return [];
  }
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysBack);

  const collected = [];
  const seen = new Set();
  let pageNo = 1;
  let total = 0;

  while (collected.length < MAX_TOTAL) {
    const res = await postJson(LIST_URL, { pageNo, pageSize, jobType: 3 });
    if (res.status !== 200 || !res.json) {
      if (onProgress) onProgress({ pageNo, error: `京东接口返回 ${res.status}`, collected: collected.length });
      break;
    }

    // 京东返回结构：数组直接在 res.json 里（item 列表），或包在某字段下。先探测。
    const items = Array.isArray(res.json) ? res.json : (res.json.data || res.json.list || res.json.result || []);
    if (!Array.isArray(items)) {
      // 尝试拿总数
      const countRes = await postJson(COUNT_URL, { jobType: 3 });
      total = countRes.json?.count || countRes.json?.total || 0;
      if (onProgress) onProgress({ pageNo, error: '返回结构非数组，需适配', collected: collected.length, raw: res.raw.slice(0, 200) });
      break;
    }
    if (!total && items.length > 0) {
      const countRes = await postJson(COUNT_URL, { jobType: 3 }).catch(() => null);
      total = countRes?.json?.count || countRes?.json?.total || 0;
    }

    let tooOldCount = 0;
    for (const item of items) {
      const job = normalizeJob(item);
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      const posted = new Date(job.postedAt);
      if (job.postedAt && !Number.isNaN(posted.getTime()) && posted < cutoff) { tooOldCount += 1; continue; }
      collected.push(job);
    }

    if (onProgress) onProgress({ pageNo, fetched: items.length, total, collected: collected.length, latestJob: collected.length ? collected[collected.length - 1].title : '' });
    if (items.length < pageSize || tooOldCount === items.length) break;
    pageNo += 1;
    await sleep(400);
  }

  return collected.slice(0, MAX_TOTAL);
}

module.exports = { listJdJobs, normalizeJob, postJson };
