const http = require('node:http');
const { URL } = require('node:url');
const {
  commandFingerprint,
  createAuditEntry,
  normalizeIdempotencyKey
} = require('./agent-command.cjs');

class AgentServer {
  constructor({ store, onCommand }) {
    this.store = store;
    this.onCommand = onCommand;
    this.server = null;
    this.port = null;
  }

  async start(port) {
    if (this.server) return this.port;
    this.server = http.createServer((request, response) => this.handle(request, response));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    this.port = null;
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
    try {
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        return this.send(response, 200, {
          ok: true,
          version: require('../package.json').version,
          mode: state.settings.dataMode,
          counts: { jobs: state.jobs.length, messages: state.messages.length, tasks: state.tasks.length }
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/jobs') {
        const favoritesOnly = url.searchParams.get('favorite') === 'true';
        const jobs = favoritesOnly ? state.jobs.filter((job) => job.favorite) : state.jobs;
        return this.send(response, 200, { jobs, companies: state.companies });
      }
      if (request.method === 'GET' && url.pathname === '/v1/resume') {
        return this.send(response, 200, { resume: state.resume });
      }
      if (request.method === 'GET' && url.pathname === '/v1/messages') {
        return this.send(response, 200, { messages: state.messages });
      }
      if (request.method === 'GET' && url.pathname === '/v1/tasks') {
        return this.send(response, 200, { tasks: state.tasks });
      }
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        const body = await this.readJson(request);
        const allowed = [
          // 只读 / 查询
          'refresh_jobs', 'open_company', 'favorite_job', 'export_snapshot', 'search_jobs',
          // 本地数据写入（开放：AI 可自由读写，立即生效，无需用户确认）
          'update_resume', 'manage_profile', 'batch_cart',
          // 外部写入（需用户确认：涉及招聘网站投递/填表/发送）
          'apply_cart', 'fill_resume', 'sync_email'
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
      return this.send(response, 500, { error: 'internal_error', message: error.message });
    }
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
