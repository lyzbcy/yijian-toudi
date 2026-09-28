// Boss 直聘批量投递引擎（2026-09-20 新增）
// 规则库沉淀自 2026-09-19 三轮实测（含三次筛选事故教训）：标题必须命中硬技术词，
// 轨道词限定在校可投，排除词覆盖非开发岗与垃圾岗特征。
// 安全：遇安全验证即停；频控 25-45s 随机间隔；dryRun 只走到详情不点沟通。
const TRACK = /实习|应届|校招|校园|培训生|管培/;
const TECH = /开发工程师|研发工程师|软件工程师|前端|后端|全栈|Java|java|Python|python|C\+\+|C#|Web开发|软件开发|游戏开发|游戏程序|Unity|U3D|UE4|UE5|算法|Agent|大模型|智能体|AI开发|AI应用|人工智能|Node|程序/;
const EXCL = /测试|客服|销售|运营|行政|人事|人力|猎头|咨询|医药|采购|地推|推广|市场|商务|文员|电销|招商|美术|策划|兼职|中介|体检|银行客服|陪玩|陪|日结|主播|娱乐|剪辑|写手|文案|家教|学徒|普工|操作工|UI设计|动作|原画|特效|建模|动画|体验|音效|关卡|项目申报|标注|数据标注|标注员|审核员/;

// 城市码为 Boss 官方代码；城市-轨道配对是用户 2026-09-20 口径：
// 武汉=只投实习（用户计划武汉实习）；上海/苏州/无锡=27届校招。
const CITY_CODES = {
  武汉: '101200100', 上海: '101020100', 苏州: '101190400', 无锡: '101190200', 杭州: '101210100'
};
const INTERN_QUERIES = ['游戏开发实习', 'AI开发实习', '前端开发实习', '后端开发实习', '软件开发实习', 'Unity开发实习', '大模型实习', '全栈开发实习', '小程序开发实习', '客户端开发实习', 'Node.js实习', '移动端开发实习'];
const CAMPUS_QUERIES = ['前端开发校招', '后端开发校招', '软件开发校招', '游戏开发校招', 'Java校招', '大模型校招', 'AI算法校招', '人工智能校招', '软件工程师校招', '算法校招'];

// 2026-09-21 扩池：杭州加入校招城市（用户口径"苏州/上海/杭州/无锡次之"）；每个查询抓 2 页
function defaultPlan() {
  return [
    ...INTERN_QUERIES.map((query) => ({ city: '武汉', query })),
    ...['上海', '苏州', '无锡', '杭州'].flatMap((city) => CAMPUS_QUERIES.map((query) => ({ city, query })))
  ].flatMap(({ city, query }) => [1, 2].map((page) => ({ city, query, page })));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function rand(min, max) { return min + Math.random() * (max - min); }

function extractJobLinks(snapshotJson) {
  const data = snapshotJson?.data || {};
  // 列表项内的岗位和公司必须成对读取；全页正则会把导航/其他公司的文字混进同一岗位。
  if (Array.isArray(data.tree)) {
    const jobs = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.role === 'listitem') {
        const directLinks = (node.children || []).filter((child) => child?.role === 'link' && child.ref);
        if (directLinks.length >= 2 && isTargetJob(directLinks[0].name || '')) {
          jobs.push({ title: directLinks[0].name, ref: directLinks[0].ref, company: directLinks[1].name || '' });
          return;
        }
      }
      for (const child of node.children || []) visit(child);
    };
    for (const node of data.tree) visit(node);
    return jobs;
  }
  // 旧版桥快照只有 links；不再用全页 JSON 正则猜测公司。
  return (Array.isArray(data.links) ? data.links : [])
    .filter((link) => link?.role === 'link' && link.ref && isTargetJob(link.name || ''))
    .map((link) => ({ title: link.name, ref: link.ref, company: link.company || '' }));
}

function searchUrlMatches(snapshotJson, query, cityCode, page) {
  try {
    const url = new URL(snapshotJson?.data?.url);
    if (url.hostname !== 'www.zhipin.com' || url.pathname !== '/web/geek/jobs') return false;
    // 老桥/部分测试桩不带 query；真实浏览器搜索结果必须核对 query，避免点旧页。
    if (!url.searchParams.has('query')) return false;
    return url.searchParams.get('query') === query &&
      url.searchParams.get('city') === cityCode &&
      Number(url.searchParams.get('page') || '1') === Number(page || 1);
  } catch { return false; }
}

function isTargetJob(title) {
  return TRACK.test(title) && TECH.test(title) && !EXCL.test(title);
}

function findRef(snapshotJson, label) {
  const s = JSON.stringify(snapshotJson);
  const m = new RegExp(`"name":\\s*"${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",\\s*"ref":\\s*"(@e\\d+)"`).exec(s);
  return m ? m[1] : null;
}

function rawHas(snapshotJson, text) {
  return JSON.stringify(snapshotJson).includes(text);
}

class BossBatchRunner {
  constructor({ bridge, notify, log, plan, target, dryRun, banCompanies, onApplied, noThrottle }) {
    this.bridge = bridge;            // 桥适配器（kimi-bridge 或 playwright-bridge-adapter，三方法契约：navigate/snapshot/click）
    this.notify = notify || (async () => {}); // 企微通知
    this.log = log || (() => {});
    this.plan = plan || defaultPlan();
    this.target = target || 60;
    this.dryRun = Boolean(dryRun);
    this.ban = banCompanies || [];
    // onApplied(entry)：每笔投出后的落盘回调（账号档案持久化，2026-09-22）
    this.onApplied = typeof onApplied === 'function' ? onApplied : null;
    // noThrottle：单测用，跳过投递间隔频控（生产禁用）
    this.noThrottle = Boolean(noThrottle);
    this.applied = [];
    this.previewed = [];
    this.fails = 0;
    this.stopped = false;
    this.stopReason = null;
    this.seenJobs = new Set();
  }

  stop(reason = 'manual') {
    this.stopped = true;
    this.stopReason = reason;
  }

  wait(ms) { return this.noThrottle ? Promise.resolve() : sleep(ms); }

  async run() {
    this.log(`boss-batch start target=${this.target} dryRun=${this.dryRun}`);
    let fails = 0;
    for (const { city, query, page } of this.plan) {
      if (this.stopped || (this.dryRun ? this.previewed.length : this.applied.length) >= this.target || fails >= 5) break;
      const code = CITY_CODES[city];
      if (!code) continue;
      const searchUrl = `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(query)}&city=${code}&page=${page || 1}`;
      try {
        await this.bridge.navigate(searchUrl);
      } catch (err) {
        fails += 1;
        this.log(`nav fail [${city}/${query}]: ${err.message}`);
        continue;
      }
      await this.wait(rand(3000, 6000));
      let snap;
      try {
        snap = await this.bridge.snapshot();
      } catch (err) {
        fails += 1;
        this.log(`snapshot fail: ${err.message}`);
        continue;
      }
      const snapRaw = JSON.stringify(snap);
      if (rawHas(snap, '安全验证')) {
        this.stop('security-check');
        await this.notify('【一键投递·异常】Boss 弹出安全验证，批量已自动停止，请人工处理。');
        break;
      }
      const loginPage = /BOSS直聘注册登录|微信扫码 安全登录|验证码登录\/注册|登录\/注册/.test(snapRaw);
      if (loginPage) {
        this.stop('login-required');
        await this.notify('【一键投递·需要你】Boss 登录态失效，批量已自动停止。请在浏览器重新登录后再启动。');
        this.log('stopped: login-required');
        break;
      }
      if (!searchUrlMatches(snap, query, code, page)) {
        this.log(`search mismatch (${String(snap?.data?.url || '').slice(0, 100)}), opening fresh search tab`);
        try {
          await this.bridge.navigate(searchUrl, { newTab: true });
          await this.wait(rand(3000, 6000));
          snap = await this.bridge.snapshot();
        } catch (err) {
          fails += 1;
          this.log(`re-navigate fail: ${err.message}`);
          continue;
        }
        if (rawHas(snap, '安全验证')) { this.stop('security-check'); break; }
        if (/BOSS直聘注册登录|微信扫码 安全登录|验证码登录\/注册|登录\/注册/.test(JSON.stringify(snap))) {
          this.stop('login-required');
          break;
        }
        if (!searchUrlMatches(snap, query, code, page)) {
          this.stop('search-mismatch');
          this.log(`stopped: search-mismatch expected=${searchUrl} actual=${String(snap?.data?.url || '').slice(0, 120)}`);
          break;
        }
      }
      for (let loading = 0; loading < 2 && extractJobLinks(snap).length === 0; loading += 1) {
        await this.wait(1500);
        try { snap = await this.bridge.snapshot(); }
        catch (err) { fails += 1; this.log(`loading snapshot fail: ${err.message}`); break; }
        if (rawHas(snap, '安全验证')) { this.stop('security-check'); break; }
        if (/BOSS直聘注册登录|微信扫码 安全登录|验证码登录\/注册|登录\/注册/.test(JSON.stringify(snap))) {
          this.stop('login-required');
          break;
        }
        if (!searchUrlMatches(snap, query, code, page)) { this.stop('search-mismatch'); break; }
      }
      if (this.stopped) break;
      const snapUrl = (snap && snap.data && snap.data.url) || '';
      const snapLinks = extractJobLinks(snap);
      const snapHits = snapLinks.filter((l) => isTargetJob(l.title)).length;
      this.log(`snapshot ${snapUrl.slice(0, 80)} links=${snapLinks.length} hits=${snapHits}`);
      for (const link of extractJobLinks(snap)) {
        if (this.stopped || (this.dryRun ? this.previewed.length : this.applied.length) >= this.target || fails >= 5) break;
        if (!isTargetJob(link.title)) continue;
        const dedupeKey = `${link.company || '?'}:${link.title}`;
        if (this.seenJobs.has(dedupeKey)) continue;
        this.seenJobs.add(dedupeKey);
        try {
          const detail = await this.applyOne(link, city);
          if (detail === 'skip') continue;
          if (detail?.preview) {
            this.previewed.push({ city, title: link.title, company: detail.company });
            continue;
          }
          if (detail) {
            const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), city, title: link.title, company: detail.company || '' };
            this.applied.push(entry);
            this.log(`OK [${city}] ${link.title} @ ${detail.company || '?'}`);
            if (this.onApplied) {
              try { await this.onApplied(entry); }
              catch (e) { this.log(`persist applied fail: ${e.message}`); this.stop('persist-failed'); }
            }
          } else {
            fails += 1;
            this.log(`MISS [${city}] ${link.title}`);
          }
        } catch (err) {
          fails += 1;
          this.log(`apply error: ${err.message}`);
          if (String(err.message).includes('security')) break;
        }
        if (!this.dryRun && !this.stopped && this.applied.length < this.target) await this.wait(rand(25000, 45000));
      }
    }
    this.fails = fails;
    this.stopReason = this.stopReason || 'completed';
    this.stopped = true;
    this.log(`boss-batch done applied=${this.applied.length} previewed=${this.previewed.length} fails=${fails} stop=${this.stopReason}`);
    return { applied: this.applied, previewed: this.previewed, fails, stopReason: this.stopReason };
  }

  // 返回 true=投出 / false=未投出 / 'skip'=主动跳过
  async applyOne(link, city) {
    if (link.company && (this.ban.includes(link.company) || this.applied.some((a) => a.company === link.company))) return 'skip';
    const clicked = await this.bridge.click(link.ref, { timeoutMs: 20000 });
    if (!clicked || !clicked.data || !clicked.data.success) return false;
    await this.wait(rand(2500, 5000));
    const snap = await this.bridge.snapshot();
    if (rawHas(snap, '安全验证')) {
      this.stop('security-check');
      throw new Error('security-check');
    }
    if (rawHas(snap, '登录/注册')) { this.stop('login-required'); return 'skip'; }
    const company = link.company || '';
    if (!company) return 'skip';
    if (rawHas(snap, '已向BOSS发送消息')) return 'skip';
    const btn = findRef(snap, '立即沟通');
    if (!btn) return 'skip';
    if (this.dryRun) {
      this.log(`dryRun [${city}] ${link.title} @ ${company || '?'}（未发送）`);
      return { preview: true, company };
    }
    const sentClick = await this.bridge.click(btn, { timeoutMs: 20000 });
    if (!sentClick?.data?.success) { this.stop('send-unverified'); return false; }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.wait(rand(2500, 4500));
      let after;
      try { after = await this.bridge.snapshot(); }
      catch (error) {
        this.stop('send-unverified');
        throw error;
      }
      if (rawHas(after, '已向BOSS发送消息')) {
        const stay = findRef(after, '留在此页');
        if (stay) { try { await this.bridge.click(stay, { timeoutMs: 15000 }); } catch {} }
        return { company };
      }
    }
    // 点击已发生但结果不明时绝不继续下一个岗位，防止重复或漏记。
    this.stop('send-unverified');
    return false;
  }
}

module.exports = { BossBatchRunner, defaultPlan, isTargetJob, extractJobLinks, searchUrlMatches, CITY_CODES, INTERN_QUERIES, CAMPUS_QUERIES };
