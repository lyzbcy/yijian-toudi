const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { classifyRecruitingMail, looksLikeRecruitingMail } = require('./recruiting.cjs');

async function syncQqMail({ address, authorizationCode, limit = 80 }) {
  if (!address || !authorizationCode) {
    throw new Error('请填写 QQ 邮箱地址和 IMAP 授权码');
  }
  const client = new ImapFlow({
    host: 'imap.qq.com',
    port: 993,
    secure: true,
    auth: { user: address, pass: authorizationCode },
    logger: false
  });

  const result = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const total = client.mailbox.exists || 0;
      if (!total) return [];
      const first = Math.max(1, total - limit + 1);
      for await (const message of client.fetch(`${first}:*`, { envelope: true, source: true, flags: true })) {
        const parsed = await simpleParser(message.source);
        const subject = parsed.subject || message.envelope?.subject || '(无主题)';
        const from = parsed.from?.text || message.envelope?.from?.[0]?.address || '';
        const plain = parsed.text || parsed.html || '';
        if (!looksLikeRecruitingMail(subject, from, plain)) continue;
        result.push({
          id: `qq-${message.uid}`,
          company: inferCompany(subject, from),
          subject,
          stage: classifyRecruitingMail(subject, plain),
          receivedAt: new Date(parsed.date || Date.now()).toISOString().replace('T', ' ').slice(0, 16),
          unread: !message.flags?.has('\\Seen'),
          source: 'QQ 邮箱',
          preview: String(plain).replace(/\s+/g, ' ').slice(0, 160)
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return result.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

function inferCompany(subject, from) {
  const source = `${subject} ${from}`;
  const names = ['腾讯', '阿里巴巴', '字节跳动', '美团', '小米', '网易', '华为', '百度', '京东', '拼多多'];
  return names.find((name) => source.includes(name)) || from.split('<')[0].trim() || '招聘信息';
}

module.exports = { syncQqMail };
