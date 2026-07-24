// 腾讯校招岗位适配器
//
// 数据来源：join.qq.com 腾讯校招独立站（SPA，岗位数据走 XHR JSON API）
//   POST https://join.qq.com/api/v1/position/searchPosition
//   body: { projectMappingIdList:[], keyword, pageIndex, pageSize, ... }
//
// 抓包方式：playwright headless Chrome 打开 post.html 拦截 XHR 发现（2026-07-24）。
// 匿名可访问（不需要登录）。recruitLabelName 字段能区分实习类型（应届实习/日常实习等）。
//
// 已知字段（recruitLabelName 实测值）：应届实习 / 日常实习 等
// projectMappingId 决定项目类型：2=应届实习，其他=校招等（getProjectMapping 接口可查）

const https = require('node:https');

const ENDPOINT = 'https://join.qq.com/api/v1/position/searchPosition';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_TOTAL = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        Origin: 'https://join.qq.com',
        Referer: 'https://join.qq.com/post.html',
        'Content-Length': Buffer.byteLength(payload),
        Accept: 'application/json, text/plain, */*'
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('腾讯校招 API 请求超时')));
    req.write(payload);
    req.end();
  });
}

function normalizeJob(item, recruitLabel) {
  const tags = [recruitLabel || '校招', item.projectName].filter(Boolean);
  // workCities 是空格分隔的字符串 "深圳总部 北京 上海"
  const city = (item.workCities || '').split(/\s+/).filter(Boolean)[0] || '未标注城市';
  // bgs 是空格分隔的事业群 "CDG CSIG IEG"
  const department = (item.bgs || '').split(/\s+/).filter(Boolean)[0] || '腾讯';
  return {
    id: `tencent-campus-${item.id}`,
    companyId: 'tencent',
    title: item.positionTitle || '未命名岗位',
    department,
    city,
    type: '全职',
    experience: '不限',
    education: '详见要求',
    salary: '',
    jobType: recruitLabel || '校招',
    tags,
    postedAt: '',
    source: '腾讯校招官网',
    favorite: false,
    match: 0,
    url: item.positionUrl || `https://join.qq.com/post_detail.html?postId=${item.postId}`,
    summary: `${item.projectName || ''} ${item.recruitLabelName || ''} · 事业群: ${(item.bgs||'').trim()}`.trim()
  };
}

/**
 * 抓取腾讯校招岗位。
 * @param {Object} options
 * @param {number} options.daysBack 校招岗通常无精确发布日期，此参数主要用于兼容接口（不过滤）
 * @param {string} options.recruitType 'campus'|'summer-intern'|'daily-intern'，决定 projectMappingIdList
 * @param {Function} [options.onProgress]
 * @returns {Promise<Array>}
 */
async function listTencentCampusJobs({ recruitType = 'campus', onProgress } = {}) {
  // projectMappingIdList: 2=应届实习(暑期/日常)，空=全部校招项目
  // 用户选 daily-intern 时可以靠 recruitLabelName 后过滤，但项目级别先用 [2] 拉实习池
  const projectMappingIdList = ['summer-intern', 'daily-intern'].includes(recruitType) ? [2] : [];
  const collected = [];
  const seen = new Set();
  let pageIndex = 1;
  const pageSize = 20;

  while (collected.length < MAX_TOTAL) {
    const res = await postJson(`${ENDPOINT}?timestamp=${Date.now()}`, {
      projectMappingIdList,
      keyword: '',
      bgList: [],
      workCountryType: 0,
      workCityList: [],
      recruitCityList: [],
      positionFidList: [],
      pageIndex,
      pageSize
    });

    if (res.status !== 200 || res.json?.status !== 0) {
      if (onProgress) onProgress({ pageIndex, error: `腾讯校招接口返回 ${res.status}`, collected: collected.length });
      break;
    }

    const posts = res.json?.data?.positionList || [];
    if (posts.length === 0) break;

    for (const post of posts) {
      const job = normalizeJob(post, post.recruitLabelName);
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      collected.push(job);
    }

    if (onProgress) onProgress({ pageIndex, fetched: posts.length, collected: collected.length, latestJob: collected.length ? collected[collected.length - 1].title : '' });
    if (posts.length < pageSize) break;
    pageIndex += 1;
    await sleep(400);
  }

  return collected.slice(0, MAX_TOTAL);
}

module.exports = { listTencentCampusJobs, normalizeJob, postJson };
