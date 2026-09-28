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
  const s = JSON.stringify(snapshotJson);
  const links = [];
  const re = /"role":\s*"link",\s*"name":\s*"([^"]{3,60})",\s*"ref":\s*"(@e\d+)"/g;
  let m;
  while ((m = re.exec(s)) !== null) links.push({ title: m[1], ref: m[2] });
  return links;
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
    this.fails = 0;
    this.stopped = false;
    this.stopReason = null;
    this.seenTitles = new Set();
  }

  stop(reason = 'manual') {
    this.stopped = true;
    this.stopReason = reason;
  }

  async run() {
    this.log(`boss-batch start target=${this.target} dryRun=${this.dryRun}`);
    let fails = 0;
    for (const { city, query, page } of this.plan) {
      if (this.stopped || this.applied.length >= this.target || fails >= 5) break;
      const code = CITY_CODES[city];
      if (!code) continue;
      try {
        await this.bridge.navigate(`https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(query)}&city=${code}&page=${page || 1}`);
      } catch (err) {
        fails += 1;
        this.log(`nav fail [${city}/${query}]: ${err.message}`);
        continue;
      }
      await sleep(rand(3000, 6000));
      let snap;
      try {
        snap = await this.bridge.snapshot();
      } catch (err) {
        fails += 1;
        this.log(`snapshot fail: ${err.message}`);
        continue;
      }
      const snapUrl = (snap && snap.data && snap.data.url) || '';
      const snapLinks = extractJobLinks(snap);
      const snapHits = snapLinks.filter((l) => isTargetJob(l.title)).length;
      this.log(`snapshot ${snapUrl.slice(0, 80)} links=${snapLinks.length} hits=${snapHits}`);
      // 未登录/SEO 城市页检测：无岗位链接且页面呈 SEO 形态 —— 立即停止并提醒重新登录
      const snapRaw = JSON.stringify(snap);
      const seoPage = /「[^」]{2,8}招聘」/.test(snapRaw) || /热门城市|附近城市/.test(snapRaw);
      if (snapLinks.length === 0 && seoPage) {
        this.stop('login-required');
        await this.notify('【一键投递·需要你】Boss 登录态失效（搜索页跳到未登录城市页），批量已自动停止。请在浏览器重新扫码登录后再启动。');
        this.log('stopped: login-required (SEO page detected)');
        break;
      }
      if (!snapUrl.includes('zhipin.com')) {
        // 桥的 session tab 停在其他页面（如官网投递残留 tab），导航未生效：重试一次
        this.log(`snapshot on non-boss page (${snapUrl.slice(0, 60)}), re-navigating`);
        try {
          await this.bridge.navigate(`https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(query)}&city=${code}&page=${page || 1}`);
          await sleep(rand(3000, 6000));
          snap = await this.bridge.snapshot();
        } catch (err) {
          fails += 1;
          this.log(`re-navigate fail: ${err.message}`);
          continue;
        }
      }
      if (rawHas(snap, '安全验证')) {
        this.stop('security-check');
        await this.notify('【一键投递·异常】Boss 弹出安全验证，批量已自动停止，请人工处理。');
        break;
      }
      for (const link of extractJobLinks(snap)) {
        if (this.stopped || this.applied.length >= this.target || fails >= 5) break;
        if (!isTargetJob(link.title)) continue;
        const dedupeKey = link.title.slice(0, 18);
        if (this.seenTitles.has(dedupeKey)) continue;
        this.seenTitles.add(dedupeKey);
        try {
          const detail = await this.applyOne(link, city);
          if (detail === 'skip') continue;
          if (detail) {
            const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), city, title: link.title, company: detail.company || '' };
            this.applied.push(entry);
            this.log(`OK [${city}] ${link.title} @ ${detail.company || '?'}`);
            if (this.onApplied) { try { this.onApplied(entry); } catch (e) { this.log(`persist applied fail: ${e.message}`); } }
          } else {
            fails += 1;
            this.log(`MISS [${city}] ${link.title}`);
          }
        } catch (err) {
          fails += 1;
          this.log(`apply error: ${err.message}`);
          if (String(err.message).includes('security')) break;
        }
        if (!this.noThrottle) await sleep(rand(25000, 45000));
      }
    }
    this.log(`boss-batch done applied=${this.applied.length} fails=${fails} stop=${this.stopReason || 'completed'}`);
    this.fails = fails;
    return { applied: this.applied, fails, stopReason: this.stopReason || 'completed' };
  }

  // 返回 true=投出 / false=未投出 / 'skip'=主动跳过
  async applyOne(link, city) {
    const clicked = await this.bridge.click(link.ref, { timeoutMs: 20000 });
    if (!clicked || !clicked.data || !clicked.data.success) return false;
    await sleep(rand(2500, 5000));
    const snap = await this.bridge.snapshot();
    if (rawHas(snap, '安全验证')) {
      this.stop('security-check');
      throw new Error('security-check');
    }
    // 已投公司去重（详情页前 6000 字符粗查，公司名提取不可靠时保守跳过）
    const head = JSON.stringify(snap).slice(0, 6000);
    if (this.ban.some((name) => head.includes(name))) return 'skip';
    if (this.applied.some((a) => a.company && head.includes(a.company))) return 'skip';
    const companyMatch = /"role":\s*"link",\s*"name":\s*"([^"]{2,30})",\s*"ref":\s*"@e\d+"[^}]*?zhipin\.com\/gongsi/.exec(head);
    const company = companyMatch ? companyMatch[1] : '';
    const btn = findRef(snap, '立即沟通');
    if (!btn) return 'skip';
    if (this.dryRun) {
      this.log(`dryRun [${city}] ${link.title} @ ${company || '?'}（未发送）`);
      return 'skip';
    }
    await this.bridge.click(btn, { timeoutMs: 20000 });
    await sleep(rand(2500, 4500));
    const after = await this.bridge.snapshot();
    const sent = rawHas(after, '已向BOSS发送消息');
    if (sent) {
      const stay = findRef(after, '留在此页');
      if (stay) { try { await this.bridge.click(stay, { timeoutMs: 15000 }); } catch {} }
      return { company };
    }
    return false;
  }
}

module.exports = { BossBatchRunner, defaultPlan, isTargetJob, CITY_CODES, INTERN_QUERIES, CAMPUS_QUERIES };
