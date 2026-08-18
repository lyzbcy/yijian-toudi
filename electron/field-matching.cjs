const UNSAFE_PATTERN = /密码|password|验证码|captcha|提交|投递|申请职位|apply\b|submit\b|支付|银行卡|身份证照片/i;

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeComparableValue(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  if (value === 'true') return '是';
  if (value === 'false') return '否';
  if (Array.isArray(value)) return value.map(normalizeComparableValue).filter(Boolean).sort().join('|');
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isUnsafeField(field = {}) {
  const type = normalizeText(field.type);
  if (type.includes('password') || type.includes('hidden') || type.includes('submit')) return true;
  return UNSAFE_PATTERN.test([
    field.label, field.placeholder, field.name, field.id, field.ariaLabel, field.autocomplete
  ].filter(Boolean).join(' '));
}

function scoreField(item, field) {
  if (isUnsafeField(field)) return 0;
  const label = normalizeText(field.label);
  const placeholder = normalizeText(field.placeholder);
  const name = normalizeText(field.name);
  const id = normalizeText(field.id);
  const aria = normalizeText(field.ariaLabel);
  const autocomplete = normalizeText(field.autocomplete);
  const keyTail = normalizeText(item.key?.split('.').pop());
  const allText = [label, placeholder, name, id, aria].join(' ');
  if (item.key === 'basic.city' && /期望|意向|工作城市/.test(allText)) return 0;
  if ((item.key === 'intention.cities' || item.key === 'intention.preferredLocations') && /现居|当前|籍贯|户籍/.test(allText)) return 0;
  let score = 0;

  for (const rawKeyword of item.keywords || []) {
    const keyword = normalizeText(rawKeyword);
    if (!keyword) continue;
    if (label === keyword) score = Math.max(score, 0.94);
    if (String(field.type || '').includes('radio') && label === `${keyword} ${normalizeText(field.controlValue)}`) score = Math.max(score, 0.94);
    if (placeholder === keyword || placeholder === `请输入${keyword}` || placeholder === `请选择${keyword}`) score = Math.max(score, 0.9);
    if (name === keyword || id === keyword || aria === keyword || autocomplete === keyword) score = Math.max(score, 0.92);
    // 包含关系只提供“建议人工核对”的弱信号，不跨过默认自动填写阈值。
    // 例如“城市”不能把现居城市写进期望工作城市。
    if (label.startsWith(keyword) || placeholder.includes(keyword)) score = Math.max(score, 0.68);
    if (label.includes(keyword)) score = Math.max(score, 0.62);
  }
  if (keyTail && [name, id, autocomplete].includes(keyTail)) score = Math.max(score, 0.96);
  return score;
}

function matchField(item, fields, { safeThreshold = 0.72, ambiguityGap = 0.04 } = {}) {
  const candidates = (fields || [])
    .map((field) => ({ field, confidence: scoreField(item, field) }))
    .filter((candidate) => candidate.confidence >= safeThreshold)
    .sort((left, right) => right.confidence - left.confidence);
  if (candidates.length === 0) return { status: 'unmatched', field: null, confidence: 0, candidates: [] };
  if (candidates[1] && candidates[0].confidence - candidates[1].confidence < ambiguityGap) {
    return { status: 'ambiguous', field: null, confidence: candidates[0].confidence, candidates: candidates.slice(0, 3) };
  }
  return { status: 'matched', field: candidates[0].field, confidence: candidates[0].confidence, candidates: candidates.slice(0, 3) };
}

module.exports = {
  UNSAFE_PATTERN,
  normalizeText,
  normalizeComparableValue,
  isUnsafeField,
  scoreField,
  matchField
};
