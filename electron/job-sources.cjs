'use strict';
// Read-only source observations enter our own catalog. Never POST to OfferBiu.
const crypto = require('node:crypto');
const digest = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const key = s => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
function fail(s, status = 400) { throw Object.assign(Error(s), { status }); }
function txt(s, max = 1000) { if (s == null) return ''; if (typeof s !== 'string' || s.length > max) fail('invalid-source-text'); return s.trim(); }
function link(s) {
  if (!s) return '';
  let u; try { u = new URL(txt(s, 4096)); } catch { fail('invalid-source-link'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fail('invalid-source-link');
  // Preserve ATS routes/fragments, but not login/session/tracking parameters.
  const clean = q => { for (const k of [...q.keys()]) if (/token|session|auth|password|ticket|secret|cookie|code|^utm_|candidateSource/i.test(k)) q.delete(k); return q; };
  u.search = clean(u.searchParams).toString();
  if (u.hash.includes('?')) { const i = u.hash.indexOf('?'); u.hash = u.hash.slice(0, i) + '?' + clean(new URLSearchParams(u.hash.slice(i + 1))).toString(); }
  return u.href;
}
function normalizeOfferBiu(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid-source-body');
  const sourceUrl = link(body.sourceUrl);
  const u = new URL(sourceUrl || 'https://invalid.example');
  if (u.origin !== 'https://offerbiu.com' || u.pathname !== '/companies/') fail('offerbiu-library-url-required');
  const date = Date.parse(body.capturedAt);
  if (!Number.isFinite(date) || date > Date.now() + 60000) fail('invalid-source-time');
  const p = body.payload;
  if (p?.success !== true || p.code !== 'OK' || !Array.isArray(p.data?.items)) fail('source-response-not-success');
  const data = p.data;
  if (!Number.isInteger(body.observedPage) || body.observedPage < 0 || data.page !== body.observedPage) fail('source-page-mismatch');
  if (data.items.length > 100 || !Number.isInteger(data.size) || data.size < 1 || data.items.length > data.size) fail('source-page-size');
  const capturedAt = new Date(date).toISOString();
  const jobs = data.items.map(r => {
    const sourceJobId = txt(r.id, 160), companyName = txt(r.companyName, 300);
    if (!/^[\w-]+$/.test(sourceJobId) || !companyName) fail('invalid-source-identity');
    const positions = txt(r.positionsText, 16000);
    if (!positions) fail('source-positions-required');
    if (!Array.isArray(r.locations) || r.locations.length > 100 || !Array.isArray(r.targetYears) || r.targetYears.some(y => !Number.isInteger(y) || y < 2000 || y > 2100)) fail('invalid-source-locations-years');
    const locations = r.locations.map(x => txt(x, 120));
    const applicationUrl = link(r.applyUrl), announcementUrl = link(r.announcementUrl);
    const deadlineAt = r.deadlineAt == null ? null : new Date(r.deadlineAt);
    if (deadlineAt && !Number.isFinite(+deadlineAt)) fail('invalid-source-deadline');
    const companyId = 'catalog-company-' + digest(key(companyName));
    const expired = Boolean(deadlineAt && +deadlineAt < Date.now());
    return { id: 'offerbiu-' + sourceJobId, companyId, companyName, title: positions,
      // One row is a recruitment announcement, not N fabricated individual jobs.
      recordKind: 'recruitment-announcement', sourceId: 'offerbiu', sourceJobId,
      sourceUrl, source: 'OfferBiu 校招信息库', capturedAt, sourcePage: data.page,
      sourceUpdatedAt: txt(r.sourceUpdatedAt, 60), locations, city: locations.join(' / ') || '待核验',
      targetYears: r.targetYears, companyNature: txt(r.companyNature, 100),
      department: txt(r.industry, 200), type: '校招线索', jobType: '校招',
      education: '待原招聘页核验', experience: '待核验', salary: '',
      url: applicationUrl || announcementUrl || sourceUrl, applicationUrl, announcementUrl,
      deadlineAt: deadlineAt?.toISOString() || null, deadlineText: txt(r.deadlineText, 300),
      summary: positions + '\n' + txt(r.noteText, 4000),
      postedAt: /^\d{4}-\d\d-\d\d/.test(r.sourceUpdatedAt || '') ? r.sourceUpdatedAt.slice(0, 10) : '',
      tags: ['校招线索', '待核验', ...r.targetYears.map(String), txt(r.companyNature, 100)].filter(Boolean),
      sourceStatus: txt(r.status, 40), expired, requiresReview: true,
      reviewFlags: ['核验具体岗位ID、实际主体、资格和截止时间', ...(/等\s*\d+\s*项|\.{3}|…/.test(positions) ? ['来源职位文本可能截断'] : []), ...(!applicationUrl ? ['缺少直接投递链接'] : [])],
      favorite: false, match: 0 };
  });
  if (new Set(jobs.map(j => j.id)).size !== jobs.length) fail('duplicate-source-row');
  return { source: 'offerbiu', sourceUrl, capturedAt, page: data.page, size: data.size,
    totalItems: Number.isInteger(data.totalItems) ? data.totalItems : null,
    previewLimited: data.previewLimited === true, complete: false, jobs };
}
function importOfferBiu(state, body) {
  const batch = normalizeOfferBiu(body);
  const jobs = structuredClone(state.jobs || []), companies = structuredClone(state.companies || []);
  const report = { source: 'offerbiu', page: batch.page, added: 0, updated: 0, stale: 0, preservedEdits: 0,
    previewLimited: batch.previewLimited, complete: false, count: batch.jobs.length };
  for (const incoming of batch.jobs) {
    let item = jobs.find(j => j.id === incoming.id);
    if (!item) { item = { ...incoming, sourceSnapshot: structuredClone(incoming) }; jobs.push(item); report.added++; }
    else if (Date.parse(item.capturedAt) > Date.parse(batch.capturedAt)) { report.stale++; continue; }
    else {
      const old = item.sourceSnapshot || {};
      // Imported observations cannot erase manual edits, favorites, cart or applications.
      for (const [field, value] of Object.entries(incoming)) {
        if (['favorite', 'match'].includes(field)) continue;
        if (JSON.stringify(item[field]) === JSON.stringify(old[field])) item[field] = value;
        else if (JSON.stringify(item[field]) !== JSON.stringify(value)) report.preservedEdits++;
      }
      item.sourceSnapshot = structuredClone(incoming); report.updated++;
    }
    if (!companies.some(c => c.id === incoming.companyId)) companies.push({ id: incoming.companyId,
      name: incoming.companyName, short: incoming.companyName.slice(0, 2), color: '#64748b', portal: incoming.url,
      tags: ['来源主体待核验'], enabled: false, adapterStatus: 'source-only',
      capabilities: { jobs: 'manual', login: 'manual', resume: 'unsupported', apply: 'unsupported', status: 'unsupported' } });
  }
  if (jobs.length > 50000) fail('job-catalog-limit', 409);
  state.jobs = jobs; state.companies = companies;
  state.jobSources ||= {};
  state.jobSources.offerbiu = { ...report, capturedAt: batch.capturedAt, sourceUrl: batch.sourceUrl, totalItems: batch.totalItems };
  return report;
}
module.exports = { normalizeOfferBiu, importOfferBiu, link };
