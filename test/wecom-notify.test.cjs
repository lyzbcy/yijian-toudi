// 单元测试：企微通知模块 + Kimi 桥协议 + Boss 批量筛选规则（2026-09-20）
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { WebSocket } = require('ws');

const { configure, isEnabled, notify, postJson } = require('../electron/wecom-notify.cjs');
const { KimiBridge } = require('../electron/kimi-bridge.cjs');
const { isTargetJob } = require('../electron/boss-batch.cjs');
// findRef/extractJobLinks 未导出，用模块源码同款正则做 Node-stringify 回归（2026-09-20 事故：Python 带空格 vs Node 无空格导致 links=0）
const RE_LINK = /"role":\s*"link",\s*"name":\s*"([^"]{3,60})",\s*"ref":\s*"(@e\d+)"/g;

// —— wecom-notify：本地 mock webhook 验证请求体与域名校验 ——
test('wecom-notify 发送正确的企微消息体', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const res = await postJson(`http://127.0.0.1:${port}/webhook/send?key=test`, { msgtype: 'text', text: { content: 'hello' } });
  assert.strictEqual(res.body.errcode, 0);
  assert.strictEqual(received.msgtype, 'text');
  assert.strictEqual(received.text.content, 'hello');
  server.close();
});

test('wecom-notify 未配置/非企微官方域时不发送', async () => {
  configure('');
  assert.strictEqual(isEnabled(), false);
  const r1 = await notify('x');
  assert.strictEqual(r1.sent, false);
  assert.strictEqual(r1.reason, 'webhook-not-configured');
  configure('https://evil.example.com/hook');
  assert.strictEqual(isEnabled(), false);
  const r2 = await notify('x');
  assert.strictEqual(r2.sent, false);
  assert.strictEqual(r2.reason, 'webhook-not-configured');
});

// —— kimi-bridge：模拟扩展验证 hello 握手与 tool_call 往返 ——
test('kimi-bridge 与模拟扩展完成协议往返', async () => {
  const bridge = new KimiBridge({ port: 0, log: () => {} });
  const started = await bridge.start();
  assert.strictEqual(started.started, true);
  const port = bridge.port;

  let helloAcked = false;
  const fakeExt = new WebSocket(`ws://127.0.0.1:${port}`);
  fakeExt.on('open', () => {
    fakeExt.send(JSON.stringify({ type: 'hello', payload: { extensionVersion: 'test' } }));
  });
  fakeExt.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'hello_ack') helloAcked = true;
    if (msg.type === 'ping') fakeExt.pong();
    if (msg.type === 'tool_call') {
      fakeExt.send(JSON.stringify({ type: 'tool_result', responseToRequestId: msg.requestId, payload: { data: { success: true, echoed: msg.payload.name } } }));
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.strictEqual(bridge.isUp(), true);
  assert.strictEqual(helloAcked, true, '桥应回 hello_ack');
  const result = await bridge.sendTool('navigate', { url: 'https://example.com' }, { timeoutMs: 5000 });
  assert.strictEqual(result.data.echoed, 'navigate');
  fakeExt.close();
  bridge.stop();
});

// —— boss-batch：筛选规则表（含三次事故的回归用例）——
test('boss-batch 筛选规则：目标岗命中、事故岗排除', () => {
  // 应投（用户口径：前后端/游戏/AI/全栈都投）
  assert.strictEqual(isTargetJob('前端开发实习生'), true);
  assert.strictEqual(isTargetJob('游戏开发实习生'), true);
  assert.strictEqual(isTargetJob('Agent算法实习生'), true);
  assert.strictEqual(isTargetJob('27届校招-后端开发工程师'), true);
  assert.strictEqual(isTargetJob('全栈开发实习生vue/java'), true);
  assert.strictEqual(isTargetJob('Unity开发实习生'), true);
  // 事故批回归：不投
  assert.strictEqual(isTargetJob('爱玩游戏你就来 实习可来薪资日结 游戏陪玩'), false, '陪玩');
  assert.strictEqual(isTargetJob('游戏UI设计师实习'), false, 'UI设计');
  assert.strictEqual(isTargetJob('游戏动作实习生'), false, '动作美术');
  assert.strictEqual(isTargetJob('游戏体验实习生'), false, '体验/测试向');
  assert.strictEqual(isTargetJob('软件测试（实习岗）'), false, '测试');
  assert.strictEqual(isTargetJob('打字客服专员'), false, '客服');
  assert.strictEqual(isTargetJob('实习生应届生资深研发工程师项目申报高新'), false, '项目申报中介');
  assert.strictEqual(isTargetJob('市场部实习生'), false, '市场');
});

test('boss-batch 正则兼容 Node JSON.stringify 无空格格式（2026-09-20 links=0 事故回归）', () => {
  const snap = { data: { url: 'https://www.zhipin.com/web/geek/jobs?query=x', tree: [
    { role: 'link', name: '前端开发实习生', ref: '@e10' },
    { role: 'link', name: '立即沟通', ref: '@e54' },
    { role: 'link', name: '游戏UI设计师实习', ref: '@e11' }
  ] } };
  const s = JSON.stringify(snap);
  const links = [];
  let m;
  while ((m = RE_LINK.exec(s)) !== null) links.push({ title: m[1], ref: m[2] });
  assert.strictEqual(links.length, 3, '应提取 3 个链接');
  assert.strictEqual(links[0].title, '前端开发实习生');
  const btn = new RegExp('"name":\\s*"立即沟通",\\s*"ref":\\s*"(@e\\d+)"').exec(s);
  assert.ok(btn, 'findRef 应命中立即沟通按钮');
  assert.strictEqual(btn[1], '@e54');
});
