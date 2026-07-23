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
    return this.state;
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
