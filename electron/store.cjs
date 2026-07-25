const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSeed, createResumeProfile, emptyEducation, emptyExperience, emptyProject, defaultIntention } = require('./seed.cjs');

// 把旧版扁平 resume schema（顶层 intention/education/...，无 profiles）迁成多 profile。
// 幂等：已有 profiles 的不动。备份恢复和 migrate 都调它，确保 syncResumeActiveView 之前 profiles 一定存在。
function migrateFlatResumeToProfiles(resume) {
  if (!resume || Array.isArray(resume.profiles)) return false;
  resume.profiles = [createResumeProfile({
    id: 'default',
    label: '默认简历',
    intention: resume.intention,
    education: resume.education,
    experience: resume.experience,
    projects: resume.projects
  })];
  if (!resume.activeProfileId) resume.activeProfileId = 'default';
  return true;
}

// 把当前 activeProfile 的 intention/education/experience/projects 镜像到 resume 顶层，
// 作为「兼容视图」供旧的读取代码（resume-plan.cjs、calculateResumeCompletion、前端）使用。
// 写入流程必须通过 setResumeProfile / 切换 profile，不直接改这层镜像（它会被下次保存覆盖）。
function syncResumeActiveView(resume) {
  const profile = (resume.profiles || []).find((p) => p.id === resume.activeProfileId) || resume.profiles?.[0];
  // 修正脏的 activeProfileId：若指向不存在的 profile（并发删除/备份恢复），回退到第一个
  if (profile && resume.activeProfileId !== profile.id) resume.activeProfileId = profile.id;
  if (!profile) {
    resume.intention = defaultIntention();
    resume.education = [emptyEducation()];
    resume.experience = [emptyExperience()];
    resume.projects = [emptyProject()];
    return resume;
  }
  resume.intention = structuredClone(profile.intention);
  resume.education = structuredClone(profile.education);
  resume.experience = structuredClone(profile.experience);
  resume.projects = structuredClone(profile.projects);
  return resume;
}

class JsonStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'state.json');
    this.state = null;
  }

  init() {
    fs.mkdirSync(this.directory, { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.state = createSeed();
      this.state.settings.apiToken = crypto.randomBytes(18).toString('base64url');
      this.flush();
    } else {
      try {
        this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (error) {
        const backup = `${this.file}.broken-${Date.now()}`;
        fs.copyFileSync(this.file, backup);
        this.state = createSeed();
        this.state.settings.apiToken = crypto.randomBytes(18).toString('base64url');
        this.flush();
      }
    }
    if (!this.state.settings.apiToken) {
      this.state.settings.apiToken = crypto.randomBytes(18).toString('base64url');
      this.flush();
    }
    this.migrate();
    syncResumeActiveView(this.state.resume);
    return this.state;
  }

  // 数据迁移：升级后旧 state 可能缺新字段或公司。用最新 seed 补全，不丢已有岗位。
  migrate() {
    const seed = createSeed();
    const seedCompanies = new Map(seed.companies.map((c) => [c.id, c]));
    const existingIds = new Set((this.state.companies || []).map((c) => c.id));
    let changed = false;

    // 1. 补全缺失的公司（新版本新增的）
    for (const [id, company] of seedCompanies) {
      if (!existingIds.has(id)) {
        this.state.companies.push(company);
        changed = true;
      }
    }
    // 2. 同步已有公司的 tags/adapterStatus/portal 等字段（保留旧值里用户可能改过的 id/name）
    for (const company of this.state.companies) {
      const latest = seedCompanies.get(company.id);
      if (latest) {
        if (!company.tags || company.tags.length === 0) { company.tags = latest.tags; changed = true; }
        if (!company.adapterStatus) { company.adapterStatus = latest.adapterStatus; changed = true; }
        if (company.portal !== latest.portal) { company.portal = latest.portal; changed = true; }
      }
      // 五维能力声明迁移（无论公司是否在 seed 里都要补）：
      //   - 旧数据无 capabilities：seed 里有就用 seed 的（拿到真实五维），否则按 adapterStatus 兜底
      //   - 有 capabilities 但 seed 更新了：以 seed 为准同步（如某公司 unsupported→verified）
      if (!company.capabilities) {
        company.capabilities = latest?.capabilities
          ? structuredClone(latest.capabilities)
          : adapterStatusToCapabilities(company.adapterStatus || 'adapter-needed');
        changed = true;
      } else if (latest?.capabilities && JSON.stringify(company.capabilities) !== JSON.stringify(latest.capabilities)) {
        company.capabilities = structuredClone(latest.capabilities);
        changed = true;
      }
      if (company.lastVerifiedAt === undefined) {
        company.lastVerifiedAt = latest?.lastVerifiedAt ?? null;
        changed = true;
      } else if (latest?.lastVerifiedAt && company.lastVerifiedAt !== latest.lastVerifiedAt) {
        company.lastVerifiedAt = latest.lastVerifiedAt;
        changed = true;
      }
    }
    // 3. settings.jobs 补全（旧版可能没有）
    if (!this.state.settings.jobs) {
      this.state.settings.jobs = seed.settings.jobs;
      changed = true;
    }
    // 3b. 补全 recruitType（校招/社招分流，新字段）
    if (!this.state.settings.jobs.recruitType) {
      this.state.settings.jobs.recruitType = 'social';
      changed = true;
    }
    // 3c. 补全 cart/applied（购物车功能，新字段）
    if (!Array.isArray(this.state.cart)) { this.state.cart = []; changed = true; }
    if (!Array.isArray(this.state.applied)) { this.state.applied = []; changed = true; }
    // 3d. 内测版隐私确认、审计与 Agent 幂等记录
    if (this.state.meta.privacyAcceptedAt === undefined) {
      this.state.meta.privacyAcceptedAt = null;
      changed = true;
    }
    if (this.state.meta.schemaVersion < 2) {
      this.state.meta.schemaVersion = 2;
      changed = true;
    }
    if (!Array.isArray(this.state.audit)) {
      this.state.audit = [];
      changed = true;
    }
    if (!this.state.idempotency || typeof this.state.idempotency !== 'object') {
      this.state.idempotency = {};
      changed = true;
    }
    // 4. dataMode 旧的 'demo' 已废弃，统一改 'live'
    if (this.state.settings.dataMode === 'demo') {
      this.state.settings.dataMode = 'live';
      changed = true;
    }
    // 5. 简历 schema 升级到多 profile（v0.3）：把旧的扁平 intention/education/experience/projects 迁移进 default profile
    if (this.state.resume) {
      migrateFlatResumeToProfiles(this.state.resume);
    }
    if (changed) this.flush();
  }

  get() {
    syncResumeActiveView(this.state.resume);
    return structuredClone(this.state);
  }

  update(mutator) {
    const draft = structuredClone(this.state);
    const result = mutator(draft) || draft;
    result.meta.updatedAt = new Date().toISOString();
    // 保存前刷新简历兼容视图，保证 resume.intention/education/... 与 activeProfile 同步
    if (result.resume) syncResumeActiveView(result.resume);
    this.state = result;
    this.flush();
    return this.get();
  }

  flush() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, this.file);
  }
}

// 简历完整度：basic/skills/extras 全局 + active profile 的「至少一段填了关键字段」。
// 多段经历按「是否至少有一段非空」计，避免用户加了很多空段反而拉低完整度。
function calculateResumeCompletion(resume) {
  const profile = (resume.profiles || []).find((p) => p.id === resume.activeProfileId) || resume.profiles?.[0] || {};
  const education = profile.education || resume.education || [];
  const experience = profile.experience || resume.experience || [];
  const projects = profile.projects || resume.projects || [];
  const intention = profile.intention || resume.intention || {};
  const hasAnyFilled = (arr, keys) => arr.some((item) => keys.some((k) => String(item?.[k] || '').trim()));
  const values = [
    resume.basic?.name, resume.basic?.phone, resume.basic?.email, resume.basic?.city,
    intention.roles, intention.cities,
    hasAnyFilled(education, ['school', 'major', 'degree']) ? 'x' : '',
    hasAnyFilled(experience, ['company', 'role', 'description']) ? 'x' : '',
    hasAnyFilled(projects, ['name', 'description']) ? 'x' : '',
    resume.skills?.keywords, resume.extras?.summary
  ];
  return Math.round(values.filter((value) => String(value || '').trim()).length / values.length * 100);
}

// 旧 adapterStatus 单字符串 → 五维 capabilities 映射（迁移兜底用）。
// 只用于「旧数据无 capabilities 字段」的兜底；真实五维值以 seed.cjs 的最新 capabilities 为准（migrate 会覆盖）。
function adapterStatusToCapabilities(status) {
  switch (status) {
    case 'adapter-ready':
      return { jobs: 'verified', login: 'manual', resume: 'unsupported', apply: 'unsupported', status: 'unsupported' };
    case 'login-only':
      return { jobs: 'degraded', login: 'manual', resume: 'unsupported', apply: 'unsupported', status: 'unsupported' };
    case 'adapter-needed':
    default:
      return { jobs: 'unsupported', login: 'manual', resume: 'unsupported', apply: 'unsupported', status: 'unsupported' };
  }
}

// 应用前端传来的简历编辑：前端 collectResume 只改顶层 intention/education/experience/projects（兼容视图），
// 必须把这些写回 active profile，否则 syncResumeActiveView 会用旧 profiles 覆盖、丢掉用户输入。
// 关键：activeProfileId 和非 active profile 一律以后端（currentResume）为权威，避免前端旧快照覆盖并发改动。
// 返回新的 resume 对象（含 updatedAt/completion/profiles），调用方负责赋值给 state.resume。
function applyResumeEdit(currentResume, incoming) {
  // activeProfileId 以后端为权威（后端可能因切换/Agent 并发而变了）
  const profileId = currentResume.activeProfileId || incoming.activeProfileId || 'default';
  const baseProfiles = Array.isArray(currentResume.profiles) && currentResume.profiles.length
    ? currentResume.profiles
    : [{ id: 'default', label: '默认简历', intention: {}, education: [], experience: [], projects: [] }];
  // 非 active profile 一律用后端版本，只把 incoming 的顶层字段写进 active profile
  const updatedProfiles = baseProfiles.map((profile) => {
    if (profile.id !== profileId) return profile;
    return {
      ...profile,
      intention: incoming.intention || profile.intention || {},
      education: Array.isArray(incoming.education) ? incoming.education : (profile.education || []),
      experience: Array.isArray(incoming.experience) ? incoming.experience : (profile.experience || []),
      projects: Array.isArray(incoming.projects) ? incoming.projects : (profile.projects || [])
    };
  });
  return {
    ...currentResume,
    ...incoming,
    activeProfileId: profileId,
    profiles: updatedProfiles,
    updatedAt: new Date().toISOString(),
    completion: calculateResumeCompletion(incoming)
  };
}

// 切换 active profile。不修改 profile 内容，只改 activeProfileId 并刷新兼容视图。
function switchProfile(resume, profileId) {
  const profiles = Array.isArray(resume.profiles) ? resume.profiles : [];
  if (!profiles.some((p) => p.id === profileId)) {
    throw new Error(`简历不存在：${profileId}`);
  }
  resume.activeProfileId = profileId;
  syncResumeActiveView(resume);
  return resume;
}

// 新建一份简历。basic/skills/extras 全局共享，新 profile 带空的 intention + 各一段空经历。
// label 缺省时按 profile 数量生成「简历 N」。返回新 profile 的 id。
function addProfile(resume, label) {
  const profiles = Array.isArray(resume.profiles) ? resume.profiles : [];
  const newId = `profile-${Date.now().toString(36)}`;
  const finalLabel = (String(label || '').trim()) || `简历 ${profiles.length + 1}`;
  const newProfile = createResumeProfile({ id: newId, label: finalLabel });
  resume.profiles = [...profiles, newProfile];
  resume.activeProfileId = newId;
  syncResumeActiveView(resume);
  return newId;
}

// 删除一份简历。default 不可删；至少保留一份。删除 active 时回退到 default。
function deleteProfile(resume, profileId) {
  if (profileId === 'default') {
    throw new Error('默认简历不能删除');
  }
  let profiles = Array.isArray(resume.profiles) ? resume.profiles : [];
  const exists = profiles.some((p) => p.id === profileId);
  if (!exists) throw new Error(`简历不存在：${profileId}`);
  profiles = profiles.filter((p) => p.id !== profileId);
  if (profiles.length === 0) {
    profiles = [createResumeProfile({ id: 'default', label: '默认简历' })];
  }
  resume.profiles = profiles;
  if (resume.activeProfileId === profileId) {
    resume.activeProfileId = 'default';
  }
  syncResumeActiveView(resume);
  return resume;
}

// 重命名 profile。label 为空时拒绝。
function renameProfile(resume, profileId, label) {
  const trimmed = String(label || '').trim();
  if (!trimmed) throw new Error('简历名称不能为空');
  const profiles = Array.isArray(resume.profiles) ? resume.profiles : [];
  let changed = false;
  resume.profiles = profiles.map((p) => {
    if (p.id === profileId) { changed = true; return { ...p, label: trimmed }; }
    return p;
  });
  if (!changed) throw new Error(`简历不存在：${profileId}`);
  return resume;
}

module.exports = { JsonStore, calculateResumeCompletion, syncResumeActiveView, applyResumeEdit, switchProfile, addProfile, deleteProfile, renameProfile, migrateFlatResumeToProfiles, adapterStatusToCapabilities };
