const { randomUUID } = require('node:crypto');
const { BossBatchRunner } = require('./boss-batch.cjs');

const REVIEW_REASONS = new Set(['access-restricted', 'security-check', 'login-required',
  'search-mismatch', 'send-unverified', 'persist-failed', 'runner-error', 'bridge-unavailable']);
const IN_FLIGHT = new Set(['starting', 'running', 'stopping']);

// A single controller owns the bridge until its promise settles, not until stop() is requested.
// The pre-send journal is persisted before any send click. A crash leaves a review gate, never a retry.
class BossBatchController {
  constructor({ store, getBridge, notify = async () => {}, log = () => {}, onChanged = () => {},
    runnerFactory = (options) => new BossBatchRunner(options) }) {
    Object.assign(this, { store, getBridge, notify, log, onChanged, runnerFactory });
    this.active = null;
    this.fault = null;
    this.done = Promise.resolve();
  }

  signal(message) {
    Promise.resolve().then(() => this.notify(message)).catch(() => this.log('notification-failed'));
    try { this.onChanged(); } catch { /* UI delivery is not a transaction boundary. */ }
  }

  status() {
    const run = this.store.get().bossBatchRun;
    const interrupted = !this.active && IN_FLIGHT.has(run?.phase);
    return {
      running: Boolean(this.active), stopping: Boolean(this.active?.cancelled),
      runId: run?.id || null, accountId: run?.accountId || null,
      phase: interrupted ? 'interrupted' : (run?.phase || 'idle'),
      applied: run?.applied || [], previewed: this.active?.runner?.previewed || run?.previewed || [],
      fails: this.active?.runner?.fails || run?.fails || 0,
      stopReason: this.fault || (interrupted ? 'interrupted' : run?.stopReason) || null,
      requiresReview: Boolean(this.fault || interrupted || run?.requiresReview || (!this.active && run?.pending)),
      pending: run?.pending || null, target: run?.target || 0, dryRun: run?.dryRun || false
    };
  }

  write(id, mutate) {
    return this.store.update((state) => {
      const run = state.bossBatchRun;
      if (run?.id !== id) throw new Error('stale-batch-run');
      mutate(run, state);
      run.updatedAt = new Date().toISOString();
      return state;
    });
  }

  async start(request = {}) {
    if (this.active) return { error: 'already-running' };
    if (this.status().requiresReview) return { error: 'review-required', message: '上次任务需要核对；结果不明岗位不会自动重发。' };
    const target = request.target === undefined ? 30 : request.target;
    if (!Number.isInteger(target) || target < 1) return { error: 'invalid-target' };
    if (request.dryRun !== undefined && typeof request.dryRun !== 'boolean') return { error: 'invalid-dry-run' };
    const state = this.store.get();
    const account = state.accounts?.find((a) => a.id === (request.accountId || state.activeAccountId));
    if (!account) return { error: 'account-not-found' };
    const hardCap = account.id === 'default' ? 120 : 50;
    if (target > hardCap) return { error: 'target-exceeds-limit', hardCap };
    const id = randomUUID();
    const active = { id, cancelled: false, runner: null };
    this.active = active; // Reserve before the first await: IPC and HTTP may start simultaneously.
    try {
      this.store.update((s) => {
        if (s.bossBatchRun) s.bossBatchHistory = [...(s.bossBatchHistory || []), s.bossBatchRun].slice(-50);
        s.bossBatchRun = { id, accountId: account.id, phase: 'starting', startedAt: new Date().toISOString(),
          target, dryRun: Boolean(request.dryRun), applied: [], previewed: [], fails: 0, pending: null,
          stopReason: null, requiresReview: false };
        return s;
      });
      const bridge = await this.getBridge();
      if (!bridge) throw new Error('bridge-unavailable');
      if (active.cancelled) {
        this.write(id, (run) => { run.phase = 'stopped'; run.stopReason = 'user-stop'; });
        this.active = null;
        return { started: false, cancelled: true };
      }
      const runner = this.runnerFactory({ bridge, target, dryRun: Boolean(request.dryRun),
        banCompanies: [...(account.boss?.banCompanies || []), ...(account.boss?.heldCompanies || [])],
        log: this.log, notify: (message) => this.signal(message),
        onBeforeSend: (entry) => this.write(id, (run) => {
          if (active.cancelled) throw new Error('cancelled-before-send');
          run.pending = { ...entry, attemptId: randomUUID(), preparedAt: new Date().toISOString() };
        }),
        onApplied: (entry) => {
          const saved = this.write(id, (run, s) => {
          const acc = s.accounts.find((a) => a.id === account.id);
          if (!acc || !run.pending) throw new Error('missing-send-journal');
          acc.boss ||= {};
          const record = { ...entry, attemptId: run.pending.attemptId, runId: id, date: new Date().toISOString().slice(0, 10) };
          acc.boss.applied = [record, ...(acc.boss.applied || [])].slice(0, 2000);
          acc.boss.banCompanies = [...new Set([...(acc.boss.banCompanies || []), entry.company].filter(Boolean))];
          run.applied.push(record);
          run.pending = null; // Receipt + account ledger + clearing pending commit together.
          });
          const count = saved.bossBatchRun.applied.length;
          if (count % 8 === 0) this.signal(`【一键投递·进度】已确认并落盘 ${count}/${target} 笔。`);
        }
      });
      active.runner = runner;
      this.write(id, (run) => { run.phase = 'running'; });
      this.done = this.execute(active, account.id);
      this.signal(`【一键投递】批量已开始，目标 ${target}，${request.dryRun ? '仅演练' : '正式发送'}。`);
      return { started: true, runId: id, target, dryRun: Boolean(request.dryRun), accountId: account.id };
    } catch (error) {
      try {
        this.write(id, (run) => { run.phase = 'stopped'; run.stopReason = 'bridge-unavailable'; run.requiresReview = true; });
      } catch { this.fault = 'persist-failed'; }
      this.active = null;
      return { error: this.fault || 'bridge-unavailable' };
    }
  }

  async execute(active, accountId) {
    const runner = active.runner; // Never reference a mutable global runner from an old callback.
    let reason;
    try { await runner.run(); reason = runner.stopReason; }
    catch { reason = runner.stopReason || 'runner-error'; }
    try {
      this.write(active.id, (run, state) => {
        run.phase = reason === 'completed' ? 'completed' : 'stopped';
        run.stopReason = reason || 'runner-error';
        run.previewed = runner.previewed;
        run.fails = runner.fails;
        run.finishedAt = new Date().toISOString();
        run.requiresReview = Boolean(run.pending || REVIEW_REASONS.has(run.stopReason));
        const account = state.accounts.find((a) => a.id === accountId);
        if (account) account.lastActiveAt = run.finishedAt;
      });
    } catch { this.fault = 'persist-failed'; }
    finally { if (this.active === active) this.active = null; }
    this.signal(`【一键投递】批量已结束，确认并落盘 ${this.status().applied.length} 笔，停止原因 ${this.status().stopReason}。`);
  }

  stop() {
    const active = this.active;
    if (!active) return { stopping: false };
    active.cancelled = true;
    active.runner?.stop('user-stop');
    try { this.write(active.id, (run) => { run.phase = 'stopping'; }); }
    catch { this.fault = 'persist-failed'; }
    return { stopping: true }; // running remains true until the in-flight work has settled.
  }

  resolve({ runId, action } = {}) {
    if (this.active) return { error: 'already-running' };
    const status = this.status();
    if (runId !== status.runId || !status.requiresReview) return { error: 'stale-review' };
    if (action !== 'acknowledge-and-skip-unknown') return { error: 'explicit-review-required' };
    try {
      this.write(runId, (run, state) => {
        const acc = state.accounts.find((a) => a.id === run.accountId);
        if (!acc) throw new Error('account-not-found');
        acc.boss ||= {};
        if (run.pending?.company) acc.boss.heldCompanies = [...new Set([...(acc.boss.heldCompanies || []), run.pending.company])];
        run.review = { at: new Date().toISOString(), action, skipped: run.pending };
        run.pending = null;
        run.requiresReview = false;
        run.phase = 'reviewed';
      });
      this.fault = null;
      this.signal('上次任务复核已登记；未知结果公司继续跳过，未增加成功计数。');
      return { reviewed: true };
    } catch { this.fault = 'persist-failed'; return { error: 'persist-failed' }; }
  }
}

module.exports = { BossBatchController };
