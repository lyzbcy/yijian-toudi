// 岗位匹配度计算（design §T3.9 #23：真算 + 明确标注仅供参考）。
//
// 算法：从简历提取关键词（skills.keywords + intention.roles 拆词），在 job 的
// title/tags/summary 文本里统计命中次数，归一化到 0-100。
// 这是启发式匹配，不是精确值——前端会明确标注「基于关键词，仅供参考」。
//
// 关键词来源（优先级从高到低）：
//   1. intention.roles（目标岗位，权重 3）
//   2. skills.keywords（专业技能，权重 2）
//   3. skills.certificates/languages（权重 1）
// 命中规则：关键词（中英混合）在 job 文本里出现即计分，长词（≥3 字符）权重更高。

// 把逗号/顿号/空格分隔的关键词字符串拆成词数组，去掉太短的无意义词
function splitKeywords(text) {
  if (!text) return [];
  return String(text)
    .split(/[,，、\s/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

// 计算 job 对当前简历 profile 的匹配度（0-100）。
// job: { title, tags[], summary, department, experience, education }
// resume: { intention: {roles}, skills: {keywords, certificates, languages} }
function calculateJobMatch(job, resume) {
  if (!job || !resume) return 0;
  const roleKws = splitKeywords(resume.intention?.roles);
  const skillKws = splitKeywords(resume.skills?.keywords);
  const certKws = splitKeywords(`${resume.skills?.certificates || ''} ${resume.skills?.languages || ''}`);

  if (roleKws.length === 0 && skillKws.length === 0 && certKws.length === 0) return 0;

  // job 文本统一小写
  const jobText = [
    job.title || '',
    job.department || '',
    (job.tags || []).join(' '),
    job.summary || '',
    job.experience || '',
    job.education || ''
  ].join(' ').toLowerCase();

  if (!jobText.trim()) return 0;

  let score = 0;
  let maxPossible = 0;
  // 固定权重：role 最高（目标岗位最相关），skill 其次，cert 最低。
  // 不按词长加成，避免长 skill 词压过短 role 词的优先级。
  const scoreKw = (kw, weight) => {
    maxPossible += weight;
    if (jobText.includes(kw.toLowerCase())) score += weight;
  };
  roleKws.forEach((kw) => scoreKw(kw, 5));
  skillKws.forEach((kw) => scoreKw(kw, 3));
  certKws.forEach((kw) => scoreKw(kw, 1));

  if (maxPossible === 0) return 0;
  return Math.round((score / maxPossible) * 100);
}

// 批量给 jobs 数组算匹配度。原地修改 job.match 字段，返回 jobs。
function applyJobMatches(jobs, resume) {
  for (const job of jobs) {
    job.match = calculateJobMatch(job, resume);
  }
  return jobs;
}

module.exports = { calculateJobMatch, applyJobMatches, splitKeywords };
