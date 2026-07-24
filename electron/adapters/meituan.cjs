// 美团社招岗位适配器
//
// 数据来源：zhaopin.meituan.com（自研前端）
//   POST https://zhaopin.meituan.com/api/official/job/getJobList
//   body { pageSize, pageNo, cityList:[], categoryList:[] }
//
// 特点：POST 匿名可读（GET 会报错），字段标准。
// 实测 2026-07-24：返回 data.list[]，含 name/jobUnionId/jobType 等。

const https = require('node:https');

const LIST_URL = 'https://zhaopin.meituan.com/api/official/job/getJobList';
const REFERER = 'https://zhaopin.meituan.com/web/social';
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
        Origin: 'https://zhaopin.meituan.com',
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
    req.setTimeout(20_000, () => req.destroy(new Error('美团 API 请求超时')));
    req.write(payload);
    req.end();
  });
}

function normalizeJob(item) {
  // 美团时间字段是毫秒时间戳：refreshTime（最近刷新）/ firstPostTime（首次发布）
  const ts = item.refreshTime || item.firstPostTime;
  const postedAt = ts ? new Date(Number(ts)).toISOString().slice(0, 10) : '';
  // workYear 是数值（0=不限,3=3年以上,K=应届等），转成可读
  const workYearMap = { 0: '不限', 1: '1年以上', 3: '3年以上', 5: '5年以上', 10: '10年以上', K: '应届' };
  return {
    id: `meituan-${item.jobUnionId || item.id}`,
    companyId: 'meituan',
    title: item.name || '未命名岗位',
    department: item.projectName || item.department || '美团',
    city: item.cityList?.[0]?.name || '未标注城市',
    type: '全职',
    experience: workYearMap[item.workYear] || item.workYear || '不限',
    education: item.education || '详见要求',
    salary: '薪资面议',
    tags: [item.jobFamily, item.tag?.name].filter(Boolean),
    postedAt,
    source: '美团招聘官网',
    favorite: false,
    match: 0,
    url: `https://zhaopin.meituan.com/web/social/position/${item.jobUnionId || item.id}`,
    summary: item.jobDuty || item.desc || ''
  };
}

async function listMeituanJobs({ daysBack = 30, pageSize = 20, onProgress } = {}) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysBack);

  const collected = [];
  const seen = new Set();
  let pageNo = 1;
  let total = 0;

  while (collected.length < MAX_TOTAL) {
    const res = await postJson(LIST_URL, { pageSize, pageNo, cityList: [], categoryList: [] });
    if (res.status !== 200 || !res.json?.data) {
      if (onProgress) onProgress({ pageNo, error: `美团接口返回 ${res.status}`, collected: collected.length });
      break;
    }

    const items = res.json.data.list || res.json.data.records || [];
    total = res.json.data.total || res.json.data.count || total;

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

module.exports = { listMeituanJobs, normalizeJob, postJson };
