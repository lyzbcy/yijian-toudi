// 统一简历 → JSON Resume 标准格式（jsonresume.org）
//
// JSON Resume 是最通用的开源简历 JSON 标准，生态最广：
//   - Reactive Resume（rxresu.me）：导入后 50+ 模板任选、一键下载 PDF、无水印
//   - jsonresume.org 主题生态（上百套主题，CLI 一条命令出 PDF）
//   - RenderCV 等本地渲染器
//
// 本模块把应用内简历（多 profile 取激活 profile 的视图字段）转换为该标准。

function splitKeywords(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw || '').split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean);
}

// 长文本描述拆成要点列表（按句号/分号切分），适配简历模板的 highlights 展示
function toHighlights(text, maxLength = 6) {
  const parts = String(text || '')
    .split(/(?<=[。；;])/)
    .map((s) => s.trim().replace(/[。；;]$/, ''))
    .filter(Boolean);
  return parts.slice(0, maxLength);
}

function period(start, end) {
  const fmt = (v) => String(v || '').trim();
  if (fmt(start) && fmt(end)) return `${fmt(start)} – ${fmt(end)}`;
  if (fmt(start)) return `${fmt(start)} – 至今`;
  return '';
}

function isoDate(value, fallback) {
  const match = String(value || '').match(/^(\d{4})[-/](\d{1,2})/);
  if (!match) return fallback || undefined;
  return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
}

function createJsonResume(resume) {
  const basic = resume.basic || {};
  const intention = resume.intention || {};
  const extras = resume.extras || {};
  const skills = resume.skills || {};
  const headline = intention.roles || basic.headline || '';
  return {
    basics: {
      name: basic.name || '',
      label: Array.isArray(headline) ? headline.join(' / ') : String(headline || ''),
      email: basic.email || '',
      phone: basic.phone || '',
      // 官方标准是 url；同时输出 website 兼容旧生态
      url: basic.website || '',
      website: basic.website || '',
      summary: extras.summary || '',
      location: {
        city: basic.city || '',
        region: basic.province || '',
        countryCode: 'CN',
        address: [basic.province, basic.city].filter(Boolean).join(' ')
      },
      profiles: [
        ...(basic.github ? [{ network: 'GitHub', username: 'lyzbcy', url: basic.github }] : [])
      ]
    },
    work: (resume.experience || []).filter((e) => e.company || e.role).map((e) => ({
      company: e.company || '',
      // Reactive Resume v5 导入器读 name；官方标准是 company，两者都输出
      name: e.company || '',
      position: e.role || '',
      website: '',
      startDate: isoDate(e.start),
      endDate: e.end ? isoDate(e.end) : undefined,
      summary: e.description ? String(e.description).slice(0, 400) : '',
      highlights: toHighlights(e.description)
    })),
    education: (resume.education || []).filter((e) => e.school).map((e) => ({
      institution: e.school || '',
      area: e.major || '',
      studyType: `${e.degree || ''}${e.degreeName ? ' · ' + e.degreeName : ''}`.trim(),
      startDate: isoDate(e.start),
      endDate: isoDate(e.end, undefined),
      // 官方标准 gpa；Reactive Resume v5 导入器读 score
      gpa: e.gpa || (e.rank ? `排名 ${e.rank}` : ''),
      score: e.gpa || (e.rank ? `排名 ${e.rank}` : ''),
      courses: splitKeywords(e.courses)
    })),
    projects: (resume.projects || []).filter((p) => p.name).map((p) => ({
      name: p.name || '',
      description: [p.description, p.contribution].filter(Boolean).join(' '),
      highlights: [p.outcome, p.techStack ? `技术栈：${p.techStack}` : ''].filter(Boolean),
      keywords: splitKeywords(p.techStack),
      startDate: isoDate(p.start),
      endDate: p.end ? isoDate(p.end) : undefined,
      url: p.link || '',
      roles: p.role ? [p.role] : [],
      entity: p.client || '',
      type: 'project'
    })),
    skills: [
      {
        name: '技术栈',
        level: skills.proficiency || '',
        keywords: splitKeywords(skills.keywords)
      },
      ...(splitKeywords(skills.languages).length
        ? [{ name: '语言能力', level: '', keywords: splitKeywords(skills.languages) }]
        : []),
      ...(splitKeywords(skills.certificates).length
        ? [{ name: '证书', level: '', keywords: splitKeywords(skills.certificates) }]
        : [])
    ],
    awards: splitKeywords(extras.awards).map((title) => ({
      title,
      date: '',
      awarder: '',
      summary: ''
    })),
    languages: splitKeywords(skills.languages).map((name) => ({ language: name, fluency: '' })),
    interests: splitKeywords(skills.interests).map((name) => ({ name }))
  };
}

module.exports = { createJsonResume, toHighlights, splitKeywords };
