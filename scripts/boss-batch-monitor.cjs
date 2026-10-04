// Boss 批量监控：每 60s 轮询状态，异常/结束即退出并打印汇总
const { WebSocket } = require('ws');
const http = require('node:http');
const fs = require('node:fs');

function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const page = JSON.parse(data).find((t) => t.type === 'page');
        resolve(page.webSocketDebuggerUrl);
      });
    }).on('error', reject);
  });
}

async function main() {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result && msg.result.result && msg.result.result.value);
      pending.delete(msg.id);
    }
  });
  const evalJs = (expr) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });

  const started = Date.now();
  for (;;) {
    const st = await evalJs("window.oneClick.bossBatchStatus().then(r => JSON.stringify(r))");
    let parsed = null;
    try { parsed = JSON.parse(st); } catch {}
    if (!parsed) { console.log('status-unreadable:', String(st).slice(0, 100)); break; }
    const applied = (parsed.applied || []).length;
    const min = Math.round((Date.now() - started) / 60000);
    console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] +${min}min applied=${applied}/100 fails=${parsed.fails || 0} stopped=${parsed.stopped} reason=${parsed.stopReason || '-'}`);
    fs.writeFileSync('C:/Users/24676/AppData/Local/Temp/boss-batch-state.json', JSON.stringify(parsed, null, 2));
    if (parsed.stopped || applied >= 100) {
      console.log('BATCH_DONE');
      (parsed.applied || []).slice(-100).forEach((a) => console.log(`  ${a.time} [${a.city}] ${a.title} @ ${a.company || '?'}`));
      break;
    }
    await new Promise((r) => setTimeout(r, 60000));
  }
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('monitor error:', e.message); process.exit(1); });
