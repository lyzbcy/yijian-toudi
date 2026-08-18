function mask(value, { keepStart = 0, keepEnd = 0 } = {}) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= keepStart + keepEnd) return '[已脱敏]';
  return `${text.slice(0, keepStart)}***${keepEnd ? text.slice(-keepEnd) : ''}`;
}

function redactResume(resume) {
  const safe = structuredClone(resume || {});
  if (safe.basic) {
    for (const key of ['idCard', 'idNumber', 'emergencyContact']) safe.basic[key] = mask(safe.basic[key], { keepEnd: 2 });
    safe.basic.phone = mask(safe.basic.phone, { keepStart: 3, keepEnd: 2 });
    safe.basic.email = safe.basic.email ? '[已脱敏邮箱]' : '';
    safe.basic.wechat = mask(safe.basic.wechat, { keepStart: 1 });
    safe.basic.qq = mask(safe.basic.qq, { keepEnd: 2 });
    for (const key of ['name', 'birthday', 'nativePlace']) safe.basic[key] = safe.basic[key] ? '[已脱敏]' : '';
  }
  safe.family = (safe.family || []).map(() => ({ redacted: true }));
  if (safe.compliance) safe.compliance = { redacted: true };
  return safe;
}

function createRedactedSnapshot(state) {
  const safe = structuredClone(state || {});
  safe.resume = redactResume(safe.resume);
  if (safe.settings) {
    delete safe.settings.apiToken;
    if (safe.settings.email) {
      delete safe.settings.email.encryptedCode;
      safe.settings.email.address = safe.settings.email.address ? '[已脱敏邮箱]' : '';
    }
  }
  delete safe.idempotency;
  safe.messages = (safe.messages || []).map((message) => ({
    id: message.id,
    stage: message.stage,
    receivedAt: message.receivedAt,
    redacted: true
  }));
  return safe;
}

module.exports = { mask, redactResume, createRedactedSnapshot };
