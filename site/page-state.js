(function () {
  'use strict';
  // One metadata request and at most one automatic navigation for each target
  // page version in this tab. Do not clear the marker when updated HTML arrives:
  // a CDN may later serve the old document again within the same session.
  var pageVersion = Number(document.documentElement.getAttribute('data-page-v'));
  var banner = document.getElementById('g-load');
  function manualNotice(text) {
    banner.textContent = text + '，请点“一键刷新”。';
    banner.style.display = 'block';
  }
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 8000);
  fetch('./version.json?t=' + Date.now(), { cache: 'no-store', signal: controller.signal })
    .then(function (response) {
      if (!response.ok) throw new Error('version-http');
      return response.json();
    })
    .then(function (remote) {
      if (!Number.isSafeInteger(remote.v) || remote.v <= 0 || remote.v > 1000000000 || remote.v === pageVersion) return;
      var key = 'yjt:refresh-to:' + remote.v;
      try {
        if (sessionStorage.getItem(key)) {
          manualNotice('新内容尚未加载，已停止自动刷新');
          return;
        }
        sessionStorage.setItem(key, '1');
        if (sessionStorage.getItem(key) !== '1') throw new Error('storage-write');
      } catch (error) {
        manualNotice('浏览器未保存刷新记录');
        return;
      }
      banner.textContent = '内容已更新，正在刷新一次…';
      banner.style.display = 'block';
      setTimeout(function () {
        var next = new URL(location.href);
        next.searchParams.set('_page_v', String(remote.v));
        location.replace(next.href);
      }, 800);
    })
    .catch(function () { /* Offline preview stays usable; manual refresh remains available. */ })
    .finally(function () { clearTimeout(timeout); });

  document.getElementById('forceRefreshBtn').addEventListener('click', function () {
    var next = new URL(location.href);
    next.searchParams.set('_refresh', String(Date.now()));
    location.replace(next.href);
  });

  var logs = [
    { version: '0.5.95', date: '2026-10-26', status: '源码开发候选，尚未公开', text: 'Agent引导与反馈排障、Windows主题整合；安装验收另记。' },
    { version: '0.5.94', date: '2026-10-26', status: '统一刷新真实联调修正版，尚未公开', text: '修复已复核单封邮件与网申回执同分钟时未推进、未挂正文安排的边界，保留手动阶段门禁。' },
    { version: '0.5.93', date: '2026-10-26', status: '统一投递状态刷新开发版，尚未公开', text: '双邮箱、已支持官网、局部覆盖和失败分列；Agent复核单封关联与含当天时限。' },
    { version: '0.5.92', date: '2026-10-26', status: '智联校园与路径分账开发版，尚未公开', text: '智联校园可见岗位读取、Agent正式网申与typed回执；聊天、平台简历、企业ATS分账。' },
    { version: '0.5.91', date: '2026-10-26', status: '右侧待办工作栏开发版，尚未公开', text: '项目在左、待办常驻右上，详情同栏展示，保留正文同步与Agent纳管。' },
    { version: '0.5.90', date: '2026-10-26', status: '正文安排与Agent纳管开发版，尚未公开', text: '正文提取时间与链接、Agent回执自动纳管；阶段项目优先显示。' },
    { version: '0.5.89', date: '2026-10-26', status: '投递驾驶舱开发版，尚未公开', text: '阶段流水线、紧急待办与详情；保留双邮箱同步。' },
    { version: '0.5.88', date: '2026-10-26', status: '多邮箱进度核对开发候选，尚未公开', text: 'QQ/江南大学分邮箱连接；主题分类纠正与历史进度核对，未知岗位待确认。' },
    { version: '0.5.86', date: '2026-10-26', status: '投递管理开发候选，尚未公开', text: '手动阶段与历史、QQ邮箱精确匹配和可选10分钟同步；官网投递成功证据独立保留。' },
    { version: '0.5.85', date: '2026-10-23', status: '多来源岗位与内部账本候选，尚未公开', text: '保留既有来源，新增OfferBiu可见页只读入库；国聘状态观察与内部申请账本展示，实际官网填写与投递另验。' },
    { version: '0.5.84', date: '2026-10-22', status: 'Skill整合候选，尚未公开', text: '操作入口去历史堆叠，官网流程优先复用平台与简历；授权范围内连续推进，阻塞与回执门禁保持。' },
    { version: '0.5.83', date: '2026-10-22', status: '通用官网 Agent 协作候选，尚未公开', text: '持久任务、缺资料续办、未知提交防重与外部同步分账；浏览器 Agent 协助未知官网，覆盖率待实测。' },
    { version: '0.5.82', date: '2026-10-22', status: 'AI-Native 操作契约候选，尚未公开', text: '新手可选推荐、内置可复制 Skill 与鉴权能力发现；软件改版协作保留原页人工确认和真实回执。' },
    { version: '0.5.81', date: '2026-10-22', status: '本机自动保存与公司专属答案候选，尚未公开', text: '通用资料一次填写；公司问题独立保存；自动保存失败保留输入，冲突不覆盖新档案。官网保存和投递仍分开核验。' },
    { version: '0.5.80', date: '2026-10-22', status: '新增平台人工核对入口候选，尚未公开', text: '哔哩哔哩、米哈游、快手加入简历核对队列；不把门户打开当保存或投递。' },
    { version: '0.5.79', date: '2026-10-21', status: '日志持久化开发候选，尚未公开', text: '增加批量落盘、轮换与排障开关，Boss展示阶段/目标/剩余估算；真实投递回执单独记录。' },
    { version: '0.5.78', date: '2026-10-10', status: '小窗局部CSS适应候选，尚未公开', text: '按当前页面实际尺寸适应；100%与放大/还原保持原会话。保留77真实认证与完整验收，78包/现场另验；完整MVP仍待。' },
    { version: '0.5.77', date: '2026-10-10', status: '源码认证修复候选，尚未公开', text: '真实六窗发现JD认证iframe误判及登录裁切；共用认证门禁，77包/现场验收以项目记录为准，完整MVP尚待。' },
    { version: '0.5.76', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '源码版本已同步；功能与验收结果以项目文档为准，不代表已公开发布。' },
    { version: '0.5.75', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '源码版本已同步；功能与验收结果以项目文档为准，不代表已公开发布。' },
    { version: '0.5.74', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '源码版本已同步；功能与验收结果以项目文档为准，不代表已公开发布。' },
    { version: '0.5.73', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '修岗位城市按钮竖排；实际包筛选45/45、引导26/26及普通SAMPLE冷重开13/13。尚未公开，默认安装/官网/公众闭环另验。' },
    { version: '0.5.72', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '源码版本已同步；功能与验收结果以项目文档为准，不代表已公开发布。' },
    { version: '0.5.71', date: '2026-10-10', status: 'Windows与Skill开发候选，尚未公开', text: '定时任务完整回执、未知跨日暂停及账号launch锁；后台49/49、1205单测、实际Skill包HTTP12/12 SAMPLE。Windows131源/ZIP78 SHA、包内引导26/26与独立空档案方向/部署说明已验；默认安装、七站闭环与完整MVP仍待。' },
    { version: '0.5.70', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '源码版本已同步；功能与验收结果以项目文档为准，不代表已公开发布。' },
    { version: '0.5.69', date: '2026-10-10', status: 'Windows开发候选，尚未公开', text: '修空档案默认36%及起步误勾，旧档案按当前事实派生完成度，seed深副本隔离。实际普通EXE首启0%及旧36%冷重开归零，包内引导26/26与字节28/28 SAMPLE；介绍页安装说明已与首页候选一致，PAGE66。默认安装、七站闭环和完整MVP仍待。' },
    { version: '0.5.68', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '源码版本已同步；功能与验收结果以项目文档为准，不代表已公开发布。' },
    { version: '0.5.67', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '本地预览关闭精确核验同PID主窗，避免关闭空标题辅助窗；正常WM_CLOSE、不强杀、15秒等待不变。真实普通→AI入口11/11；Windows最后65、实装53，完整MVP继续验收。' },
    { version: '0.5.66', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '批量更新时间乱序回包与重开旧目录保护；真实隔离renderer4/7→7/7。保存证据不降级，Windows最后65、实装53；完整MVP仍在验收。' },
    { version: '0.5.65', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '字节项目差异确认、私有备份、保留添加入口的逐步重建与原页续填；未知只查，未确认不删。真实官网替换/保存尚待，Windows最后61、实装53；完整MVP继续验收。' },
    { version: '0.5.64', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '字节项目名称、顺序或数量不一致时停止上传及填写；展示差异，官网手动对齐后可在原页核对续填。日期和文本绑定项目名，续填等待中改档案会停止。字节自动项目替换仍待，Windows最后61、实装53；完整MVP继续验收。' },
    { version: '0.5.63', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '字节校招年月控件接入原页任务、超时原句柄查询与只读续填；已有文本和项目保留，不自动保存。Windows最后61、实装53；官网和分发继续验收。' },
    { version: '0.5.62', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '修复显式校招登录被改成社招；统一沿用平台轨道映射，实习归校招、all先拆轨道。Windows最后61、普通61 SAMPLE、实装53；真实官网更新、公开分发和完整视频继续验收。' },
    { version: '0.5.61', date: '2026-10-09', status: 'Windows开发候选，尚未公开', text: '修复旧定位、同步事件换节点及换轨后的误写，保留美团、字节、京东语义定位与原页任务。实际Windows61包内受控77项、普通EXE隔离SAMPLE启动/重开8项通过；不等于61官网更新或用户默认安装。七平台、公开分发和完整视频继续验收。' },
    { version: '0.5.60', date: '2026-10-09', status: '源码开发候选，尚未公开', text: '源码60增加显式证件枚举及美团官网存储只读核验；本机真实只读核验server34/34、DOM33/33，不冒充新的保存/投递。受控原生21项通过，不等于其它平台闭环。Windows最后候选59，普通57、实装53；Windows60、七平台和公众分发仍在验收。' },
    { version: '0.5.50', date: '2026-10-07', status: 'Windows 本地候选，尚未公开', text: '修复简历页标题与平台状态窄列；完整官网保存、投递和公众分发仍在验收。' },
    { version: '0.3.1', date: '', status: '历史版本记录，下载以发布页为准', text: '七平台更新入口、附件上传与进度侧栏。入口存在不代表当前官网闭环全部通过。' },
    { version: '0.3.0', date: '', status: '历史版本记录', text: '多档案、Agent API、一键更新骨架。' },
    { version: '0.2.0', date: '', status: '历史版本记录', text: '腾讯适配、备份与脱敏。' }
  ];
  logs.sort(function (a, b) {
    var x = a.version.split('.').map(Number), y = b.version.split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var delta = (y[i] || 0) - (x[i] || 0);
      if (delta) return delta;
    }
    return 0;
  });
  var list = document.getElementById('changelogList');
  logs.forEach(function (entry) {
    var p = document.createElement('p');
    p.style.margin = '0 0 12px';
    p.textContent = 'v' + entry.version + (entry.date ? ' · ' + entry.date : '') + ' — ' + entry.status + '：' + entry.text;
    list.appendChild(p);
  });
  document.getElementById('changelogBtn').addEventListener('click', function () {
    document.getElementById('changelogDialog').showModal();
  });
})();
