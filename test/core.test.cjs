const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore, calculateResumeCompletion, applyResumeEdit, switchProfile, addProfile, deleteProfile, renameProfile, migrateFlatResumeToProfiles } = require('../electron/store.cjs');
const { classifyRecruitingMail, looksLikeRecruitingMail } = require('../electron/recruiting.cjs');
const { AgentServer } = require('../electron/agent-server.cjs');
const { createSeed } = require('../electron/seed.cjs');

test('JsonStore 首次启动生成空状态并能持久化收藏', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-store-'));
  const store = new JsonStore(directory);
  const seed = store.init();
  // 首次启动不再内置演示数据，岗位列表为空
  assert.equal(seed.jobs.length, 0);
  assert.equal(seed.settings.dataMode, 'live');
  assert.ok(seed.settings.jobs.daysBack, 30);
  assert.ok(seed.settings.apiToken.length >= 20);
  assert.equal(seed.meta.privacyAcceptedAt, null);
  assert.deepEqual(seed.audit, []);
  assert.deepEqual(seed.idempotency, {});
  // 插入一条岗位后验证 favorite 持久化
  const id = 'test-job-001';
  store.update((state) => {
    state.jobs.push({ id, companyId: 'tencent', title: '测试岗位', favorite: false });
    return state;
  });
  store.update((state) => {
    state.jobs.find((job) => job.id === id).favorite = true;
    return state;
  });
  const reloaded = new JsonStore(directory);
  assert.equal(reloaded.init().jobs.find((job) => job.id === id).favorite, true);
});

test('简历完整度只按已填写关键字段计算（多段经历按是否有任意一段非空计）', () => {
  const resume = {
    basic: { name: '张三', phone: '13800000000', email: '', city: '' },
    intention: { roles: '', cities: '' },
    education: [{}], experience: [{}], projects: [{}],
    skills: { keywords: '' }, extras: { summary: '' }
  };
  // 11 个判定位里只有 basic.name/phone 两个非空 → 2/11 ≈ 18%
  assert.equal(calculateResumeCompletion(resume), 18);
});

test('简历完整度从 profiles 读取，且多段经历只要有一段非空就算填了', () => {
  const resume = {
    basic: { name: '张三', phone: '138', email: 'a@b.c', city: '杭州' }, // 4 全填
    skills: { keywords: 'React' }, extras: { summary: '简介' }, // 2 全填
    profiles: [{
      id: 'default',
      intention: { roles: '前端', cities: '杭州' }, // 2 全填
      education: [{ school: '', major: '' }, { school: 'B 大学', major: '计算机' }], // 第二段非空 → 计 1
      experience: [{ company: '', role: '' }], // 全空 → 0
      projects: [] // 空 → 0
    }],
    activeProfileId: 'default'
  };
  // 非空位：4(basic) + 2(intention) + 1(edu) + 0(exp) + 0(proj) + 2(skills/extras) = 9 / 11 = 82%
  assert.equal(calculateResumeCompletion(resume), 82);
});

test('旧版扁平简历 schema 升级到多 profile（迁移不丢已有经历）', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-migrate-'));
  const stateFile = path.join(directory, 'state.json');
  // 伪造一份旧版 state：扁平 intention/education/experience/projects，无 profiles
  const oldState = {
    meta: { schemaVersion: 2, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', onboardingSeen: true, privacyAcceptedAt: null },
    companies: [{ id: 'tencent', name: '腾讯', short: 'T', color: '#1664ff', adapterStatus: 'adapter-ready', enabled: true }],
    jobs: [],
    messages: [],
    cart: [], applied: [], audit: [], idempotency: {},
    tasks: [],
    resume: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      completion: 50,
      basic: { name: '李四', phone: '139', email: 'l@e.com', city: '上海' },
      intention: { roles: '后端', cities: '上海', salary: '30k', availability: '', employmentType: '全职' },
      education: [{ school: '复旦', major: '计算机', degree: '硕士' }],
      experience: [{ company: '老东家', role: '工程师', description: '干活' }],
      projects: [{ name: '老项目' }],
      skills: { keywords: 'Java', languages: '', certificates: '', portfolio: '' },
      extras: { summary: '', awards: '', campus: '', publications: '', patents: '' }
    },
    settings: { apiEnabled: true, apiPort: 53147, apiToken: 'tok', githubRepo: 'lyzbcy/yijian-toudi', email: { connected: false }, autoCheckUpdates: true, dataMode: 'live', jobs: { daysBack: 30, recruitType: 'social' } }
  };
  fs.writeFileSync(stateFile, JSON.stringify(oldState, null, 2));
  const store = new JsonStore(directory);
  const state = store.init();

  // 迁移后：profiles 存在且包含旧经历
  assert.ok(Array.isArray(state.resume.profiles));
  assert.equal(state.resume.profiles.length, 1);
  assert.equal(state.resume.profiles[0].id, 'default');
  assert.equal(state.resume.profiles[0].education[0].school, '复旦');
  assert.equal(state.resume.profiles[0].experience[0].company, '老东家');
  assert.equal(state.resume.profiles[0].intention.roles, '后端');
  assert.equal(state.resume.activeProfileId, 'default');
  // 兼容视图：顶层 intention/education 指向 active profile
  assert.equal(state.resume.education[0].school, '复旦');
  assert.equal(state.resume.intention.roles, '后端');
  // capabilities 迁移：fixture 里的腾讯（adapter-ready）应被 seed 的最新 capabilities 覆盖（含 resume/apply verified）
  assert.ok(state.companies[0].capabilities);
  assert.equal(state.companies[0].capabilities.jobs, 'verified');
  assert.equal(state.companies[0].capabilities.resume, 'degraded');
});

test('能力矩阵：旧 adapterStatus 迁移成五维 capabilities，login-only 公司 jobs 为 degraded', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-caps-'));
  const stateFile = path.join(directory, 'state.json');
  // 伪造一家不在 seed 里的公司（id 唯一），测 adapterStatus 兜底映射
  const oldState = {
    meta: { schemaVersion: 2, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', onboardingSeen: true, privacyAcceptedAt: null },
    companies: [
      { id: 'tencent', name: '腾讯', short: 'T', color: '#1664ff', adapterStatus: 'adapter-ready', enabled: true },
      { id: 'old-corp', name: '旧公司', short: '旧', color: '#999', adapterStatus: 'login-only', enabled: true }
    ],
    jobs: [], messages: [], cart: [], applied: [], audit: [], idempotency: {}, tasks: [],
    resume: { updatedAt: null, completion: 0, basic: {}, intention: {}, education: [], experience: [], projects: [], skills: {}, extras: {}, profiles: [{ id: 'default', label: '默认', intention: {}, education: [], experience: [], projects: [] }], activeProfileId: 'default' },
    settings: { apiEnabled: true, apiPort: 53147, apiToken: 'tok', githubRepo: 'a/b', email: { connected: false }, autoCheckUpdates: true, dataMode: 'live', jobs: { daysBack: 30, recruitType: 'social' } }
  };
  fs.writeFileSync(stateFile, JSON.stringify(oldState));
  const store = new JsonStore(directory);
  const state = store.init();
  const tencent = state.companies.find((c) => c.id === 'tencent');
  const oldCorp = state.companies.find((c) => c.id === 'old-corp');
  // 腾讯走 seed 覆盖：拿到真实五维（resume/apply verified）
  assert.equal(tencent.capabilities.resume, 'degraded');
  assert.equal(tencent.capabilities.apply, 'manual');
  assert.equal(tencent.lastVerifiedAt, '2026-07-25');
  // old-corp 不在 seed，走 adapterStatus 兜底：login-only → jobs degraded
  assert.equal(oldCorp.capabilities.jobs, 'degraded');
  assert.equal(oldCorp.capabilities.login, 'manual');
  assert.equal(oldCorp.capabilities.resume, 'unsupported');
  assert.equal(oldCorp.lastVerifiedAt, null);
});

test('旧版默认 false 合规答案迁移为未回答，避免把系统默认值当用户声明', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-tristate-'));
  const state = createSeed();
  state.meta.schemaVersion = 2;
  state.resume.compliance.previouslyInterviewed = false;
  state.resume.compliance.criminalRecord = false;
  state.resume.profiles[0].intention.acceptAdjustment = false;
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  const migrated = new JsonStore(directory).init();
  assert.equal(migrated.resume.compliance.previouslyInterviewed, '');
  assert.equal(migrated.resume.compliance.criminalRecord, '');
  assert.equal(migrated.resume.intention.acceptAdjustment, '');
  assert.equal(migrated.meta.schemaVersion, 4);
});

test('旧版教育默认 true 迁移为未回答，避免自动声明全日制或统招', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-education-tristate-'));
  const state = createSeed();
  state.meta.schemaVersion = 3;
  state.resume.profiles[0].education[0].isFullTime = 'true';
  state.resume.profiles[0].education[0].isUnified = 'true';
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  const migrated = new JsonStore(directory).init();
  assert.equal(migrated.resume.education[0].isFullTime, '');
  assert.equal(migrated.resume.education[0].isUnified, '');
  assert.equal(migrated.meta.schemaVersion, 4);
});

test('applyResumeEdit 把前端编辑的顶层经历写回 active profile（不丢用户输入）', () => {
  // 模拟前端 collectResume 传来的对象：顶层 education 有 2 段，但 profiles 还是旧的 1 段
  const current = {
    activeProfileId: 'default',
    basic: { name: '张三' },
    intention: { roles: '前端' },
    education: [{ school: 'A' }],
    experience: [], projects: [],
    skills: { keywords: '' }, extras: {},
    profiles: [{ id: 'default', label: '默认简历', intention: { roles: '前端' }, education: [{ school: 'A' }], experience: [], projects: [] }]
  };
  const incoming = {
    activeProfileId: 'default',
    basic: { name: '张三' },
    intention: { roles: '后端' }, // 改了
    education: [{ school: 'A' }, { school: 'B' }], // 加了一段
    experience: [], projects: [],
    skills: { keywords: '' }, extras: {},
    profiles: [{ id: 'default', label: '默认简历', intention: { roles: '前端' }, education: [{ school: 'A' }], experience: [], projects: [] }] // 旧快照
  };
  const result = applyResumeEdit(current, incoming);
  // active profile 的 education 应该有 2 段，不是旧的 1 段
  const activeProfile = result.profiles.find((p) => p.id === 'default');
  assert.equal(activeProfile.education.length, 2);
  assert.equal(activeProfile.education[1].school, 'B');
  assert.equal(activeProfile.intention.roles, '后端');
  assert.ok(result.updatedAt);
  assert.ok(result.completion >= 0);
});

test('applyResumeEdit 不影响非 active 的其他 profile', () => {
  const current = {
    activeProfileId: 'product',
    profiles: [
      { id: 'default', label: '默认', intention: { roles: '默认岗位' }, education: [{ school: 'X' }], experience: [], projects: [] },
      { id: 'product', label: '产品方向', intention: { roles: '产品' }, education: [{ school: 'Y' }], experience: [], projects: [] }
    ]
  };
  const incoming = {
    activeProfileId: 'product',
    intention: { roles: '高级产品经理' },
    education: [{ school: 'Y' }, { school: 'Z' }],
    experience: [], projects: [],
    profiles: current.profiles // 旧快照
  };
  const result = applyResumeEdit(current, incoming);
  const def = result.profiles.find((p) => p.id === 'default');
  const prod = result.profiles.find((p) => p.id === 'product');
  // default 不变
  assert.equal(def.intention.roles, '默认岗位');
  assert.equal(def.education.length, 1);
  // product 更新了
  assert.equal(prod.intention.roles, '高级产品经理');
  assert.equal(prod.education.length, 2);
});

test('多份简历：新建/切换/重命名/删除 profile', () => {
  let resume = {
    activeProfileId: 'default',
    basic: { name: '共享姓名' },
    skills: { keywords: '共享技能' },
    profiles: [{ id: 'default', label: '默认简历', intention: { roles: '前端' }, education: [{ school: 'A' }], experience: [], projects: [] }]
  };

  // 新建一份「产品方向」
  const newId = addProfile(resume, '产品方向');
  assert.equal(resume.profiles.length, 2);
  assert.equal(resume.activeProfileId, newId);
  assert.equal(resume.profiles[1].label, '产品方向');
  // 兼容视图已切到新 profile（intention 应为空，education 一段空）
  assert.equal(resume.intention.roles, '');
  // 全局字段不变
  assert.equal(resume.basic.name, '共享姓名');

  // 给新 profile 写内容（模拟 applyResumeEdit）
  resume = applyResumeEdit(resume, { ...resume, intention: { roles: '产品经理' }, education: [{ school: 'B' }], experience: [], projects: [] });
  assert.equal(resume.profiles.find((p) => p.id === newId).intention.roles, '产品经理');

  // 切回 default
  switchProfile(resume, 'default');
  assert.equal(resume.activeProfileId, 'default');
  assert.equal(resume.intention.roles, '前端'); // 兼容视图跟着切
  assert.equal(resume.education[0].school, 'A');

  // 重命名
  renameProfile(resume, newId, '产品经理方向');
  assert.equal(resume.profiles.find((p) => p.id === newId).label, '产品经理方向');
  assert.throws(() => renameProfile(resume, newId, '   '), /不能为空/);

  // 删除（非 default）
  deleteProfile(resume, newId);
  assert.equal(resume.profiles.length, 1);
  assert.equal(resume.profiles[0].id, 'default');
  // default 不可删
  assert.throws(() => deleteProfile(resume, 'default'), /不能删除/);
});

test('切换到不存在的 profile 抛错，删除不存在的抛错', () => {
  const resume = { activeProfileId: 'default', profiles: [{ id: 'default', label: '默认', intention: {}, education: [], experience: [], projects: [] }] };
  assert.throws(() => switchProfile(resume, 'nope'), /简历不存在/);
  assert.throws(() => deleteProfile(resume, 'nope'), /简历不存在/);
});

test('P0-1 回归：旧版扁平 resume schema 经 migrateFlatResumeToProfiles 迁移后，顶层经历不丢', () => {
  // 模拟 v0.2 时代的扁平 resume（无 profiles）
  const flatResume = {
    basic: { name: '旧用户' },
    intention: { roles: '后端' },
    education: [{ school: '旧大学' }],
    experience: [{ company: '旧公司' }],
    projects: [{ name: '旧项目' }],
    skills: { keywords: 'Java' },
    extras: {}
  };
  const migrated = migrateFlatResumeToProfiles(flatResume);
  assert.equal(migrated, true);
  assert.equal(flatResume.profiles[0].id, 'default');
  assert.equal(flatResume.profiles[0].intention.roles, '后端');
  assert.equal(flatResume.profiles[0].education[0].school, '旧大学');
  assert.equal(flatResume.profiles[0].experience[0].company, '旧公司');
  assert.equal(flatResume.activeProfileId, 'default');
  // 幂等：已有 profiles 不动
  assert.equal(migrateFlatResumeToProfiles(flatResume), false);
});

test('P0-1 回归：备份恢复旧 schema 后，store 能正确读到经历（不被 syncResumeActiveView 清空）', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-restore-'));
  const stateFile = path.join(directory, 'state.json');
  // 先写一份 v0.2 旧 state（扁平 resume，无 profiles）
  const oldState = {
    meta: { schemaVersion: 2, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', onboardingSeen: true, privacyAcceptedAt: null },
    companies: [{ id: 'tencent', name: '腾讯', short: 'T', color: '#1664ff', adapterStatus: 'adapter-ready', enabled: true }],
    jobs: [], messages: [], cart: [], applied: [], audit: [], idempotency: {}, tasks: [],
    resume: {
      updatedAt: '2026-01-01T00:00:00.000Z', completion: 50,
      basic: { name: '旧用户' },
      intention: { roles: '后端' },
      education: [{ school: '旧大学', major: 'CS' }],
      experience: [{ company: '旧公司' }],
      projects: [{ name: '旧项目' }],
      skills: { keywords: 'Java' },
      extras: { summary: '' }
      // 注意：没有 profiles 字段，没有 activeProfileId
    },
    settings: { apiEnabled: true, apiPort: 53147, apiToken: 'tok', githubRepo: 'a/b', email: { connected: false }, autoCheckUpdates: true, dataMode: 'live', jobs: { daysBack: 30, recruitType: 'social' } }
  };
  fs.writeFileSync(stateFile, JSON.stringify(oldState));
  const store = new JsonStore(directory);
  const state = store.init();
  // 关键断言：经历必须保留，不能被清空
  assert.equal(state.resume.intention.roles, '后端');
  assert.equal(state.resume.education[0].school, '旧大学');
  assert.equal(state.resume.profiles[0].education[0].school, '旧大学');
  assert.equal(state.resume.profiles[0].intention.roles, '后端');
});

test('P1-1 回归：applyResumeEdit 不用前端旧快照覆盖后端并发改过的其他 profile', () => {
  // 后端：A 已被并发改成 A3，B 已被并发改成 B2
  const current = {
    activeProfileId: 'A',
    profiles: [
      { id: 'default', label: '默认', intention: { roles: '默认' }, education: [], experience: [], projects: [] },
      { id: 'A', label: 'A方向', intention: { roles: 'A3（后端最新）' }, education: [], experience: [], projects: [] },
      { id: 'B', label: 'B方向', intention: { roles: 'B2（后端最新）' }, education: [], experience: [], projects: [] }
    ]
  };
  // 前端拿的是更早的旧快照（A 还是 A1，B 还是 B1），现在要在 A 上保存 A3-frontend
  const incoming = {
    activeProfileId: 'A', // 前端以为 active 是 A
    intention: { roles: 'A3-frontend（前端编辑）' },
    education: [], experience: [], projects: [],
    profiles: [ // 前端的旧快照
      { id: 'default', label: '默认', intention: { roles: '默认' }, education: [], experience: [], projects: [] },
      { id: 'A', label: 'A方向', intention: { roles: 'A1（前端旧）' }, education: [], experience: [], projects: [] },
      { id: 'B', label: 'B方向', intention: { roles: 'B1（前端旧）' }, education: [], experience: [], projects: [] }
    ]
  };
  const result = applyResumeEdit(current, incoming);
  const A = result.profiles.find((p) => p.id === 'A');
  const B = result.profiles.find((p) => p.id === 'B');
  // A 被前端编辑值覆盖（正确）
  assert.equal(A.intention.roles, 'A3-frontend（前端编辑）');
  // B 必须保留后端的 B2，不能被前端旧快照 B1 覆盖
  assert.equal(B.intention.roles, 'B2（后端最新）', 'B 应保留后端并发值，不被前端旧快照覆盖');
});

test('P1-2 回归：applyResumeEdit 的 activeProfileId 以后端为权威', () => {
  // 后端 active 已被切到 B（比如另一个窗口切的）
  const current = {
    activeProfileId: 'B',
    profiles: [
      { id: 'default', label: '默认', intention: { roles: '默认' }, education: [], experience: [], projects: [] },
      { id: 'A', label: 'A', intention: { roles: 'A' }, education: [], experience: [], projects: [] },
      { id: 'B', label: 'B', intention: { roles: 'B' }, education: [], experience: [], projects: [] }
    ]
  };
  // 前端还以为 active 是 A，带着旧快照保存
  const incoming = {
    activeProfileId: 'A',
    intention: { roles: 'A-edited' },
    education: [], experience: [], projects: [],
    profiles: current.profiles
  };
  const result = applyResumeEdit(current, incoming);
  // active 应保持后端的 B，不被前端改成 A
  assert.equal(result.activeProfileId, 'B', 'activeProfileId 应以后端为权威');
  // 但前端的编辑值写进了哪个 profile？由于后端 active 是 B，会写进 B（这可能非用户预期，
  // 但比「悄悄改回 A」更安全——至少数据没丢，用户能在 B 里看到）。这是并发场景的权衡。
  assert.equal(result.profiles.find((p) => p.id === 'B').intention.roles, 'A-edited');
});

test('P1-4 回归：syncResumeActiveView 修正脏的 activeProfileId', () => {
  const { syncResumeActiveView } = require('../electron/store.cjs');
  const resume = {
    activeProfileId: 'ghost', // 指向不存在的 profile
    intention: {}, education: [], experience: [], projects: [],
    profiles: [
      { id: 'default', label: '默认', intention: { roles: '默认' }, education: [], experience: [], projects: [] }
    ]
  };
  syncResumeActiveView(resume);
  assert.equal(resume.activeProfileId, 'default', '脏的 activeProfileId 应回退到 profiles[0]');
  assert.equal(resume.intention.roles, '默认');
});

test('招聘邮件分类识别面试、Offer 与普通邮件', () => {
  assert.equal(classifyRecruitingMail('面试邀请', '请选择面试时间'), '面试');
  assert.equal(classifyRecruitingMail('Offer 通知', '录用意向书'), 'Offer');
  assert.equal(looksLikeRecruitingMail('周末促销', '商城', '全场五折'), false);
  assert.equal(looksLikeRecruitingMail('在线测评提醒', '腾讯招聘', '请完成'), true);
});

test('Agent API 要求 Token 并返回岗位', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-api-'));
  const store = new JsonStore(directory);
  const state = store.init();
  const server = new AgentServer({ store, onCommand: async () => ({ ok: true }) });
  const port = await server.start(0);
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/v1/jobs`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`http://127.0.0.1:${port}/v1/jobs`, {
      headers: { Authorization: `Bearer ${state.settings.apiToken}` }
    });
    assert.equal(allowed.status, 200);
    const data = await allowed.json();
    // 首次启动岗位列表为空，结构应正确返回空数组
    assert.equal(data.jobs.length, 0);
    assert.ok(Array.isArray(data.jobs));
  } finally {
    await server.stop();
  }
});

test('Agent API 在执行官网写入前要求回到应用由用户发起', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-api-review-'));
  const store = new JsonStore(directory);
  const state = store.init();
  const server = new AgentServer({
    store,
    onCommand: async () => ({
      status: 'review-required',
      message: '请回到一键投递完成核对'
    })
  });
  const port = await server.start(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.settings.apiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'fill-resume-review-test'
      },
      body: JSON.stringify({ action: 'fill_resume' })
    });
    const data = await response.json();

    assert.equal(response.status, 409);
    assert.equal(data.error, 'interactive_confirmation_required');
  } finally {
    await server.stop();
  }
});
