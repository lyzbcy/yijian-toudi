// A short-lived, one-use approval supplements (never replaces) strict automatic binding.
const { createHash } = require('node:crypto');
const { classifyBossBinding, normalizePhoneMask } = require('./boss-binding.cjs');
function selfIdentity(snapshot, account, { name, phone } = {}) {
  if (account?.id !== 'default' || !String(name || '').trim() || !normalizePhoneMask(phone)) throw Error('self-confirm-profile-required');
  const strict = classifyBossBinding(snapshot, account, { defaultPhone: phone });
  if (strict.error !== 'account-phone-unreadable') throw Error(strict.error || 'automatic-verification-available');
  const names = [];
  function walk(nodes) { for (const n of nodes || []) { if (typeof n.name === 'string') names.push(n.name.trim()); walk(n.children); } }
  walk(snapshot.data.tree);
  const masks = [...new Set(names.flatMap(n => [...n.matchAll(/(?<!\d)1\d{2}\*{6}\d{2}(?!\d)/g)].map(m => m[0])))];
  const normalized = normalizePhoneMask(phone), expected = normalized.slice(0, 3) + '******' + normalized.slice(-2);
  if (masks.length !== 1 || masks[0] !== expected || !names.includes(name.trim())) throw Error('self-confirm-identity-mismatch');
  const identity = { name: name.trim(), phone: expected, url: snapshot.data.url };
  return { ...identity, fingerprint: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}
function consumeApproval(approval, identity, client, now = Date.now()) {
  return Boolean(approval && approval.client === client && approval.fingerprint === identity.fingerprint && now >= approval.at && now - approval.at <= 15 * 60 * 1000);
}
module.exports = { selfIdentity, consumeApproval };
