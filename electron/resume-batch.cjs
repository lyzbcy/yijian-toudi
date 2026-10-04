const crypto = require('node:crypto');

function resumeFingerprint(resume) {
  const { updatedAt, completion, profiles, ...content } = resume || {};
  const stable = value => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
  return crypto.createHash('sha256').update(JSON.stringify(stable(content))).digest('hex');
}

function tileBounds(area, count, index) {
  const columns = count === 6 ? 3 : 2;
  const rows = 2;
  const col = index % columns, row = Math.floor(index / columns);
  const x = Math.floor(col * area.width / columns), y = Math.floor(row * area.height / rows);
  return { x: area.x + x, y: area.y + y,
    width: Math.floor((col + 1) * area.width / columns) - x,
    height: Math.floor((row + 1) * area.height / rows) - y };
}

// A review/login page owns its slot until explicitly closed. Different tracks of
// the same company never run together because they share a persisted login session.
class ResumeBatch {
  constructor({ store, getTargets, getAdapter, createWorkspace, attachmentPath, onChange = () => {} }) {
    Object.assign(this, { store, getTargets, getAdapter, createWorkspace, attachmentPath, onChange });
    this.entries = []; this.slots = new Map(); this.stopped = false; this.stopEpoch = 0;
    // No auto-resume after a process exit. An interrupted attempt is not a save.
    store.update(s => {
      for (const h of Object.values(s.resumeSyncHistory || {})) {
        if (['queued', 'running'].includes(h.status)) h.status = 'interrupted';
      }
      return s;
    });
  }
  isActive() { return this.slots.size > 0 || this.entries.some(e => e.status === 'queued'); }
  snapshot() {
    return { active: this.isActive(), concurrency: this.concurrency || 4,
      entries: this.entries.map(({ target, status, message, lastAttemptAt }) => ({
        id: target.syncTargetId, name: target.name, status, message, lastAttemptAt,
        open: this.slots.has(target.syncTargetId), busy: Boolean(this.slots.get(target.syncTargetId)?.busy)
      })) };
  }
  catalog() {
    const s = this.store.get(), fingerprint = resumeFingerprint(s.resume);
    return { targets: this.getTargets().map(t => ({ id: t.syncTargetId, name: t.name,
      track: t.resumeRecruitType, history: s.resumeSyncHistory?.[t.syncTargetId] || null,
      resumeChanged: (() => { const h = s.resumeSyncHistory?.[t.syncTargetId]; const saved = h?.userConfirmedFingerprint || h?.savedFingerprint || h?.fingerprint; return Boolean(saved && saved !== fingerprint); })()
    })), selected: s.settings.resumeSyncSelection || [], batch: this.snapshot() };
  }
  emit() { this.onChange(this.snapshot()); }
  record(entry) {
    this.store.update(s => {
      s.resumeSyncHistory ||= {};
      const old = s.resumeSyncHistory[entry.target.syncTargetId] || {};
      s.resumeSyncHistory[entry.target.syncTargetId] = { ...old, status: entry.status,
        lastAttemptAt: entry.lastAttemptAt, fingerprint: this.fingerprint,
        profileId: this.resume.activeProfileId || 'default',
        // Field read-back, manual closing and user claims are not server persistence evidence.
        ...(entry.status === 'saved' && entry.saveEvidence ? { lastUpdatedAt: new Date().toISOString(), savedFingerprint: this.fingerprint, saveEvidence: entry.saveEvidence } : {}) };
      return s;
    });
  }
  start({ targetIds, concurrency = 4 } = {}) {
    if (this.isActive()) throw new Error('已有简历批次，请先关闭窗口或停止本轮');
    if (![4, 6].includes(concurrency)) throw new Error('请选择 4 或 6 个并行窗口');
    const targets = this.getTargets();
    if (!Array.isArray(targetIds) || !targetIds.length || targetIds.some(id => !targets.some(t => t.syncTargetId === id))) throw new Error('请至少选择一个有效平台');
    this.resume = structuredClone(this.store.get().resume);
    this.fingerprint = resumeFingerprint(this.resume);
    this.file = this.attachmentPath?.(this.resume) || null;
    this.store.update(s => { s.settings.resumeSyncSelection = [...new Set(targetIds)]; return s; });
    this.concurrency = concurrency; this.stopped = false;
    this.entries = [...new Set(targetIds)].map(id => ({ target: targets.find(t => t.syncTargetId === id), status: 'queued' }));
    this.pump(); return this.snapshot();
  }
  pump() {
    if (this.stopped) return;
    for (const entry of this.entries) {
      if (this.slots.size >= this.concurrency) break;
      if (entry.status !== 'queued') continue;
      if ([...this.slots.values()].some(s => s.entry.target.id === entry.target.id)) continue;
      const used = new Set([...this.slots.values()].map(s => s.index));
      let index = 0; while (used.has(index)) index++;
      const slot = { entry, index, busy: true, closed: false, workspace: null };
      this.slots.set(entry.target.syncTargetId, slot);
      entry.status = 'running'; entry.lastAttemptAt = new Date().toISOString();
      // run catches all failures; retain the slot until its in-flight adapter settles.
      void this.run(slot);
    }
    this.emit();
  }
  async run(slot) {
    const e = slot.entry, t = e.target;
    try {
      this.record(e);
      slot.workspace = await this.createWorkspace(t, slot.index, this.concurrency, () => { void this.close(t.syncTargetId); });
      if (slot.closed || this.stopped) throw new Error('本轮已停止');
      const workspace = { ...slot.workspace };
      for (const key of ['openWorkspace', 'run', 'setInputFiles']) {
        if (!workspace[key]) continue;
        workspace[key] = async (...args) => {
          if (slot.closed || this.stopped) throw new Error('本轮已停止');
          return slot.workspace[key](...args);
        };
      }
      const result = await this.getAdapter(t.id).fillResume(this.resume, {
        workspace, company: t, recruitType: t.resumeRecruitType, syncTargetId: t.syncTargetId,
        attachmentPath: this.file,
        onStep: info => { if (!slot.closed) { e.message = info.message; this.emit(); } }
      });
      if (!slot.closed && !this.stopped) {
        const allowed = ['login-required', 'review-required', 'manual-required', 'failed', 'verified', 'saved'];
        e.status = allowed.includes(result?.status) ? result.status : 'failed';
        e.message = String(result?.message || '请核对官网页面');
        if (e.status === 'saved') {
          if (typeof result.saveEvidence === 'string' && result.saveEvidence.trim()) e.saveEvidence = result.saveEvidence.slice(0, 500);
          else { e.status = 'review-required'; e.message = '尚无官网保存证据，请核对页面'; }
        }
      }
    } catch (error) {
      if (!slot.closed) { e.status = 'failed'; e.message = error.message; }
    } finally {
      slot.busy = false;
      if (slot.closed || this.stopped) e.status = 'cancelled';
      try { this.record(e); } catch (error) { e.status = 'failed'; e.message = `记录写入失败：${error.message}`; }
      if (slot.closed || this.stopped || e.status === 'failed') await this.release(slot);
      this.emit(); this.pump();
    }
  }
  async release(slot) {
    try { await slot.workspace?.dispose?.(); } finally {
      if (this.slots.get(slot.entry.target.syncTargetId) === slot) this.slots.delete(slot.entry.target.syncTargetId);
    }
  }
  async close(id) {
    const slot = this.slots.get(id);
    if (!slot || slot.closed) return;
    slot.closed = true;
    await slot.workspace?.dispose?.();
    if (!slot.busy) { this.slots.delete(id); this.emit(); this.pump(); }
  }
  async retry(id) {
    const entry = this.entries.find(e => e.target.syncTargetId === id);
    if (!entry || this.slots.get(id)?.busy || ['queued', 'retrying'].includes(entry.status)) throw new Error('请等待当前平台填写结束后重试');
    // Hold scheduling while replacing this slot to keep retry deterministic.
    entry.status = 'retrying';
    const epoch = this.stopEpoch;
    const slot = this.slots.get(id);
    if (slot) { slot.closed = true; await this.release(slot); }
    if (epoch !== this.stopEpoch) { entry.status = 'cancelled'; return this.snapshot(); }
    entry.status = 'queued'; entry.message = ''; this.stopped = false;
    this.pump(); return this.snapshot();
  }
  async confirmSaved(id) {
    const slot = this.slots.get(id);
    if (!slot || slot.busy || !['review-required', 'manual-required', 'verified'].includes(slot.entry.status)) throw new Error('请先完成填写和官网保存，再确认');
    this.store.update(s => {
      const h = s.resumeSyncHistory?.[id];
      if (!h) throw new Error('尚无本轮更新记录');
      h.lastUserConfirmedAt = new Date().toISOString();
      h.userConfirmedFingerprint = this.fingerprint;
      h.status = 'user-confirmed';
      return s;
    });
    slot.entry.status = 'user-confirmed';
    await this.close(id);
    return this.snapshot();
  }
  focus(id) { this.slots.get(id)?.workspace?.focus?.(); }
  async stop() {
    this.stopped = true; this.stopEpoch++;
    for (const e of this.entries) if (e.status === 'queued') e.status = 'cancelled';
    await Promise.all([...this.slots.keys()].map(id => this.close(id)));
    this.emit(); return this.snapshot();
  }
}

module.exports = { ResumeBatch, resumeFingerprint, tileBounds };
