(() => {
  'use strict';

  const pageMeta = {
    jobs: ['JOB BOARD', '招聘项目', '把不同公司的岗位放在一张清单里比较。'],
    cart: ['CART', '投递购物车', '挑好的岗位放这里，按公司分组，检查投递限制后一键投递。'],
    applied: ['APPLIED', '已投递', '追踪已投岗位的状态变化。'],
    resume: ['MY RESUME', '我的简历', '维护一份完整信息，按不同平台字段映射。'],
    inbox: ['RECRUITING INBOX', '招聘信息', '统一查看面试、测评、Offer 和流程通知。'],
    automation: ['AUTOMATION', '自动化中心', '看清每一次自动化执行到了哪里。'],
    connections: ['CONNECTIONS', '公司与邮箱', '连接真实浏览器和 QQ 邮箱。'],
    agent: ['LOCAL API', '连接 AI Agent', '把求职数据安全地开放给本机 Agent。'],
    settings: ['SETTINGS', '设置', '管理更新、接口与隐私选项。']
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let state = null;
  let activeFilter = 'all';
  let activeStage = '全部';
  let selectedMessageId = null;
  // 岗位列表分页：真实数据可能上千条，一次全渲染会卡顿甚至崩溃，默认只渲染前若干条
  let jobPageSize = 50;
  // 公司标签筛选：null=不限，'500强'/'AI公司'/'游戏'/'无锡'/'苏州'=只显示该公司标签下的岗位
  let activeTag = null;

  function toast(message, type = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    $('#toastRegion').appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  // 能力矩阵 helpers：取代旧的 adapterStatus === 'adapter-ready' 判断
  // 主区门槛：jobs 至少 degraded（能抓到岗位，哪怕降级）；完全 unsupported 的进次区折叠
  function isPrimaryCompany(c) {
    const j = c?.capabilities?.jobs;
    return j && j !== 'unsupported';
  }
  // 点公司卡片：jobs verified 直接打开官网浏览；否则走嵌入式登录/接管
  function companyClickMode(c) {
    return c?.capabilities?.jobs === 'verified' ? 'browse' : 'login';
  }
  // 五维能力徽章：5 个小圆点 + 中文首字，颜色按 verified/manual/degraded/unsupported 区分
  function renderCapabilityBadge(caps) {
    const order = [['jobs', '岗位'], ['login', '登录'], ['resume', '简历'], ['apply', '投递'], ['status', '状态']];
    const dots = order.map(([key, label]) => {
      const v = caps?.[key] || 'unsupported';
      return `<span class="cap-dot cap-${v}" title="${label}：${({ verified: '已验证', manual: '可手动接管', degraded: '降级可用', unsupported: '未适配' })[v]}">${label[0]}</span>`;
    }).join('');
    return `<span class="cap-badge">${dots}</span>`;
  }

  // 统一渲染公司 logo：有 logoUrl 用图片（加载失败自动回退字母方块），否则用品牌色字母方块
  function renderLogo(company, sizeClass = '') {
    if (company?.logoUrl) {
      return `<img class="company-logo-img ${sizeClass}" src="${escapeHtml(company.logoUrl)}" alt="${escapeHtml(company.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="company-logo ${sizeClass}" style="background:${company.color};display:none">${escapeHtml(company.short)}</span>`;
    }
    return `<span class="company-logo ${sizeClass}" style="background:${company.color}">${escapeHtml(company.short)}</span>`;
  }

  // 把 ISO 日期转成“今天 / N 天前”这类相对描述，比满屏匹配度 0 更有信息量
  function relativeDate(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    if (days <= 0) return '今天发布';
    if (days === 1) return '昨天发布';
    if (days < 7) return `${days} 天前`;
    if (days < 30) return `${Math.floor(days / 7)} 周前`;
    return iso;
  }

  function navigate(page) {
    $$('.page').forEach((node) => node.classList.toggle('active', node.id === `page-${page}`));
    $$('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.page === page));
    const [eyebrow, title, subtitle] = pageMeta[page];
    $('#pageEyebrow').textContent = eyebrow;
    $('#pageTitle').textContent = title;
    $('#pageSubtitle').textContent = subtitle;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function companyMap() {
    return Object.fromEntries(state.companies.map((company) => [company.id, company]));
  }

  function renderState() {
    if (!state) return;
    const companies = companyMap();
    const favorites = state.jobs.filter((job) => job.favorite).length;
    const unread = state.messages.filter((message) => message.unread).length;

    $('#jobCount').textContent = state.jobs.length;
    $('#cartCount').textContent = (state.cart || []).length;
    $('#appliedCount').textContent = (state.applied || []).length;
    $('#resumeBadge').textContent = `${state.resume.completion || 0}%`;
    $('#unreadCount').textContent = unread;
    $('#heroJobCount').textContent = state.jobs.length;
    $('#heroCompanyCount').textContent = state.companies.length;
    $('#favoriteCount').textContent = favorites;
    $('#statJobs').textContent = state.jobs.length;
    $('#statCompanies').textContent = state.companies.length;
    $('#statFavorites').textContent = favorites;
    $('#statTasks').textContent = state.tasks.length;
    $('#dataModeLabel').textContent = state.jobs.length > 0 ? '真实数据' : '未抓取';
    $('#resumeCompletion').textContent = `${state.resume.completion || 0}%`;
    $('#resumeRing').style.setProperty('--percent', `${state.resume.completion || 0}%`);
    $('#emailStatus').textContent = state.settings.email.connected ? '已连接' : '未连接';
    $('#emailAddress').value = state.settings.email.address || '';
    $('#githubRepo').value = state.settings.githubRepo || '';
    $('#autoUpdate').checked = Boolean(state.settings.autoCheckUpdates);
    $('#apiEnabled').checked = Boolean(state.settings.apiEnabled);
    $('#apiPort').value = state.settings.apiPort;
    $('#apiAddress').textContent = `127.0.0.1:${state.settings.apiPort}`;
    $('#jobsDaysBack').value = state.settings.jobs?.daysBack ?? 30;
    $('#recruitType').value = state.settings.jobs?.recruitType ?? 'social';
    const lastRefresh = state.settings.jobs?.lastRefreshAt;
    $('#jobsLastRefresh').textContent = lastRefresh ? `上次抓取：${new Date(lastRefresh).toLocaleString('zh-CN')}` : '还没有抓取过岗位。';

    renderCompanies();
    renderTagFilters();
    renderJobs();
    renderMessages();
    renderTasks();
    renderRefreshProgress();
    renderCart();
    renderApplied();
    renderProfileTabs();
    fillResume();
    renderAgentPrompt();

    if (!$('#companyFilter').dataset.ready) {
      $('#companyFilter').innerHTML = `<option value="">所有公司</option>${state.companies.map((company) => `<option value="${company.id}">${escapeHtml(company.name)}</option>`).join('')}`;
      $('#companyFilter').dataset.ready = '1';
    }
  }

  function filteredJobs() {
    const query = $('#jobSearch').value.trim().toLowerCase();
    const companyId = $('#companyFilter').value;
    const companies = companyMap();
    const jobs = state.jobs.filter((job) => {
      // 公司标签过滤：只保留公司 tags 含 activeTag 的岗位
      if (activeTag) {
        const company = companies[job.companyId];
        if (!company?.tags?.includes(activeTag)) return false;
      }
      if (companyId && job.companyId !== companyId) return false;
      if (activeFilter === 'favorite' && !job.favorite) return false;
      if (!['all', 'favorite'].includes(activeFilter) && job.city !== activeFilter) return false;
      if (!query) return true;
      return [job.title, companies[job.companyId]?.name, job.city, job.department, ...job.tags].join(' ').toLowerCase().includes(query);
    });
    const sort = $('#sortJobs').value;
    return jobs.sort((a, b) => {
      if (sort === 'date') return b.postedAt.localeCompare(a.postedAt);
      if (sort === 'company') return (companies[a.companyId]?.name || '').localeCompare(companies[b.companyId]?.name || '', 'zh-CN');
      return b.match - a.match;
    });
  }

  function renderJobs() {
    const companies = companyMap();
    const jobs = filteredJobs();
    const empty = $('#jobEmpty');
    if (jobs.length > 0) {
      empty.classList.add('hidden');
    } else {
      // 区分两种空：从未抓取 vs 有数据但筛选无结果
      const hasAnyJobs = state.jobs.length > 0;
      empty.classList.remove('hidden');
      empty.innerHTML = hasAnyJobs
        ? '<span>⌕</span><h3>没有找到匹配岗位</h3><p>换个关键词或清空筛选试试。</p>'
        : '<span>↻</span><h3>还没有岗位数据</h3><p>点击下方按钮，从各大厂招聘官网抓取真实岗位。</p><button class="primary-button" data-empty-refresh>刷新全部岗位</button>';
    }
    const visible = jobs.slice(0, jobPageSize);
    const hasMore = jobs.length > jobPageSize;
    $('#jobList').innerHTML = visible.map((job) => {
      const company = companies[job.companyId] || { name: job.source || '未知公司', short: '?', color: '#999999' };
      const posted = relativeDate(job.postedAt);
      // logo 优先用图片，没有则用字母兜底
      const logo = renderLogo(company);
      // tag 区分类型：实习类用橙色，社招用紫色，其他灰色
      const internTypes = ['实习', '可转正实习', '日常实习', '不可转正实习', '暑期实习', '校招'];
      const tagHtml = job.tags.filter(Boolean).map((tag) => {
        const cls = internTypes.some((t) => tag.includes(t)) ? 'tag-intern' : (tag === '社招' ? 'tag-social' : '');
        return `<span class="${cls}">${escapeHtml(tag)}</span>`;
      }).join('');
      // summary 截断显示前 2 行（完整内容在详情弹窗）
      const summaryPreview = job.summary ? escapeHtml(job.summary.split('\n')[0].slice(0, 80)) + (job.summary.length > 80 ? '…' : '') : '';
      return `<article class="job-item" data-job-id="${job.id}">
        <div class="company-logo-wrap">${logo}</div>
        <div class="job-main">
          <h4>${escapeHtml(job.title)}</h4>
          <p>${escapeHtml(company.name)} · ${escapeHtml(job.department)} · ${escapeHtml(job.city)}${job.experience && job.experience !== '不限' ? ' · ' + escapeHtml(job.experience) : ''}</p>
          ${summaryPreview ? `<p class="job-summary">${summaryPreview}</p>` : ''}
          <div class="job-tags">${tagHtml}<span class="source-pill">${escapeHtml(job.source)}</span></div>
        </div>
        <div class="job-time"><i class="fresh-dot"></i>${posted || escapeHtml(job.postedAt)}</div>
        <div class="job-actions">
          <button class="favorite-button ${state.cart?.some((c) => c.id === job.id) ? 'active' : ''}" data-cart="${escapeHtml(job.id)}" title="${state.cart?.some((c) => c.id === job.id) ? '移出购物车' : '加入购物车'}">🛒</button>
          <button class="favorite-button ${job.favorite ? 'active' : ''}" data-favorite="${job.id}" title="收藏">★</button>
        </div>
      </article>`;
    }).join('') + (hasMore ? `<div class="load-more"><button class="ghost-button" data-load-more>显示更多岗位（剩余 ${jobs.length - jobPageSize} 个）</button></div>` : '');
  }

  // 公司展示分两区：主区放 jobs≥degraded 的（五维徽章），次区折叠 jobs=unsupported 的。
  function renderCompanies() {
    const primary = state.companies.filter(isPrimaryCompany);
    const soon = state.companies.filter((c) => !isPrimaryCompany(c));
    const primaryEl = $('#companyGridPrimary');
    const soonEl = $('#companyGridSoon');
    if (primaryEl) primaryEl.innerHTML = primary.map(renderCompanyCard).join('');
    if (soonEl) soonEl.innerHTML = soon.map(renderCompanyCard).join('');
    const soonCount = $('#soonCount');
    if (soonCount) soonCount.textContent = `${soon.length} 家公司`;
  }

  function renderCompanyCard(company) {
    const badge = renderCapabilityBadge(company.capabilities);
    const dateHtml = company.lastVerifiedAt
      ? `<span class="verified-date" title="最后验证日期">${escapeHtml(company.lastVerifiedAt)}</span>`
      : '<span class="verified-date placeholder">未验证</span>';
    return `<div class="company-button" data-company="${company.id}">
      <span class="company-logo-wrap-sm">${renderLogo(company)}</span>
      <span class="company-name">${escapeHtml(company.name)}</span>
      ${badge}
      ${dateHtml}
    </div>`;
  }

  // 渲染公司标签筛选 chip：从所有公司的 tags 聚合去重
  function renderTagFilters() {
    const tagSet = new Set();
    for (const company of state.companies) for (const tag of company.tags || []) tagSet.add(tag);
    const tags = [...tagSet];
    const tagColors = { '500强': '#ef9a55', 'AI公司': '#6657e8', '游戏': '#37a67a', '无锡': '#548ddd', '苏州': '#548ddd' };
    $('#tagFilterRow').innerHTML = `<button class="tag-chip ${activeTag === null ? 'active' : ''}" data-tag="">全部公司</button>` + tags.map((tag) => `<button class="tag-chip ${activeTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${tagColors[tag] ? `<i class="tag-dot" style="background:${tagColors[tag]}"></i>` : ''}${escapeHtml(tag)}</button>`).join('');
  }

  function renderMessages() {
    const stages = ['全部', ...new Set(state.messages.map((message) => message.stage))];
    $('#stageTabs').innerHTML = stages.map((stage) => `<button class="${activeStage === stage ? 'active' : ''}" data-stage="${stage}">${stage} <span>${stage === '全部' ? state.messages.length : state.messages.filter((message) => message.stage === stage).length}</span></button>`).join('');
    const messages = state.messages.filter((message) => activeStage === '全部' || message.stage === activeStage);
    if (messages.length === 0) {
      $('#messageList').innerHTML = `<div class="empty-state"><span>✉</span><h3>还没有招聘邮件</h3><p>连接 QQ 邮箱后，这里会自动同步面试、测评和 Offer 邮件。</p><button class="ghost-button" data-page="connections">去连接邮箱</button></div>`;
    } else {
      $('#messageList').innerHTML = messages.map((message) => `<article class="message-item ${message.unread ? 'unread' : ''} ${message.id === selectedMessageId ? 'active' : ''}" data-message="${message.id}">
        <span class="message-company">${escapeHtml(message.company.slice(0, 1))}</span>
        <div><h4>${escapeHtml(message.subject)}</h4><p>${escapeHtml(message.company)} · ${escapeHtml(message.preview)}</p></div>
        <div class="message-side"><time>${escapeHtml(message.receivedAt.slice(5))}</time><span class="stage-pill">${escapeHtml(message.stage)}</span></div>
      </article>`).join('');
    }
    if (selectedMessageId) showMessage(selectedMessageId, false);
  }

  function showMessage(id, rerender = true) {
    selectedMessageId = id;
    const message = state.messages.find((item) => item.id === id);
    if (!message) return;
    $('#messageDetail').innerHTML = `<div class="detail-head">
      <span class="stage-pill">${escapeHtml(message.stage)}</span>
      <h3>${escapeHtml(message.subject)}</h3>
      <p>${escapeHtml(message.company)}</p>
    </div>
    <div class="message-preview">${escapeHtml(message.preview)}</div>
    <div class="detail-meta">
      <div><span>收到时间</span><b>${escapeHtml(message.receivedAt)}</b></div>
      <div><span>数据来源</span><b>${escapeHtml(message.source)}</b></div>
      <div><span>分类结果</span><b>${escapeHtml(message.stage)}</b></div>
    </div>`;
    if (rerender) renderMessages();
  }

  function renderTasks() {
    const labels = { jobs: '⌁', browser: '◎', email: '✉', system: '✦' };
    const statusLabels = { running: '执行中', waiting: '等你确认', done: '已完成', error: '需处理' };
    $('#taskList').innerHTML = state.tasks.map((task) => `<article class="task-item">
      <span class="task-type">${labels[task.type] || '↻'}</span>
      <div><h4>${escapeHtml(task.title)}</h4><p>${escapeHtml(task.detail || '')}${task.currentJob ? `<em class="task-current-job">▸ ${escapeHtml(task.currentJob)}</em>` : ''}</p></div>
      <div class="task-progress"><i style="width:${Number(task.progress) || 0}%"></i></div>
      <span class="task-status ${task.status}">${statusLabels[task.status] || task.status}</span>
    </article>`).join('');
  }

  // 岗位页顶部的实时刷新进度条：找到最新一个 jobs 类型的 task，反映抓取进度
  function renderRefreshProgress() {
    const task = state.tasks.find((t) => t.type === 'jobs');
    const bar = $('#refreshProgress');
    if (!task || task.status === 'done' || task.status === 'error') {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    $('#refreshProgressBar').style.width = `${Number(task.progress) || 0}%`;
    $('#refreshProgressCompany').textContent = task.currentCompany ? `${task.currentCompany}（${task.progress || 0}%）` : '准备中…';
    $('#refreshProgressJob').textContent = task.currentJob || task.detail || '';
  }

  // 投递购物车：按公司分组，显示投递限制，可移除
  function renderCart() {
    const cart = state.cart || [];
    const list = $('#cartList');
    if (!cart.length) {
      list.innerHTML = '<div class="empty-state"><span>🛒</span><h3>购物车是空的</h3><p>在「招聘项目」里把想投的岗位加入购物车，这里会按公司分组并检查投递限制。</p></div>';
      return;
    }
    const companies = companyMap();
    // 按公司分组
    const groups = {};
    for (const job of cart) {
      const key = job.companyId || 'unknown';
      (groups[key] = groups[key] || []).push(job);
    }
    list.innerHTML = Object.entries(groups).map(([companyId, jobs]) => {
      const company = companies[companyId] || { name: '未知公司', color: '#999' };
      const rule = company.applyRule;
      // 校验投递限制
      let blocked = false;
      let ruleNote = '';
      if (rule && jobs.length > rule.maxActive) {
        blocked = true;
        ruleNote = `⚠️ ${rule.note}（当前 ${jobs.length} 个，超出上限 ${rule.maxActive}）`;
      } else if (rule) {
        ruleNote = `✓ ${rule.note}`;
      }
      return `<div class="cart-group">
        <div class="cart-group-head">
          ${renderLogo(company)}
          <div><h4>${escapeHtml(company.name)}</h4>${ruleNote ? `<span class="cart-rule ${blocked ? 'blocked' : ''}">${ruleNote}</span>` : '<span class="cart-rule ok">无投递限制</span>'}</div>
        </div>
        ${jobs.map((job) => `<div class="cart-item">
          <div><strong>${escapeHtml(job.title)}</strong><span>${escapeHtml(job.city || '')} · ${escapeHtml(job.jobType || '')}${job.applyMessage ? ` · ${escapeHtml(job.applyMessage)}` : ''}</span></div>
          ${job.applyStatus ? `<span class="stage-pill">${escapeHtml(job.applyStatus)}</span>` : ''}
          <button class="ghost-button cart-remove" data-cart-remove="${escapeHtml(job.id)}">移除</button>
        </div>`).join('')}
      </div>`;
    }).join('');
  }

  // 已投递岗位
  function renderApplied() {
    const applied = state.applied || [];
    const list = $('#appliedList');
    if (!applied.length) {
      list.innerHTML = '<div class="empty-state"><span>📋</span><h3>还没有投递记录</h3><p>从「投递购物车」一键投递后，已投岗位会显示在这里。</p></div>';
      return;
    }
    const companies = companyMap();
    list.innerHTML = applied.map((job) => {
      const company = companies[job.companyId] || { name: '未知公司', color: '#999' };
      return `<div class="cart-item applied-item">
        ${renderLogo(company)}
        <div><strong>${escapeHtml(job.title)}</strong><span>${escapeHtml(company.name)} · ${escapeHtml(job.city || '')}</span></div>
        <span class="stage-pill">${escapeHtml(job.applyStatus || '已投递')}</span>
        <span class="job-time">${escapeHtml(job.appliedAt || '')}</span>
      </div>`;
    }).join('');
  }

  function pathGet(object, path) {
    return path.split('.').reduce((value, part) => value?.[part], object);
  }

  // pathSet 支持数字路径段（如 education.0.school）：根据「下一个 part 是不是数字」决定建数组还是对象，
  // 保证写入后结构完整、不会有稀疏空洞。collectResume 已先把经历数组按 DOM 段数建好，这里只回填字段值。
  function pathSet(object, path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    let target = object;
    parts.forEach((part, i) => {
      const next = parts[i + 1] || last;
      const nextIsIndex = /^\d+$/.test(next);
      if (target[part] === undefined || target[part] === null) {
        target[part] = nextIsIndex ? [] : {};
      }
      target = target[part];
    });
    target[last] = value;
  }

  // 多段经历的字段模板：每个 group 一组字段定义，与后端 REPEATABLE_GROUPS 对齐。
  const REPEATABLE_TEMPLATES = {
    education: [
      { key: 'school', label: '学校', placeholder: '学校名称', type: 'input' },
      { key: 'major', label: '专业', placeholder: '专业名称', type: 'input' },
      { key: 'degree', label: '学历', type: 'select', options: ['', '大专', '本科', '硕士', '博士'], optionLabels: ['请选择', '大专', '本科', '硕士', '博士'] },
      { key: 'rank', label: '成绩/排名', placeholder: '例如：前 10%', type: 'input' },
      { key: 'start', label: '开始时间', type: 'month' },
      { key: 'end', label: '结束时间', type: 'month' },
      { key: 'courses', label: '主修课程', placeholder: '与目标岗位相关的课程', type: 'textarea', rows: 3, span: true }
    ],
    experience: [
      { key: 'company', label: '公司', placeholder: '公司名称', type: 'input' },
      { key: 'role', label: '职位', placeholder: '职位名称', type: 'input' },
      { key: 'start', label: '开始时间', type: 'month' },
      { key: 'end', label: '结束时间', placeholder: '至今', type: 'month' },
      { key: 'description', label: '工作描述', placeholder: '负责什么、如何推进、产生什么结果', type: 'textarea', rows: 5, span: true },
      { key: 'achievements', label: '关键成果', placeholder: '尽量用数字描述', type: 'textarea', rows: 3, span: true }
    ],
    projects: [
      { key: 'name', label: '项目名称', placeholder: '项目名称', type: 'input' },
      { key: 'role', label: '担任角色', placeholder: '例如：产品负责人', type: 'input' },
      { key: 'start', label: '开始时间', type: 'month' },
      { key: 'end', label: '结束时间', type: 'month' },
      { key: 'link', label: '项目链接', placeholder: 'https://', type: 'input', span: true },
      { key: 'description', label: '项目说明', placeholder: '背景、你的贡献、最终结果', type: 'textarea', rows: 5, span: true }
    ]
  };

  const GROUP_LABELS = { education: '教育经历', experience: '工作经历', projects: '项目经历' };

  // 多份简历 profile 切换条。basic/skills/extras 全局共享，intention+经历 按 profile 隔离。
  // 切换 profile → 后端切 activeProfileId + syncResumeActiveView → 前端 fillResume 重建段结构 + 回填值。
  function renderProfileTabs() {
    const bar = $('#profileTabs');
    if (!bar) return;
    const profiles = state.resume.profiles || [];
    const activeId = state.resume.activeProfileId || profiles[0]?.id;
    bar.innerHTML = profiles.map((profile) => {
      const isActive = profile.id === activeId;
      const canDelete = profiles.length > 1 && profile.id !== 'default';
      const delBtn = canDelete ? `<button type="button" class="profile-del" data-del-profile="${escapeHtml(profile.id)}" title="删除这份简历">×</button>` : '';
      return `<button type="button" class="profile-tab ${isActive ? 'active' : ''}" data-profile="${escapeHtml(profile.id)}">
        <span class="profile-tab-label" data-rename-profile="${escapeHtml(profile.id)}">${escapeHtml(profile.label || profile.id)}</span>
        ${delBtn}
      </button>`;
    }).join('') + `<button type="button" class="profile-tab profile-add" data-add-profile title="新建一份简历">＋</button>`;
  }

  // 渲染多段经历容器。如实显示 state 里的数组（包括用户刚加的空段），不在渲染层做过滤——
  // 空段清理放到 collectResume 保存时做，避免「加了段却看不到」。
  function renderRepeatableSegments(groupKey) {
    const container = $(`[data-repeat="${groupKey}"]`);
    if (!container) return;
    const arr = (state.resume[groupKey] || []).slice();
    // state 里经历数组不应为空（至少一段），兜底
    if (arr.length === 0) arr.push({});
    const ordinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    container.innerHTML = arr.map((item, index) => {
      const segLabel = `${GROUP_LABELS[groupKey]} ${index + 1}`;
      const ordinal = ordinals[index] || (index + 1);
      const fields = REPEATABLE_TEMPLATES[groupKey].map((field) => {
        const name = `${groupKey}.${index}.${field.key}`;
        const spanClass = field.span ? ' span-2' : '';
        if (field.type === 'select') {
          const options = field.options.map((opt, i) => `<option value="${escapeHtml(opt)}"${item?.[field.key] === opt ? ' selected' : ''}>${escapeHtml(field.optionLabels[i])}</option>`).join('');
          return `<label class="${spanClass}">${escapeHtml(field.label)}<select name="${name}">${options}</select></label>`;
        }
        if (field.type === 'textarea') {
          return `<label class="${spanClass}">${escapeHtml(field.label)}<textarea name="${name}" rows="${field.rows || 3}" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(item?.[field.key] || '')}</textarea></label>`;
        }
        return `<label class="${spanClass}">${escapeHtml(field.label)}<input name="${name}" type="${field.type}" placeholder="${escapeHtml(field.placeholder || '')}" value="${escapeHtml(item?.[field.key] || '')}"></label>`;
      }).join('');
      const removeBtn = arr.length > 1
        ? `<button type="button" class="ghost-button remove-segment" data-remove-segment="${groupKey}" data-index="${index}">删除第${ordinal}段</button>`
        : '';
      const warn = index >= 5 ? `<div class="segment-warn">⚠️ 第 ${index + 1} 段可能超出部分招聘网站的保存上限，自动填写时会标记为「需手动填写」</div>` : '';
      return `<div class="repeatable-segment" data-segment="${index}">
        <div class="segment-head"><strong>${escapeHtml(segLabel)}</strong>${removeBtn}</div>
        <div class="form-grid">${fields}</div>
        ${warn}
      </div>`;
    }).join('');
  }

  function fillResume() {
    // 「当前展示的 profile + 数据版本」指纹。切换 profile 或保存后都会变，触发回填；
    // 用户正在输入时这个指纹不变，不会覆盖输入。
    const viewFingerprint = `${state.resume.activeProfileId || 'default'}@${state.resume.updatedAt || 'seed'}`;
    // 段结构只在「段数变化」时重建，避免用户输入到一半被 innerHTML 重置打断。
    const needsRebuild = ['education', 'experience', 'projects'].some((groupKey) => {
      const stateCount = Math.max(1, (state.resume[groupKey] || []).length);
      const domCount = $(`[data-repeat="${groupKey}"] .repeatable-segment`)?.length || 0;
      return stateCount !== domCount;
    });
    if (needsRebuild) {
      renderRepeatableSegments('education');
      renderRepeatableSegments('experience');
      renderRepeatableSegments('projects');
    }
    // 值回填：指纹变化时（保存过、切了 profile、新建/删除 profile）
    if ($('#resumeForm').dataset.loaded !== viewFingerprint) {
      $$('[name]', $('#resumeForm')).forEach((field) => {
        if (field.name) field.value = pathGet(state.resume, field.name) ?? (field.type === 'select' ? '' : '');
      });
      $('#resumeForm').dataset.loaded = viewFingerprint;
    }
  }

  function collectResume() {
    const resume = collectResumeWithoutTrimming();
    // 清理尾部全空段（保留至少一段），避免攒一堆空段；中间的空段保留，因为段序号有意义
    for (const groupKey of ['education', 'experience', 'projects']) {
      const template = REPEATABLE_TEMPLATES[groupKey];
      while (resume[groupKey].length > 1) {
        const last = resume[groupKey][resume[groupKey].length - 1];
        const allEmpty = template.every((field) => !String(last?.[field.key] || '').trim());
        if (allEmpty) resume[groupKey].pop();
        else break;
      }
    }
    return resume;
  }

  // collectResume 的不清理版本：如实保留 DOM 里的所有段（包括尾部空段）。
  // 添加段时用它，避免「用户加了空段→collectResume 清掉→save→又只剩 1 段」。
  function collectResumeWithoutTrimming() {
    const resume = structuredClone(state.resume);
    for (const groupKey of ['education', 'experience', 'projects']) {
      const existing = resume[groupKey] || [];
      const indices = new Set();
      $$(`[data-repeat="${groupKey}"] [name]`).forEach((field) => {
        const match = field.name.match(new RegExp(`^${groupKey}\\.(\\d+)\\.`));
        if (match) indices.add(Number(match[1]));
      });
      const maxIndex = indices.size ? Math.max(...indices) : 0;
      const newArr = [];
      for (let i = 0; i <= maxIndex; i++) {
        newArr.push(existing[i] || {});
      }
      resume[groupKey] = newArr;
    }
    $$('[name]', $('#resumeForm')).forEach((field) => pathSet(resume, field.name, field.value.trim()));
    return resume;
  }

  function renderAgentPrompt() {
    const base = `http://127.0.0.1:${state.settings.apiPort}`;
    $('#agentPrompt').textContent = `你正在协助我管理求职流程。请连接本机“一键投递”服务：

Base URL: ${base}
Authorization: Bearer ${state.settings.apiToken}

可读取：
- GET /v1/status
- GET /v1/jobs
- GET /v1/resume
- GET /v1/messages
- GET /v1/tasks

可提交命令：
- POST /v1/commands
- Header：Idempotency-Key: <本次动作的唯一键>
- Body 例：{"action":"refresh_jobs"}
- 可用动作：refresh_jobs、open_company、favorite_job、export_snapshot、fill_resume、apply_cart

规则：
1. 先读取状态，再执行动作；
2. 每个写命令生成唯一 Idempotency-Key；重试同一动作复用原键，新动作必须换键；
3. 最终投递、发送信息或修改外部网站前必须让我确认；
4. 登录或验证码出现时提示我接管；
5. 岗位数据来自真实抓取，请如实反映每个岗位的数据来源；
6. 当响应里的 requiresReview 为 true，或状态为 review-required、login-required、manual-required 时，必须提醒我回到“一键投递”处理，不得宣称动作已完成；
7. 不要在回复中泄露这段 Token。`;
  }

  // 腾讯简历填写后的差异报告弹窗：展示每个本地字段的计划动作（fill/skip/manual）+ 风险提示
  function showResumeReport(result) {
    const plan = result.patchPlan;
    const actionLabels = {
      fill: { text: '将填写', cls: 'action-fill' },
      skip: { text: '已一致', cls: 'action-skip' },
      manual: { text: '需手动', cls: 'action-manual' }
    };
    const rows = plan.patches.map((p) => {
      const a = actionLabels[p.action] || actionLabels.manual;
      const fieldValue = (v) => v ? escapeHtml(v) : '<span class="empty">（空）</span>';
      return `<tr>
        <td><code>${escapeHtml(p.key)}</code>${p.segmentLabel ? `<small>${escapeHtml(p.segmentLabel)}</small>` : ''}</td>
        <td>${fieldValue(p.localValue)}</td>
        <td>${fieldValue(p.remoteValue)}</td>
        <td><span class="report-action ${a.cls}">${a.text}</span></td>
        <td>${p.matchedField ? `<span class="matched-field">${escapeHtml(p.matchedField)}</span>` : '<span class="empty">未匹配</span>'}<small>${escapeHtml(p.risk || '')}</small></td>
      </tr>`;
    }).join('');
    const s = plan.summary;
    $('#resumeReportContent').innerHTML = `
      <div class="report-head">
        <h2>腾讯简历字段核对</h2>
        <p>软件已按本地简历自动填写，<strong>没有点击保存</strong>。请在右侧浏览器工作区逐项核对后，自行点击官网保存按钮。</p>
        <div class="report-summary">
          <span class="chip chip-fill">将填写 ${s.fill}</span>
          <span class="chip chip-skip">已一致 ${s.skip}</span>
          <span class="chip chip-manual">需手动 ${s.manual}</span>
        </div>
      </div>
      <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>本地字段</th><th>本地值</th><th>腾讯当前值</th><th>动作</th><th>匹配 / 风险</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    $('#resumeReportDialog').showModal();
  }

  function showJob(id) {
    const job = state.jobs.find((item) => item.id === id);
    if (!job) return;
    const company = companyMap()[job.companyId] || { name: job.source || '未知公司', short: '?', color: '#999999' };
    $('#jobDialogContent').innerHTML = `<div class="job-dialog-head">
      ${renderLogo(company)}
      <div><h2>${escapeHtml(job.title)}</h2><p>${escapeHtml(company.name)} · ${escapeHtml(job.department)}</p></div>
    </div>
    <div class="job-dialog-body">
      <div class="job-dialog-grid">
        <div><span>城市</span><b>${escapeHtml(job.city)}</b></div>
        <div><span>经验要求</span><b>${escapeHtml(job.experience)}</b></div>
        <div><span>学历</span><b>${escapeHtml(job.education)}</b></div>
        <div><span>发布时间</span><b>${escapeHtml(job.postedAt || '未标注')}</b></div>
      </div>
      <h4>岗位职责</h4><p>${escapeHtml(job.summary || '详见招聘官网')}</p>
      <h4>数据来源</h4><p>本岗位由“${escapeHtml(job.source)}”抓取，打开官网可查看任职要求等完整信息。</p>
    </div>
    <div class="dialog-actions">
      <button class="ghost-button" data-favorite="${job.id}">${job.favorite ? '取消收藏' : '收藏岗位'}</button>
      <button class="primary-button" data-open-company="${company.id}">打开 ${escapeHtml(company.name)} 官网</button>
    </div>`;
    $('#jobDialog').showModal();
  }

  async function run(button, action, successMessage) {
    const old = button?.textContent;
    if (button) { button.disabled = true; button.textContent = '正在处理…'; }
    try {
      const result = await action();
      if (successMessage) toast(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      return result;
    } catch (error) {
      toast(error.message || '操作失败', 'error');
      throw error;
    } finally {
      if (button) { button.disabled = false; button.textContent = old; }
    }
  }

  function renderWorkspaceStatus(status) {
    const bar = $('#workspaceBar');
    if (!status?.active) {
      bar.classList.add('hidden');
      return;
    }
    const labels = {
      login: ['🔐', status.title || '登录招聘网站', '完成登录'],
      'resume-review': ['▤', status.title || '核对平台简历', '完成核对'],
      'application-review': ['🛒', status.title || '核对岗位投递', '完成投递检查'],
      browse: ['◎', status.title || '浏览招聘网站', '完成']
    };
    const [icon, title, action] = labels[status.mode] || labels.browse;
    $('#workspaceBar .workspace-bar-icon').textContent = icon;
    $('#workspaceBarTitle').textContent = title;
    $('#workspaceBarHint').textContent = status.url || '网页加载中…';
    $('#workspaceFinish').textContent = action;
    bar.classList.remove('hidden');
  }

  async function refreshWorkspaceStatus() {
    renderWorkspaceStatus(await window.oneClick.workspaceStatus());
  }

  // 在软件内嵌入某公司招聘官网，让用户登录，登录态由 Electron session 持久化
  async function openEmbeddedLogin(companyId) {
    const company = companyMap()[companyId];
    if (!company) return;
    try {
      await window.oneClick.openLogin(companyId);
      await refreshWorkspaceStatus();
      toast(`${company.name} 招聘官网已在软件内打开，请登录`);
    } catch (error) {
      toast(error.message || '打开登录失败', 'error');
    }
  }

  // 首启引导：选择求职方向（校招/社招/实习）
  function showOnboarding() {
    const dialog = $('#onboardingDialog');
    dialog.showModal();
    $$('.onboarding-choice').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const recruit = btn.dataset.recruit;
        state = await window.oneClick.updateSettings({ recruitType: recruit });
        dialog.close();
        toast(`已选择${({ social: '社招', campus: '校招', 'summer-intern': '暑期实习', 'daily-intern': '日常实习', all: '全部' })[recruit]}方向，点击"刷新全部岗位"开始抓取`);
      }, { once: true });
    });
  }

  async function init() {
    state = await window.oneClick.getState();
    renderState();
    // onStateChanged 是异步广播，可能在本地操作（saveResume/switchProfile 等）返回后被旧事件覆盖。
    // 本地发起写操作时记一个序号，操作完成前收到的广播一律忽略，完成后再放行。
    let localWriteInFlight = false;
    window.oneClick.onStateChanged((next) => {
      if (!next) return;
      if (localWriteInFlight) return; // 本地写操作进行中，忽略中间广播
      state = next;
      renderState();
    });
    window.oneClick.onWorkspaceChanged(renderWorkspaceStatus);
    await refreshWorkspaceStatus();

    // 首次启动引导：让用户选校招/社招方向
    if (!state.meta?.onboardingSeen) showOnboarding();

    // 启动时自动检查更新（agent.md 第66行：每次打开自动检查版本号）
    if (state.settings?.autoCheckUpdates) {
      try {
        const result = await window.oneClick.checkUpdate();
        if (result.configured && result.updateAvailable) toast(`发现新版本 ${result.latest}，建议更新`);
      } catch { /* 静默失败，不打扰用户 */ }
    }


    document.addEventListener('click', async (event) => {
      const pageButton = event.target.closest('[data-page]');
      if (pageButton) return navigate(pageButton.dataset.page);
      const external = event.target.closest('[data-external]');
      if (external) { event.preventDefault(); return window.oneClick.openExternal(external.href); }
      const close = event.target.closest('.dialog-close');
      if (close) return close.closest('dialog').close();
      const favorite = event.target.closest('[data-favorite]');
      if (favorite) {
        event.stopPropagation();
        state = await window.oneClick.toggleFavorite(favorite.dataset.favorite);
        renderState();
        return;
      }
      const cartBtn = event.target.closest('[data-cart]');
      if (cartBtn) {
        event.stopPropagation();
        const inCart = state.cart?.some((c) => c.id === cartBtn.dataset.cart);
        state = await window.oneClick.toggleCart(cartBtn.dataset.cart);
        renderState();
        toast(inCart ? '已移出购物车' : '已加入购物车');
        return;
      }
      const cartRemove = event.target.closest('[data-cart-remove]');
      if (cartRemove) {
        state = await window.oneClick.toggleCart(cartRemove.dataset.cartRemove);
        renderState();
        return;
      }
      const removeSegmentBtn = event.target.closest('[data-remove-segment]');
      if (removeSegmentBtn) {
        const groupKey = removeSegmentBtn.dataset.removeSegment;
        const index = Number(removeSegmentBtn.dataset.index);
        // 删除前确认：非空段才确认，避免删空段还要点确认
        const arr = state.resume[groupKey] || [];
        const seg = arr[index];
        const template = REPEATABLE_TEMPLATES[groupKey];
        const hasContent = seg && template.some((f) => String(seg[f.key] || '').trim());
        if (hasContent && !confirm(`确定删除第 ${index + 1} 段${GROUP_LABELS[groupKey]}吗？这一段的内容会从本机简历移除。`)) return;
        // 用不清理版本收集，避免其他空段也被误删
        const currentResume = collectResumeWithoutTrimming();
        currentResume[groupKey].splice(index, 1);
        if (currentResume[groupKey].length === 0) currentResume[groupKey].push({}); // 至少保留一段
        state = await window.oneClick.saveResume(currentResume);
        renderState();
        return;
      }
      const emptyRefresh = event.target.closest('[data-empty-refresh]');
      if (emptyRefresh) {
        run(emptyRefresh, () => window.oneClick.refreshJobs(), (result) => result.message);
        return;
      }
      const loadMore = event.target.closest('[data-load-more]');
      if (loadMore) {
        jobPageSize += 50;
        renderJobs();
        return;
      }
      const job = event.target.closest('[data-job-id]');
      if (job) return showJob(job.dataset.jobId);
      const company = event.target.closest('[data-company], [data-open-company]');
      if (company) {
        const id = company.dataset.company || company.dataset.openCompany;
        const c = companyMap()[id];
        // jobs verified 的公司抓取不需要登录，直接打开官网浏览；其余公司引导在软件内登录/接管
        if (companyClickMode(c) === 'browse') {
          await run(company, () => window.oneClick.openCompany(id), '招聘官网已在浏览器中打开');
        } else {
          await openEmbeddedLogin(id);
        }
        return;
      }
      const stage = event.target.closest('[data-stage]');
      if (stage) { activeStage = stage.dataset.stage; return renderMessages(); }
      const message = event.target.closest('[data-message]');
      if (message) return showMessage(message.dataset.message);
      const tagChip = event.target.closest('[data-tag]');
      if (tagChip) {
        activeTag = tagChip.dataset.tag || null;
        jobPageSize = 50;
        renderTagFilters();
        renderJobs();
        return;
      }
    });

    $$('.filter-chip').forEach((button) => button.addEventListener('click', () => {
      activeFilter = button.dataset.filter;
      jobPageSize = 50; // 改筛选时重置分页
      $$('.filter-chip').forEach((item) => item.classList.toggle('active', item === button));
      renderJobs();
    }));
    ['jobSearch', 'companyFilter', 'sortJobs'].forEach((id) => $(`#${id}`).addEventListener(id === 'jobSearch' ? 'input' : 'change', () => { jobPageSize = 50; renderJobs(); }));
    $('#refreshJobsButton').addEventListener('click', (event) => run(event.currentTarget, () => window.oneClick.refreshJobs(), (result) => result.message));
    $('#runRefreshTask').addEventListener('click', (event) => run(event.currentTarget, () => window.oneClick.refreshJobs(), (result) => result.message));
    $('#cartApplyAll').addEventListener('click', (event) => run(event.currentTarget, async () => {
      const result = await window.oneClick.applyCart();
      state = await window.oneClick.getState();
      renderState();
      return result;
    }, (result) => result.message || '投递流程已启动'));
    $('#refreshApplied').addEventListener('click', () => toast('已投递状态需要登录对应公司后才能自动刷新，当前显示的是投递时的记录'));
    $('#saveResumeButton').addEventListener('click', (event) => run(event.currentTarget, async () => {
      state = await window.oneClick.saveResume(collectResume());
      renderState();
    }, '简历已安全保存在本机'));
    // 新建简历 profile
    $('#resumeProfilesBar').addEventListener('click', async (event) => {
      const addBtn = event.target.closest('[data-add-profile]');
      if (addBtn) {
        const label = prompt('给这份简历起个名字（比如：产品方向、运营方向、实习）', '');
        if (label === null) return; // 用户取消
        const result = await window.oneClick.addProfile(label);
        state = result.state;
        renderState();
        toast(`已创建「${label || '简历 ' + state.resume.profiles.length}」`);
        return;
      }
      const delBtn = event.target.closest('[data-del-profile]');
      if (delBtn) {
        event.stopPropagation();
        const profileId = delBtn.dataset.delProfile;
        const profile = state.resume.profiles.find((p) => p.id === profileId);
        if (!confirm(`确定删除「${profile?.label || profileId}」吗？这份的意向和经历会从本机移除（联系方式等共享信息不受影响）。`)) return;
        state = await window.oneClick.deleteProfile(profileId);
        renderState();
        toast('已删除这份简历');
        return;
      }
      // 单击 tab → 切换（label 也在 tab 内，点击 label 同样切换）
      const tab = event.target.closest('[data-profile]');
      if (tab) {
        const profileId = tab.dataset.profile;
        if (profileId === state.resume.activeProfileId) return;
        // 切换前保存当前编辑（避免丢输入），再切。两次写操作期间会有广播，
        // 用 localWriteInFlight 标记屏蔽中间广播；切换后主动 getState 拿权威最新状态，
        // 避免 switchProfile 返回值被积压的旧广播（saveResume 时的，active=旧 profile）覆盖。
        localWriteInFlight = true;
        try {
          await window.oneClick.saveResume(collectResume());
          await window.oneClick.switchProfile(profileId);
          state = await window.oneClick.getState();
        } catch (e) {
          toast(e.message || '切换失败', 'error');
        } finally {
          localWriteInFlight = false;
        }
        renderState();
        const p = state.resume.profiles.find((x) => x.id === profileId);
        toast(`已切换到「${p?.label || profileId}」`);
        return;
      }
    });
    // 双击 label → 重命名（避免和单击切换冲突）
    $('#resumeProfilesBar').addEventListener('dblclick', async (event) => {
      const renameTarget = event.target.closest('[data-rename-profile]');
      if (!renameTarget) return;
      event.preventDefault();
      const profileId = renameTarget.dataset.renameProfile;
      const profile = state.resume.profiles.find((p) => p.id === profileId);
      const label = prompt('重命名这份简历', profile?.label || '');
      if (label === null || !label.trim()) return;
      state = await window.oneClick.renameProfile(profileId, label.trim());
      renderState();
      toast('已重命名');
    });
    // 多段经历：添加段。直接基于 DOM 当前段数追加空段，不经过 collectResume 的尾部清理
    // （否则用户没填内容的空段会被清掉，导致「加了又没了」）。
    $$('[data-add-segment]').forEach((button) => button.addEventListener('click', async () => {
      const groupKey = button.dataset.addSegment;
      // 从 DOM 读取当前所有段的值（不清理），再追加一个空段
      const currentResume = collectResumeWithoutTrimming();
      currentResume[groupKey] = [...(currentResume[groupKey] || []), {}];
      state = await window.oneClick.saveResume(currentResume);
      renderState();
      // 滚动到新加的段
      const segments = $$(`[data-repeat="${groupKey}"] .repeatable-segment`);
      segments[segments.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(`已添加第 ${segments.length} 段${GROUP_LABELS[groupKey]}`);
    }));
    // 删除段：事件委托在 document 上（见 init 末尾的全局 click 委托），这里不单独绑
    $('#exportResumeButton').addEventListener('click', (event) => run(event.currentTarget, () => window.oneClick.exportSnapshot(), '求职快照已导出'));
    $('#fillResumeTencentButton').addEventListener('click', (event) => run(event.currentTarget, async () => {
      const result = await window.oneClick.fillResumeToTencent();
      // 填写后若带回差异报告（patchPlan），弹窗展示逐字段命中情况，让用户核对
      if (result?.patchPlan?.patches?.length) {
        showResumeReport(result);
      }
      return result;
    }, (result) => result?.message || '已更新到腾讯'));
    $('#exportSnapshotButton').addEventListener('click', (event) => run(event.currentTarget, () => window.oneClick.exportSnapshot(), '脱敏快照已导出'));
    $('#backupExportButton').addEventListener('click', (event) => run(event.currentTarget, () => window.oneClick.exportBackup(), (result) => result.canceled ? '已取消备份' : '备份已保存'));
    $('#backupRestoreButton').addEventListener('click', (event) => run(event.currentTarget, async () => {
      const result = await window.oneClick.restoreBackup();
      if (!result.canceled) {
        state = await window.oneClick.getState();
        renderState();
      }
      return result;
    }, (result) => result.canceled ? '已取消恢复' : '备份已恢复'));
    $('#syncEmailButton').addEventListener('click', (event) => run(event.currentTarget, async () => {
      state = await window.oneClick.syncEmail({ address: $('#emailAddress').value.trim(), authorizationCode: $('#emailCode').value.trim() });
      $('#emailCode').value = '';
      renderState();
    }, 'QQ 邮箱同步完成'));
    $('#copyPromptButton').addEventListener('click', async () => {
      await navigator.clipboard.writeText($('#agentPrompt').textContent);
      toast('接入 Prompt 已复制');
    });
    $('#checkUpdateButton').addEventListener('click', (event) => run(event.currentTarget, async () => {
      const result = await window.oneClick.checkUpdate();
      if (!result.configured) return toast('还没有配置 GitHub 更新源');
      if (result.updateAvailable) {
        toast(`发现新版本 ${result.latest}`);
        await window.oneClick.openExternal(result.url);
      } else toast(`当前已是最新版 ${result.current}`);
    }));
    $('#saveSettingsButton').addEventListener('click', (event) => run(event.currentTarget, async () => {
      state = await window.oneClick.updateSettings({
        githubRepo: $('#githubRepo').value.trim(),
        autoCheckUpdates: $('#autoUpdate').checked,
        apiEnabled: $('#apiEnabled').checked,
        apiPort: Number($('#apiPort').value),
        jobsDaysBack: Math.min(365, Math.max(1, Number($('#jobsDaysBack').value) || 30)),
        recruitType: $('#recruitType').value
      });
      renderState();
    }, '设置已保存'));
    $('#promoButton').addEventListener('click', () => $('#promoDialog').showModal());
    $('#workspaceFinish').addEventListener('click', async () => {
      const result = await window.oneClick.finishWorkspace();
      renderWorkspaceStatus(null);
      if (result.applicationResult) {
        state = await window.oneClick.getState();
        renderState();
        toast(result.applicationResult.message, result.applicationResult.status === 'submitted' ? 'success' : 'error');
        return;
      }
      const mode = result.status?.mode;
      toast(mode === 'login' ? '登录态已保存，后续操作会自动复用' : '已结束本次网页核对');
    });
    $('#workspaceCancel').addEventListener('click', async () => {
      await window.oneClick.cancelWorkspace();
      renderWorkspaceStatus(null);
      state = await window.oneClick.getState();
      renderState();
      toast('已取消本次网页操作');
    });
    $('#refreshLogsButton').addEventListener('click', () => run($('#refreshLogsButton'), async () => {
      const logs = await window.oneClick.getLogs();
      renderLogs(logs);
    }));
  }

  // 渲染开发日志（内存最近 50 条）
  function renderLogs(logs) {
    const list = $('#devLogList');
    if (!logs || logs.length === 0) {
      list.innerHTML = '<p class="dev-log-empty">暂无日志。触发一次"刷新全部岗位"后会产生日志。</p>';
      return;
    }
    list.innerHTML = logs.map((entry) => `<div class="dev-log-entry level-${entry.level}">
      <time>${escapeHtml(entry.ts)}</time>
      <span class="dev-log-level">${escapeHtml(entry.level.toUpperCase())}</span>
      <span class="dev-log-msg">${escapeHtml(entry.msg)}${entry.meta ? ` <em>${escapeHtml(JSON.stringify(entry.meta))}</em>` : ''}</span>
    </div>`).join('');
  }

  init().catch((error) => {
    document.body.innerHTML = `<main style="padding:40px;font-family:sans-serif"><h1>应用启动失败</h1><p>${escapeHtml(error.message)}</p></main>`;
  });
})();
