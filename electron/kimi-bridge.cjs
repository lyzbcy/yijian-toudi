// Kimi WebBridge 控制层（2026-09-20 新增，协议由 2026-09-19 深夜逆向+实测确立，见技术方案 §9.2）
// 架构：本模块在本机起 WebSocket 服务端（默认 10086），用户浏览器里的 Kimi 扩展主动连接；
// 指令走 {type:'tool_call', requestId, payload:{name,args}}，回包 {type:'tool_result', responseToRequestId, payload}。
// MV3 扩展会休眠断连：sendTool 内置等待重连重试。
const { WebSocketServer } = require('ws');

const PROTOCOL_PORT_DEFAULT = 10086;
const PING_INTERVAL_MS = 10000;

class KimiBridge {
  constructor({ port = PROTOCOL_PORT_DEFAULT, log } = {}) {
    this.port = port;
    this.log = log || (() => {});
    this.wss = null;
    this.activeSocket = null;
    this.pending = new Map(); // requestId -> {resolve, reject, timer}
    this.listeners = { connected: [], disconnected: [] };
    this.reqSeq = 0;
    // 账号登记（2026-09-22，代投商业化）：串行单活跃连接模型下，
    // 记录"当前连接服务哪个账号"。身份由 main.cjs 的手机号探测闭环确认，不在协议层。
    this.boundAccountId = null;
  }

  // 绑定/解绑当前活跃连接的账号身份（探测确认后调用；断线不清除，等重连后重新确认）
  bindAccount(accountId) {
    this.boundAccountId = accountId || null;
    this.log(`kimi-bridge bound account: ${this.boundAccountId || '(cleared)'}`);
  }

  getBoundAccount() {
    return this.boundAccountId;
  }

  on(event, fn) {
    if (this.listeners[event]) this.listeners[event].push(fn);
  }

  emit(event, arg) {
    for (const fn of this.listeners[event] || []) {
      try { fn(arg); } catch (err) { this.log(`listener error: ${err.message}`); }
    }
  }

  isUp() {
    return Boolean(this.activeSocket && this.activeSocket.readyState === 1);
  }

  async start() {
    if (this.wss) return { started: false, reason: 'already-running' };
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' }, () => {
        this.port = this.wss.address().port; // port=0 时记录系统分配的实际端口（测试用）
        this.log(`kimi-bridge listening ws://127.0.0.1:${this.port}`);
        resolve({ started: true, port: this.port });
      });
      this.wss.on('error', (err) => {
        if (!this._resolvedStart) reject(err);
        this.log(`kimi-bridge server error: ${err.message}`);
      });
      this.wss.on('connection', (ws) => {
        // 半开连接防护：协议层 ping 保活
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        if (this.activeSocket && this.activeSocket !== ws) {
          try { this.activeSocket.terminate(); } catch {}
        }
        this.activeSocket = ws;
        this.log('kimi-bridge extension connected');
        this.emit('connected');
        ws.on('message', (raw) => this.handleMessage(ws, raw));
        ws.on('close', () => {
          if (this.activeSocket === ws) {
            this.activeSocket = null;
            this.log('kimi-bridge extension disconnected');
            this.emit('disconnected');
          }
        });
        ws.on('error', () => {});
      });
      this._keepalive = setInterval(() => {
        if (!this.wss) return;
        for (const client of this.wss.clients) {
          if (client.isAlive === false) { client.terminate(); continue; }
          client.isAlive = false;
          try { client.ping(); } catch {}
        }
      }, PING_INTERVAL_MS);
    });
  }

  stop() {
    if (this._keepalive) { clearInterval(this._keepalive); this._keepalive = null; }
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('bridge stopped'));
    }
    this.pending.clear();
    if (this.wss) {
      for (const client of this.wss.clients) { try { client.terminate(); } catch {} }
      this.wss.close();
      this.wss = null;
    }
    this.activeSocket = null;
    this.log('kimi-bridge stopped');
  }

  handleMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const type = msg && msg.type;
    if (type === 'hello') {
      this.safeSend(ws, { type: 'hello_ack' });
      return;
    }
    if (type === 'ping') {
      this.safeSend(ws, { type: 'pong' });
      return;
    }
    if (type === 'permission_requested') {
      this.safeSend(ws, { type: 'permission_resolved', requestId: msg.requestId, action: 'approve_for_me' });
      return;
    }
    if (type === 'tool_result') {
      const entry = this.pending.get(msg.responseToRequestId);
      if (entry) {
        this.pending.delete(msg.responseToRequestId);
        clearTimeout(entry.timer);
        entry.resolve(msg.payload);
      }
    }
  }

  safeSend(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (err) { this.log(`send failed: ${err.message}`); }
  }

  // 发送指令；断连时等待扩展重连（最多 waitReconnectMs），整体超时 timeoutMs。
  sendTool(name, args = {}, { timeoutMs = 45000, waitReconnectMs = 90000 } = {}) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const attempt = () => {
        if (!this.isUp()) {
          if (Date.now() - startedAt > waitReconnectMs) {
            reject(new Error('kimi-bridge: extension not connected'));
            return;
          }
          setTimeout(attempt, 3000);
          return;
        }
        this.reqSeq += 1;
        const requestId = `req${this.reqSeq}`;
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error(`kimi-bridge: tool ${name} timeout`));
        }, timeoutMs);
        this.pending.set(requestId, { resolve, reject, timer });
        this.log(`tool_call ${name} ${String(args && args.url || args && args.selector || '').slice(0, 60)}`);
        this.safeSend(this.activeSocket, { type: 'tool_call', requestId, payload: { name, args } });
      };
      attempt();
    });
  }

  // 便捷封装（实测过的最小工具集）
  navigate(url, opts) { return this.sendTool('navigate', { url }, opts); }
  snapshot(opts) { return this.sendTool('snapshot', {}, { timeoutMs: 40000, ...opts }); }
  click(selector, opts) { return this.sendTool('click', { selector }, opts); }
  fill(selector, value, opts) { return this.sendTool('fill', { selector, value }, opts); }
}

module.exports = { KimiBridge, PROTOCOL_PORT_DEFAULT };
