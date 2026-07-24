const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSeed } = require('./seed.cjs');

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
    // 4. dataMode 旧的 'demo' 已废弃，统一改 'live'
    if (this.state.settings.dataMode === 'demo') {
      this.state.settings.dataMode = 'live';
      changed = true;
    }
    if (changed) this.flush();
  }

  get() {
    return structuredClone(this.state);
  }

  update(mutator) {
    const draft = structuredClone(this.state);
    const result = mutator(draft) || draft;
    result.meta.updatedAt = new Date().toISOString();
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

function calculateResumeCompletion(resume) {
  const values = [
    resume.basic.name, resume.basic.phone, resume.basic.email, resume.basic.city,
    resume.intention.roles, resume.intention.cities,
    resume.education?.[0]?.school, resume.education?.[0]?.major, resume.education?.[0]?.degree,
    resume.experience?.[0]?.company, resume.experience?.[0]?.role, resume.experience?.[0]?.description,
    resume.projects?.[0]?.name, resume.projects?.[0]?.description,
    resume.skills.keywords, resume.extras.summary
  ];
  return Math.round(values.filter((value) => String(value || '').trim()).length / values.length * 100);
}

module.exports = { JsonStore, calculateResumeCompletion };
