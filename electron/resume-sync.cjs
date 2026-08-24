const PAUSE_STATUSES = new Set(['review-required', 'login-required', 'manual-required']);
const VERIFIED_STATUSES = new Set(['verified', 'saved']);
const NEEDS_USER_STATUSES = new Set(['review-required', 'login-required', 'manual-required']);
const KNOWN_STATUSES = new Set([...VERIFIED_STATUSES, ...NEEDS_USER_STATUSES, 'failed']);

class ResumeSyncSession {
  constructor(companyIds = []) {
    this.companyIds = [...companyIds];
    this.resultsByCompany = new Map();
    this.pending = null;
    this.cursor = this.companyIds[0] || null;
    this.completed = this.companyIds.length === 0;
  }

  startCompanyId() { return this.completed ? null : this.cursor; }
  pendingStatus(companyId) { return this.pending?.companyId === companyId ? this.pending.status : null; }
  hasPending(companyId) { return Boolean(this.pending && this.pending.companyId === companyId); }

  acceptStage(stage = {}) {
    for (const entry of stage.results || []) this.resultsByCompany.set(entry.companyId, entry);
    this.pending = stage.currentCompanyId ? {
      companyId: stage.currentCompanyId,
      nextCompanyId: stage.nextCompanyId || null,
      status: stage.status,
      atEnd: Boolean(stage.atEnd)
    } : null;
    if (stage.completed) {
      this.completed = true;
      this.cursor = null;
    }
    return this.snapshot();
  }

  finish(companyId) {
    if (!this.pending || this.pending.companyId !== companyId) return this.snapshot();
    if (this.pending.status === 'login-required') {
      this.cursor = companyId;
    } else if (this.pending.atEnd) {
      this.cursor = null;
      this.completed = true;
    } else {
      this.cursor = this.pending.nextCompanyId;
    }
    this.pending = null;
    return this.snapshot();
  }

  cancel(companyId) {
    if (!this.pending || this.pending.companyId !== companyId) return this.snapshot();
    this.cursor = companyId;
    this.pending = null;
    this.completed = false;
    return this.snapshot();
  }

  snapshot() {
    return {
      completed: this.completed,
      continueCompanyId: this.completed ? null : this.cursor,
      currentCompanyId: this.pending?.companyId || null,
      results: [...this.resultsByCompany.values()],
      summary: summarizeResumeSync([...this.resultsByCompany.values()])
    };
  }
}

function expandResumeSyncTargets(companies, recruitType = 'social') {
  const tracks = recruitType === 'all' ? ['social', 'campus'] : [recruitType];
  return companies.flatMap((company) => tracks.map((resumeRecruitType) => ({
    ...company,
    companyId: company.id,
    syncTargetId: `${company.id}:${resumeRecruitType}`,
    resumeRecruitType
  })));
}

function summarizeResumeSync(results) {
  return {
    totalPlatforms: results.length,
    verifiedPlatforms: results.filter((item) => VERIFIED_STATUSES.has(item.status)).length,
    needsUserPlatforms: results.filter((item) => NEEDS_USER_STATUSES.has(item.status)).length,
    failedPlatforms: results.filter((item) => item.status === 'failed').length
  };
}

function createResumeSyncExecutionQueue() {
  let tail = Promise.resolve();
  return {
    run(operation) {
      const execution = tail.catch(() => {}).then(operation);
      tail = execution.catch(() => {});
      return execution;
    },
    waitForIdle() { return tail; }
  };
}

function isResumeSyncGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isWorkspaceGenerationStale(activeGeneration, requestedGeneration) {
  return isResumeSyncGeneration(activeGeneration) && activeGeneration !== requestedGeneration;
}

function createResumeSyncGenerationRegistry({ limit = 64 } = {}) {
  const maxCancelled = Math.max(1, Number.isSafeInteger(limit) ? limit : 64);
  const activeCounts = new Map();
  const cancelled = new Set();

  const prune = () => {
    while (cancelled.size > maxCancelled) {
      const removable = [...cancelled].find((generation) => !activeCounts.has(generation));
      if (removable === undefined) break;
      cancelled.delete(removable);
    }
  };

  return {
    start(generation) {
      if (!isResumeSyncGeneration(generation)) return;
      activeCounts.set(generation, (activeCounts.get(generation) || 0) + 1);
    },
    cancel(generation) {
      if (!isResumeSyncGeneration(generation)) return;
      cancelled.add(generation);
      prune();
    },
    finish(generation) {
      if (!isResumeSyncGeneration(generation)) return;
      const count = activeCounts.get(generation) || 0;
      if (count > 1) activeCounts.set(generation, count - 1);
      else {
        activeCounts.delete(generation);
        cancelled.delete(generation);
      }
      prune();
    },
    isCancelled(generation) {
      return isResumeSyncGeneration(generation) && cancelled.has(generation);
    },
    cancelledSize() { return cancelled.size; }
  };
}

function createResumeSyncStageWorkspace(workspace, syncTargetId, recruitType) {
  if (!workspace) return workspace;
  return {
    ...workspace,
    openWorkspace: (options = {}) => workspace.openWorkspace({
      ...options,
      context: {
        ...(options.context || {}),
        syncTargetId,
        recruitType
      }
    })
  };
}

async function runResumeSync({
  resume,
  attachmentPath = null,
  companies,
  getAdapter,
  recruitType = 'social',
  workspace,
  startCompanyId,
  pauseOnReview = true,
  onCompanyStart,
  onStep,
  shouldAbort
}) {
  const targetIdentity = (item) => item.syncTargetId || item.id;
  const startIndex = startCompanyId
    ? Math.max(0, companies.findIndex((item) => targetIdentity(item) === startCompanyId))
    : 0;
  const queue = companies.slice(startIndex);
  const results = [];
  const cancelledResult = async () => {
    await workspace?.closeWorkspaceIfOpen?.().catch?.(() => {});
    return {
      ok: false,
      status: 'cancelled',
      message: '已取消本轮简历同步',
      results,
      currentCompanyId: null,
      nextCompanyId: null,
      continueCompanyId: null,
      completed: false,
      atEnd: false,
      summary: summarizeResumeSync(results)
    };
  };

  for (let index = 0; index < queue.length; index += 1) {
    if (shouldAbort?.()) return cancelledResult();
    const company = queue[index];
    const companyId = company.companyId || company.id;
    const targetId = company.syncTargetId || company.id;
    const targetRecruitType = company.resumeRecruitType || recruitType;
    const adapter = getAdapter(companyId);
    if (!adapter?.fillResume) {
      results.push({ companyId: targetId, sourceCompanyId: companyId, companyName: company.name, recruitType: targetRecruitType, ok: false, status: 'failed', message: '平台适配器未实现简历更新' });
      continue;
    }
    const taskId = onCompanyStart?.(company);
    const stageWorkspace = createResumeSyncStageWorkspace(workspace, targetId, targetRecruitType);
    let result;
    try {
      result = await adapter.fillResume(resume, {
        workspace: stageWorkspace,
        company,
        recruitType: targetRecruitType,
        syncTargetId: targetId,
        attachmentPath,
        taskId,
        onStep: (info) => onStep?.({ ...info, syncTargetId: targetId, companyId })
      });
    } catch (error) {
      if (shouldAbort?.()) return cancelledResult();
      if (error.code !== 'WORKSPACE_ACTIVE') await workspace?.closeWorkspaceIfOpen?.().catch?.(() => {});
      result = { ok: false, status: 'failed', message: error.message };
    }
    if (shouldAbort?.()) return cancelledResult();
    if (!KNOWN_STATUSES.has(result?.status)) {
      result = { ok: false, status: 'failed', message: '平台适配器未返回可验证的同步状态' };
    }
    const entry = { companyId: targetId, sourceCompanyId: companyId, companyName: company.name, recruitType: targetRecruitType, ...result };
    results.push(entry);

    if (pauseOnReview && PAUSE_STATUSES.has(entry.status)) {
      const nextCompanyId = queue[index + 1] ? targetIdentity(queue[index + 1]) : null;
      const continueCompanyId = entry.status === 'login-required' ? targetId : nextCompanyId;
      return {
        ok: false,
        status: entry.status,
        message: entry.message || `${company.name}需要你处理后继续`,
        partial: results,
        results,
        nextCompanyId,
        continueCompanyId,
        currentCompanyId: targetId,
        completed: false,
        atEnd: !nextCompanyId,
        summary: summarizeResumeSync(results)
      };
    }
  }

  const summary = summarizeResumeSync(results);
  return {
    ok: results.length > 0 && summary.failedPlatforms === 0 && summary.needsUserPlatforms === 0,
    status: summary.failedPlatforms ? 'failed' : (summary.needsUserPlatforms ? 'needs-user' : 'verified'),
    message: `已核验更新 ${summary.verifiedPlatforms}/${summary.totalPlatforms} 个平台`,
    results,
    summary,
    currentCompanyId: null,
    nextCompanyId: null,
    continueCompanyId: null,
    completed: true,
    atEnd: true
  };
}

module.exports = {
  runResumeSync,
  summarizeResumeSync,
  ResumeSyncSession,
  expandResumeSyncTargets,
  createResumeSyncExecutionQueue,
  isWorkspaceGenerationStale,
  createResumeSyncGenerationRegistry
};
