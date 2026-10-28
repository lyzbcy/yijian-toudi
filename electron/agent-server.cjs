const http = require('node:http');
const { URL } = require('node:url');
const {
  commandFingerprint,
  createAuditEntry,
  normalizeIdempotencyKey
} = require('./agent-command.cjs');
const { redactResume } = require('./redact.cjs');
const { storageDiagnostics } = require('./storage-diagnostics.cjs');

// HTTP Fetch bad ports: https://fetch.spec.whatwg.org/#port-blocking
const BAD_PORTS=new Set([0,1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
class AgentServer {
  constructor({ store, onCommand, bossControl, workspaceDiagnostics,resumeBatchControl, careerRefresh, onStateChange }) {
    this.onStateChange = onStateChange;
    this.careerRefresh = careerRefresh;
    this.resumeBatchControl=resumeBatchControl;
    this.workspaceDiagnostics=workspaceDiagnostics;
    this.store = store;
    this.onCommand = onCommand;
    // bossControl（可选）：{ start(request), stop(), status(), accounts() }——Boss 批量投递控制面
    this.bossControl = bossControl || null;
    this.server = null;
    this.port = null;
    this.stopping = null;
    this.connections = new Set();
  }

  async start(port=0) {
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    if (this.server) return this.port;
    if(!Number.isInteger(port)||port<0||port>65535||(port!==0&&BAD_PORTS.has(port)))throw Error('Agent API port is invalid or blocked by HTTP Fetch');
    const server = http.createServer((request, response) => this.handle(request, response));
    const connections = new Set();
    this.connections = connections;
    server.on('connection', (socket) => {
      connections.add(socket);
      socket.once('close', () => connections.delete(socket));
    });
    this.server = server;
    this.starting = new Promise((resolve, reject) => {
      const failed = (error) => { this.server = null; reject(error); };
      server.once('error', failed);
      let attempts=0;
      const listen=()=>{attempts++;
        try{server.listen(port,'127.0.0.1',()=>{
          const selected=server.address().port;
          if(BAD_PORTS.has(selected)){
            server.close(error=>{if(error)return failed(error);if(attempts>=16)return failed(Error('Agent API usable port allocation exhausted'));listen();});
            return;
          }
          server.off('error',failed);this.port=selected;resolve(selected);
        });}catch(error){failed(error);}
      };
      listen();
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async stop() {
    if (this.stopping) return this.stopping;
    const stopping = (async () => {
      if (this.starting) await this.starting.catch(() => {});
      const server = this.server;
      if (!server) return;
      const connections = this.connections;
      await new Promise((resolve) => {
        // Drain accepted work, but an unfinished local client must not hold the
        // profile lock or prevent Windows from quitting indefinitely.
        const timer = setTimeout(() => {
          for (const socket of connections) socket.destroy();
          server.closeAllConnections?.();
        }, 2000);
        server.close(() => { clearTimeout(timer); resolve(); });
        server.closeIdleConnections?.();
      });
      if (this.server === server) {
        this.server = null;
        this.port = null;
      }
    })();
    this.stopping = stopping;
    try { await stopping; }
    finally { if (this.stopping === stopping) this.stopping = null; }
  }

  assertAccepting(request) {
    // Recheck after await: shutdown may start after readJson resolves but
    // before its caller resumes. A restarted listener is a new generation.
    if (this.stopping || !this.server || !this.connections.has(request.socket)) {
      throw Object.assign(new Error('Agent API stopping'), { code: 'AGENT_API_STOPPING' });
    }
  }

  async handle(request, response) {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') return this.send(response, 204, null);

    const state = this.store.get();
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token !== state.settings.apiToken) {
      return this.send(response, 401, { error: 'unauthorized', message: '请使用应用内显示的 Agent Token' });
    }

    const url = new URL(request.url, `http://127.0.0.1:${this.port}`);
    if (this.stopping) return this.send(response, 503, { error: 'agent_api_stopping' });
    try {
      if (request.method === 'GET' && url.pathname === '/v1/job-sources') {
        return this.send(response, 200, { sources: state.jobSources || {},
          existingCompanySources: state.companies.filter(c => c.capabilities?.jobs === 'verified').map(c => ({ id: c.id, name: c.name })),
          zhilianCampus: { mode: 'browser-agent-assisted', readsVisiblePage: true, submission: 'typed-agent-receipt', autoSubmit: false },
          offerbiu: { mode: 'observed-page-import', writesToSource: false, autoFetchAll: false } });
      }
      if (request.method === 'POST' && url.pathname === '/v1/job-sources/offerbiu/import') {
        const body = await this.readJson(request);
        this.assertAccepting(request);
        if (body?.dryRun !== undefined && typeof body.dryRun !== 'boolean') return this.send(response, 400, { error: 'invalid-dryRun' });
        const { importOfferBiu } = require('./job-sources.cjs');
        let report;
        if (body?.dryRun === true) report = importOfferBiu(structuredClone(this.store.get()), body);
        else {
          this.store.update(next => { report = importOfferBiu(next, body); return next; });
          this.notifyState();
        }
        return this.send(response, 200, { ...report, dryRun: body?.dryRun === true });
      }
      if (request.method === 'POST' && url.pathname === '/v1/job-sources/zhilian-campus/import') {
        const body = await this.readJson(request); this.assertAccepting(request);
        if(body?.dryRun !== undefined && typeof body.dryRun !== 'boolean') return this.send(response,400,{error:'invalid-dryRun'});
        const {importCampus}=require('./zhilian-campus.cjs'); let report;
        if(body.dryRun===true)report=importCampus(structuredClone(this.store.get()),body);
        else {this.store.update(next=>{report=importCampus(next,body);return next;});this.notifyState();}
        return this.send(response,200,{...report,dryRun:body.dryRun===true});
      }
      if (request.method === 'POST' && url.pathname === '/v1/applications/zhilian-campus/read') {
        const body=await this.readJson(request);this.assertAccepting(request);
        if(body?.open!==undefined && typeof body.open!=='boolean')return this.send(response,400,{error:'invalid-campus-open'});
        const result=await require('./zhilian-campus.cjs').campusBrowser.read({open:body?.open===true,tabId:body?.tabId});this.assertAccepting(request);
        return this.send(response,200,result);
      }
      if (request.method === 'POST' && url.pathname === '/v1/applications/zhilian-campus/inspect') {
        const body=await this.readJson(request);this.assertAccepting(request);
        return this.send(response,200,require('./zhilian-campus.cjs').inspectCampus(body));
      }
      if (request.method === 'POST' && url.pathname === '/v1/applications/iguopin/inspect') {
        const body = await this.readJson(request);
        this.assertAccepting(request);
        return this.send(response, 200, require('./iguopin-flow.cjs').inspectGuopin(body));
      }
      if (request.method === 'GET' && url.pathname === '/v1/applications') {
        const report = require('./agent-applications.cjs').read(state, {
          accountId: url.searchParams.get('accountId'), profileId: url.searchParams.get('profileId')
        });
        return this.send(response, 200, report);
      }
      if (request.method === 'POST' && url.pathname === '/v1/applications') {
        const body = await this.readJson(request);
        this.assertAccepting(request);
        let key;
        try { key = normalizeIdempotencyKey(request.headers['idempotency-key']); }
        catch { return this.send(response, 400, { error: 'invalid-idempotency-key' }); }
        let item;
        this.store.update(next => {
          item = require('./agent-applications.cjs').mutate(next, body, key);
          return next;
        });
        this.notifyState();
        return this.send(response, 200, { item });
      }
      if(request.method==='POST'&&url.pathname==='/v1/career/mail-match'){
        const body=await this.readJson(request);this.assertAccepting(request);
        const q=require('./mail-accounts.cjs').scope(this.store.get());
        if(!body||body.accountId!==q.accountId||body.profileId!==q.profileId)return this.send(response,409,{error:'career-scope-mismatch'});
        let report;this.store.update(s=>{report=require('./career-tracker.cjs').confirmMailMatch(s,body);return s;});this.notifyState();return this.send(response,200,{ok:true,report});
      }
      if(request.method==='POST'&&url.pathname==='/v1/career/refresh'){
        const body=await this.readJson(request);this.assertAccepting(request);
        if(!body||body.confirmRead!==true||typeof body.accountId!=='string'||typeof body.profileId!=='string'||(body.reconnect!==undefined&&typeof body.reconnect!=='boolean'))return this.send(response,400,{error:'invalid-career-refresh-request'});
        if(!this.careerRefresh)return this.send(response,501,{error:'career-refresh-unavailable'});
        const result=await this.careerRefresh(body);this.assertAccepting(request);return this.send(response,200,result);
      }
      if (request.method === 'GET' && url.pathname === '/v1/skill') {
        const version = require('../package.json').version;
        return this.send(response, 200, { version, instructions: require('../src/agent-guide.js').instructions(version) });
      }
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        return this.send(response, 200, {
          ok: true,
          version: require('../package.json').version,
          mode: state.settings.dataMode,
          counts: { jobs: state.jobs.length, messages: state.messages.length, tasks: state.tasks.length }
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/diagnostics/storage') {
        return this.send(response, 200, {
          ok: true,
          version: require('../package.json').version,
          storage: storageDiagnostics(this.store)
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/diagnostics/workspaces') {
        if(typeof this.workspaceDiagnostics!=='function')return this.send(response,501,{error:'workspace-diagnostics-unavailable'});
        try{return this.send(response,200,{ok:true,version:require('../package.json').version,diagnostics:await this.workspaceDiagnostics()});}
        catch{return this.send(response,503,{error:'workspace-diagnostics-unavailable'});}
      }
      if(request.method==='GET'&&url.pathname==='/v1/resume/batch'){
        if(!this.resumeBatchControl)return this.send(response,501,{error:'resume-batch-unavailable'});
        return this.send(response,200,{ok:true,catalog:await this.resumeBatchControl.catalog()});
      }
      if(request.method==='POST'&&url.pathname==='/v1/resume/batch/action'){
        if(!this.resumeBatchControl)return this.send(response,501,{error:'resume-batch-unavailable'});
        const body=await this.readJson(request);
        this.assertAccepting(request);
        if(!body||!['query-widget','continue','retry-widget','verify-saved','query-saved'].includes(body.action)||typeof body.id!=='string'||!/^[a-z][a-z0-9_-]{0,40}:[a-z-]{1,40}$/.test(body.id))return this.send(response,400,{error:'invalid-resume-batch-action'});
        return this.send(response,200,{ok:true,batch:await this.resumeBatchControl.action({action:body.action,id:body.id})});
      }
      if (request.method === 'GET' && url.pathname === '/v1/jobs') {
        const favoritesOnly = url.searchParams.get('favorite') === 'true';
        const jobs = favoritesOnly ? state.jobs.filter((job) => job.favorite) : state.jobs;
        return this.send(response, 200, { jobs, companies: state.companies });
      }
      if (request.method === 'GET' && url.pathname === '/v1/resume') {
        return this.send(response, 200, { resume: redactResume(state.resume), redacted: true });
      }
      if (request.method === 'GET' && url.pathname === '/v1/messages') {
        return this.send(response, 200, { messages: state.messages });
      }
      if (request.method === 'GET' && url.pathname === '/v1/tasks') {
        return this.send(response, 200, { tasks: state.tasks });
      }
      // ==== Boss 批量投递控制面（skill boss-daitou 的标准入口）====
      if (url.pathname.startsWith('/v1/boss/')) {
        if (!this.bossControl) {
          return this.send(response, 501, { error: 'boss_control_disabled', message: '批量投递控制面未启用' });
        }
        if (request.method === 'GET' && url.pathname === '/v1/boss/batch/status') {
          return this.send(response, 200, await this.bossControl.status());
        }
        if (request.method === 'POST' && url.pathname === '/v1/boss/batch/start') {
          const body = await this.readJson(request);
          this.assertAccepting(request);
          return this.send(response, 200, await this.bossControl.start(body || {}));
        }
        if (request.method === 'POST' && url.pathname === '/v1/boss/batch/stop') {
          return this.send(response, 200, await this.bossControl.stop());
        }
        if (request.method === 'POST' && url.pathname === '/v1/boss/batch/resolve') {
          const body = await this.readJson(request);
          this.assertAccepting(request);
          return this.send(response, 200, await this.bossControl.resolve(body || {}));
        }
        if (request.method === 'GET' && url.pathname === '/v1/boss/accounts') {
          return this.send(response, 200, await this.bossControl.accounts());
        }
        if (request.method === 'POST' && url.pathname === '/v1/boss/accounts/create') {
          const body = await this.readJson(request);
          this.assertAccepting(request);
          return this.send(response, 200, await this.bossControl.createAccount(body || {}));
        }
        if (request.method === 'POST' && url.pathname === '/v1/boss/accounts/select') {
          const body = await this.readJson(request);
          this.assertAccepting(request);
          return this.send(response, 200, await this.bossControl.selectAccount(body || {}));
        }
        if (request.method === 'POST' && url.pathname === '/v1/boss/accounts/launch') {
          const body = await this.readJson(request);
          this.assertAccepting(request);
          return this.send(response, 200, await this.bossControl.launchAccount(body || {}));
        }
        if (request.method === 'POST' && url.pathname === '/v1/boss/accounts/close') {
          const body = await this.readJson(request);
          this.assertAccepting(request);
          return this.send(response, 200, await this.bossControl.closeAccount(body || {}));
        }
        if (request.method === 'POST' && url.pathname === '/v1/boss/accounts/verify') {
          const body = await this.readJson(request);
          this.assertAccepting(request);
          return this.send(response, 200, await this.bossControl.verifyAccount(body || {}));
        }
        return this.send(response, 404, { error: 'not_found', message: '未知的 /v1/boss/* 路径' });
      }
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        const body = await this.readJson(request);
          this.assertAccepting(request);
        const interactiveOnly = new Set(['apply_cart', 'fill_resume', 'fill_all', 'inspect_resume', 'sync_email']);
        if (interactiveOnly.has(body.action)) {
          return this.send(response, 409, {
            error: 'interactive_confirmation_required',
            message: '该操作会打开官网、写入网页或读取邮箱，请在一键投递应用界面由用户本人发起'
          });
        }
        const allowed = [
          // 只读 / 查询
          'refresh_jobs', 'open_company', 'favorite_job', 'export_snapshot', 'search_jobs',
          // 本地数据写入（开放：AI 可自由读写，立即生效，无需用户确认）
          'update_resume', 'manage_profile', 'batch_cart',
          // Agent 仅管理本地数据；外部网页/邮箱动作必须回到应用界面由用户发起。
        ];
        if (!allowed.includes(body.action)) {
          return this.send(response, 400, { error: 'unsupported_action', allowed });
        }
        const idempotencyKey = normalizeIdempotencyKey(
          request.headers['idempotency-key']
        );
        if (!idempotencyKey) {
          return this.send(response, 428, {
            error: 'idempotency_key_required',
            message: '写命令必须提供 Idempotency-Key'
          });
        }

        const fingerprint = commandFingerprint(body);
        const latestState = this.store.get();
        const cached = latestState.idempotency?.[idempotencyKey];
        if (cached) {
          if (cached.fingerprint !== fingerprint) {
            return this.send(response, 409, {
              error: 'idempotency_key_conflict',
              message: '同一个 Idempotency-Key 不能用于不同命令'
            });
          }
          if (cached.status === 'pending') {
            return this.send(response, 409, {
              error: 'request_in_progress',
              message: '相同命令仍在执行中'
            });
          }
          return this.send(response, cached.httpStatus, cached.response);
        }

        const target = body.companyId || body.jobId || body.action;
        this.store.update((next) => {
          next.idempotency[idempotencyKey] = {
            fingerprint,
            status: 'pending',
            createdAt: new Date().toISOString()
          };
          next.audit.unshift(createAuditEntry({
            action: body.action,
            source: 'agent-api',
            target,
            status: 'accepted',
            message: '命令已接收'
          }));
          next.audit = next.audit.slice(0, 200);
          return next;
        });

        try {
          const result = await this.onCommand(body);
          const payload = {
            accepted: true,
            requiresReview: result?.status === 'review-required' ||
              result?.status === 'login-required' ||
              result?.status === 'manual-required',
            result
          };
          this.store.update((next) => {
            next.idempotency[idempotencyKey] = {
              ...next.idempotency[idempotencyKey],
              status: 'completed',
              finishedAt: new Date().toISOString(),
              httpStatus: 202,
              response: payload
            };
            next.audit.unshift(createAuditEntry({
              action: body.action,
              source: 'agent-api',
              target,
              status: result?.status || 'done',
              message: result?.message || '命令执行完成'
            }));
            next.audit = next.audit.slice(0, 200);
            trimIdempotency(next.idempotency);
            return next;
          });
          return this.send(response, 202, payload);
        } catch (error) {
          const payload = {
            error: 'command_failed',
            message: error.message
          };
          this.store.update((next) => {
            next.idempotency[idempotencyKey] = {
              ...next.idempotency[idempotencyKey],
              status: 'failed',
              finishedAt: new Date().toISOString(),
              httpStatus: 500,
              response: payload
            };
            next.audit.unshift(createAuditEntry({
              action: body.action,
              source: 'agent-api',
              target,
              status: 'failed',
              message: error.message
            }));
            next.audit = next.audit.slice(0, 200);
            trimIdempotency(next.idempotency);
            return next;
          });
          return this.send(response, 500, payload);
        }
      }
      return this.send(response, 404, { error: 'not_found' });
    } catch (error) {
      if (error.code === 'AGENT_API_STOPPING') {
        return this.send(response, 503, { error: 'agent_api_stopping' });
      }
      if ([400, 404, 409].includes(error.status)) return this.send(response, error.status, { error: error.message });
      return this.send(response, 500, { error: 'internal_error', message: error.message });
    }
  }

  notifyState() {
    // A closed renderer must not change an already-persisted write into a retry.
    try { this.onStateChange?.(); } catch { /* persistent result remains valid */ }
  }

  readJson(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > 256 * 1024) {
          reject(new Error('请求体过大'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (this.stopping) {
          return reject(Object.assign(new Error('Agent API stopping'), { code: 'AGENT_API_STOPPING' }));
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
          reject(new Error('JSON 格式不正确'));
        }
      });
      request.on('error', reject);
    });
  }

  send(response, status, payload) {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(payload === null ? '' : JSON.stringify(payload));
  }
}

function trimIdempotency(records, limit = 200) {
  const entries = Object.entries(records || {});
  if (entries.length <= limit) return;
  entries
    .sort((left, right) =>
      String(right[1].createdAt || '').localeCompare(String(left[1].createdAt || ''))
    )
    .slice(limit)
    .forEach(([key]) => delete records[key]);
}

module.exports = { AgentServer };
