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
  // 文件输入框不能接收文本值：简历附件/照片走专门的 setInputFiles 流程，不参与文本匹配
  if (String(field.type || '').toLowerCase().includes('file')) return 0;
  const label = normalizeText(field.label);
  const placeholder = normalizeText(field.placeholder);
  const name = normalizeText(field.name);
  const id = normalizeText(field.id);
  const aria = normalizeText(field.ariaLabel);
  const autocomplete = normalizeText(field.autocomplete);
  const keyTail = normalizeText(item.key?.split('.').pop());
  const allText = [label, placeholder, name, id, aria].join(' ');
  // 中文表单常见「请输入X/请选择X/请填写您的X」前缀：去前缀后可做强匹配。
  // 腾讯等站的 label 常是「placeholder + 组件噪声(el-input__inner)」，同样受益。
  const stripPromptPrefix = (text) => text
    .replace(/^(请输入|请选择|请填写|请输入您的|请选择您的|请填写您的|请输入你|请选择你|请填写你|请|输入|选择|填写)+/, '')
    .replace(/^(的|您|你)+/, '').replace(/^(的)/, '');
  const strippedPlaceholder = placeholder ? stripPromptPrefix(placeholder) : '';
  const strippedLabelHead = label && placeholder && label.startsWith(placeholder) ? strippedPlaceholder : '';
  if (item.key === 'basic.city' && /期望|意向|工作城市|面试城市|参加面试/.test(allText)) return 0;
  if ((item.key === 'intention.cities' || item.key === 'intention.preferredLocations') && /现居|当前|籍贯|户籍/.test(allText)) return 0;
  let score = 0;

  for (const rawKeyword of item.keywords || []) {
    const keyword = normalizeText(rawKeyword);
    if (!keyword) continue;
    if (label === keyword) score = Math.max(score, 0.94);
    if (String(field.type || '').includes('radio') && label === `${keyword} ${normalizeText(field.controlValue)}`) score = Math.max(score, 0.94);
    if (placeholder === keyword || placeholder === `请输入${keyword}` || placeholder === `请选择${keyword}`) score = Math.max(score, 0.9);
    if (name === keyword || id === keyword || aria === keyword || autocomplete === keyword) score = Math.max(score, 0.92);
    // 去前缀后的 placeholder 与关键词全等：等价于「请输入姓名」=「姓名」，按强信号计
    if (strippedPlaceholder === keyword) score = Math.max(score, 0.9);
    // label 是 placeholder+组件噪声（腾讯 el-input），去前缀后同样全等
    if (strippedLabelHead === keyword) score = Math.max(score, 0.88);
    // 去前缀后的 placeholder 包含关键词：次强信号（覆盖「请输入邮箱地址」←「邮箱」）
    if (keyword.length >= 2 && strippedPlaceholder.includes(keyword)) score = Math.max(score, 0.76);
    // 中文长关键词（≥4字）被包含：特异性强。placeholder 直指者 0.82，仅祖先 label 命中者 0.78
    //（差距大于歧义阈值，避免同区块兄弟字段因祖先文本污染被判 ambiguous）
    if (keyword.length >= 4 && placeholder.includes(keyword)) score = Math.max(score, 0.82);
    else if (keyword.length >= 4 && label.includes(keyword)) score = Math.max(score, 0.78);
    // 单选项：控件值与期望一致且 label 含关键词（如「男 … 性别*」），强信号
    if (String(field.type || '').includes('radio')
      && normalizeText(field.controlValue) === normalizeComparableValue(item.value).toLowerCase()
      && label.includes(keyword)) score = Math.max(score, 0.9);
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
