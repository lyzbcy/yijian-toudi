const crypto = require('node:crypto');

function commandFingerprint(body) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(body || {}))
    .digest('hex');
}

function createAuditEntry({
  action,
  source,
  target,
  status,
  message
}) {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action: String(action || 'unknown').slice(0, 80),
    source: String(source || 'unknown').slice(0, 80),
    target: target ? String(target).slice(0, 160) : null,
    status: String(status || 'unknown').slice(0, 40),
    message: String(message || '').slice(0, 300)
  };
}

function normalizeIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key) return null;
  if (key.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error('Idempotency-Key 只允许字母、数字、点、下划线、冒号和连字符，且不超过 120 个字符');
  }
  return key;
}

module.exports = {
  commandFingerprint,
  createAuditEntry,
  normalizeIdempotencyKey
};
