// CDP 控制「一键投递」renderer 执行 JS（表达式从文件读取，突破命令行长度限制）
// 用法：node cdp-app-file.cjs <expr文件路径>  —— 返回 JSON 结果
const fs = require('node:fs');
const WebSocket = require('ws');
const http = require('node:http');

function getWsUrl(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const tabs = JSON.parse(data);
        const page = tabs.find((t) => t.type === 'page');
        resolve(page.webSocketDebuggerUrl);
      });
    }).on('error', reject);
  });
}

async function main() {
  const file = process.argv[2];
  const port = process.argv[3] || '9222';
  if (!file || !fs.existsSync(file)) { console.error('usage: node cdp-app-file.cjs <expr-file> [port]'); process.exit(1); }
  const expr = fs.readFileSync(file, 'utf8');
  const wsUrl = await getWsUrl(port);
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.on('open', resolve));
  const id = 1;
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id === id) {
      if (msg.result && msg.result.exceptionDetails) {
        console.error('EXC:', JSON.stringify(msg.result.exceptionDetails.exception));
        process.exit(1);
      }
      const v = msg.result && msg.result.result;
      console.log(typeof v.value === 'string' ? v.value : JSON.stringify(v && v.value));
      ws.close();
      process.exit(0);
    }
  });
}
main().catch((err) => { console.error(err.message); process.exit(1); });
