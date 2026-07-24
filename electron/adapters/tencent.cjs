// 腾讯社招岗位适配器
//
// 数据来源：careers.tencent.com 公开 JSON API（社招岗位列表，未登录可读全量）
//   GET https://careers.tencent.com/tencentcareer/api/post/Query
//   GET https://careers.tencent.com/tencentcareer/api/post/ByPostId  （详情，按需）
//
// 设计原则（见 doc/integrations/browser-automation.md）：
//   - 拉岗位阶段直接调 API，不依赖浏览器自动化，快且稳；
//   - 投递阶段才需要浏览器 + 登录态，由 automation.cjs 负责，不在本模块。
//   - 不伪造数据：API 返回什么就映射什么，缺失字段如实标注。
//
// 已知坑（2026-07-23 实测）：
//   - 部门字段是 BGName，不是老教程里的 DepartmentName；
//   - 列表接口不含学历，学历在详情接口的 Requirement 里，这里先标“待进详情”；
//   - 用缓存的旧 postId 调详情可能 500，详情调用必须用列表里拿到的最新 PostId。

const https = require('node:https');

const ENDPOINT = 'https://careers.tencent.com/tencentcareer/api/post/Query';
const REFERER = 'https://careers.tencent.com/search.html';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 单次全量抓取的岗位数硬上限，防止 API 行为异常时失控
const MAX_TOTAL = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Referer: REFERER,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`腾讯 API 返回 ${response.statusCode}`));
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`腾讯 API 返回内容无法解析为 JSON：${error.message}`));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(20_000, () => {
      request.destroy(new Error('腾讯 API 请求超时'));
    });
    request.end();
  });
}

// 把 "2026年07月23日" 解析成 Date；解析失败返回 null（保守处理，不丢数据）
function parseTencentDate(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

// 把一个腾讯 API Post 对象归一化成项目统一岗位结构
function normalizePost(post) {
  const postedDate = parseTencentDate(post.LastUpdateTime);
  return {
    id: `tencent-${post.PostId}`,
    companyId: 'tencent',
    title: post.RecruitPostName || '未命名岗位',
    department: post.BGName || '未标注事业群',
    city: post.LocationName || '未标注城市',
    type: '全职',
    experience: post.RequireWorkYearsName || '不限',
    education: '待进详情',
    salary: '',
    jobType: '社招',
    tags: ['社招', post.CategoryName, post.ProductName].filter(Boolean),
    postedAt: postedDate ? postedDate.toISOString().slice(0, 10) : '',
    source: '腾讯招聘官网',
    favorite: false,
    match: 0,
    url: post.PostURL || `https://careers.tencent.com/jobdesc.html?postId=${post.PostId}`,
    summary: post.Responsibility || ''
  };
}

/**
 * 抓取腾讯社招岗位。
 * @param {Object} options
 * @param {number} options.daysBack 只抓取最近 N 天内发布的岗位，默认 30
 * @param {number} options.pageSize 每页条数，默认 50
 * @param {Function} [options.onProgress] 每抓完一页回调 ({ page, fetched, total, keep })
 * @returns {Promise<Array>} 归一化后的岗位数组
 */
async function listTencentJobs({ daysBack = 30, pageSize = 50, recruitType = 'social', onProgress } = {}) {
  // 腾讯校招是独立站 join.qq.com，社招 API 无法切换。校招需真人抓包适配，暂返回空。
  const isCampus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
  if (isCampus) {
    if (onProgress) onProgress({ error: '腾讯校招在独立站 join.qq.com，待抓包适配', collected: 0 });
    return [];
  }
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysBack);

  const collected = [];
  let pageIndex = 1;
  let total = 0;
  let stop = false;

  while (!stop && collected.length < MAX_TOTAL) {
    const url = `${ENDPOINT}?timestamp=${Date.now()}&pageIndex=${pageIndex}&pageSize=${pageSize}&language=zh-cn&area=cn`;
    let payload;
    try {
      payload = await fetchJson(url);
    } catch (error) {
      // 单页失败不致命：已抓到的保留，记录后中止本次抓取
      if (onProgress) onProgress({ page: pageIndex, error: error.message, collected: collected.length });
      break;
    }

    if (payload.Code !== 200 || !payload.Data) {
      break;
    }

    const posts = payload.Data.Posts || [];
    total = payload.Data.Count || total;

    let tooOldThisPage = 0;
    for (const post of posts) {
      const job = normalizePost(post);
      const posted = parseTencentDate(post.LastUpdateTime);
      // 截止日期无法判定时，保守保留（宁可多留也不误丢）
      if (posted && posted < cutoff) {
        tooOldThisPage += 1;
        continue;
      }
      collected.push(job);
    }

    if (onProgress) onProgress({ page: pageIndex, fetched: posts.length, total, collected: collected.length, latestJob: collected.length ? collected[collected.length - 1].title : '' });

    // 本页大部分都早于截止日期 → 已经翻到老数据区，可以停了
    // 阈值放宽到整页都过时才停，避免边界处误停（API 按更新时间排，偶尔有回填）
    if (posts.length > 0 && tooOldThisPage === posts.length) {
      stop = true;
    }
    // 没有更多数据了
    if (posts.length < pageSize) {
      stop = true;
    }

    pageIndex += 1;
    await sleep(300); // 控频，给腾讯服务器留口气
  }

  return collected.slice(0, MAX_TOTAL);
}

module.exports = { listTencentJobs, normalizePost, parseTencentDate, fetchJson };
