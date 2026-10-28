(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResumeEditorValues = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const groups = { education: '教育经历', experience: '工作经历', projects: '项目经历' };
  function booleanAnswer(value) {
    if (value === true || value === 'true' || value === '是') return true;
    if (value === false || value === 'false' || value === '否') return false;
    return value == null ? '' : String(value).trim();
  }
  function validResumeDate(value, allowOngoing = false) {
    const text = String(value ?? '').trim();
    if (!text || (allowOngoing && text === '至今')) return true;
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text);
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = match[3] && Number(match[3]);
    if (year < 1 || month < 1 || month > 12) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return match[3] === undefined || (day >= 1 && day <= days[month - 1]);
  }
  function validateResumeDates(resume) {
    const errors = [];
    for (const [key, label] of Object.entries(groups)) {
      (resume[key] || []).forEach((entry, index) => {
        const start = String(entry.start ?? '').trim(), end = String(entry.end ?? '').trim();
        if (!validResumeDate(start)) errors.push(`${label}第${index + 1}段开始时间：请填写 YYYY-MM 或 YYYY-MM-DD`);
        if (!validResumeDate(end, true)) errors.push(`${label}第${index + 1}段结束时间：请填写 YYYY-MM、YYYY-MM-DD 或至今`);
        // Mixed precision is compared only at the shared month precision.
        if (start && end && end !== '至今' && validResumeDate(start) && validResumeDate(end)) {
          const precision = start.length === 10 && end.length === 10 ? 10 : 7;
          if (end.slice(0, precision) < start.slice(0, precision)) errors.push(`${label}第${index + 1}段：结束时间早于开始时间`);
        }
      });
    }
    return errors;
  }
  return { booleanAnswer, validResumeDate, validateResumeDates };
});
