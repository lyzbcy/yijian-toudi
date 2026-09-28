// 企业微信群机器人通知（2026-09-20 新增，对应技术方案 §10.1）
// 使用方式：主进程调用 configure(store) 绑定配置；投递/批量事件调用 notify(text)。
// 频控：企微 webhook 限 20 条/分钟，调用方按批汇总推送；本模块再兜一层最小间隔熔断。
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

let webhookUrl = '';
let lastSendAt = 0;
let recentCount = 0;        // 滚动窗口内发送数（60s）
const windowStartedAt = { value: Date.now() };
const MIN_INTERVAL_MS = 3000;   // 单条最小间隔
const MAX_PER_MINUTE = 18;      // 低于平台 20 上限，留余量

function configure(url) {
  webhookUrl = typeof url === 'string' ? url.trim() : '';
}

function isEnabled() {
  return /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/.test(webhookUrl);
}

function postJson(url, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error('invalid webhook url'));
      return;
    }
    const mod = target.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const req = mod.request(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('webhook timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

// 发送文本消息。返回 { sent, reason? }：配置缺失/限频时不抛错，调用方可安全忽略。
async function notify(text) {
  if (!isEnabled()) return { sent: false, reason: 'webhook-not-configured' };
  const now = Date.now();
  if (now - windowStartedAt.value > 60000) {
    windowStartedAt.value = now;
    recentCount = 0;
  }
  if (recentCount >= MAX_PER_MINUTE) return { sent: false, reason: 'rate-limit' };
  if (now - lastSendAt < MIN_INTERVAL_MS) return { sent: false, reason: 'too-frequent' };
  lastSendAt = now;
  recentCount += 1;
  try {
    const res = await postJson(webhookUrl, { msgtype: 'text', text: { content: String(text || '').slice(0, 2000) } });
    const ok = res.status === 200 && res.body && res.body.errcode === 0;
    return ok ? { sent: true } : { sent: false, reason: `errcode=${res.body && res.body.errcode}` };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

// 批量进度汇总的统一格式，避免各调用方拼不一样
function formatBatchProgress(applied, total, tail) {
  const lines = [`【一键投递·进度 ${applied}/${total}】`];
  for (const item of tail) {
    lines.push(`· ${item.time || ''} ${item.city || ''} ${item.company || ''}｜${item.title || ''}`);
  }
  return lines.join('\n');
}

module.exports = { configure, isEnabled, notify, formatBatchProgress, postJson };
