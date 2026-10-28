'use strict';

const PROCESS_TASK_TYPES = new Set(['jobs', 'browser', 'email', 'system']);

// Only call once, after the new process owns the profile and has loaded its state.
// A persisted task is history, not a surviving request/window or a submission receipt.
function recoverInterruptedTasks(state, { at = new Date().toISOString() } = {}) {
  if (!state || !Array.isArray(state.tasks)) return 0;
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new Error('task-recovery-invalid-time');
  let count = 0;
  for (const task of state.tasks) {
    if (!task || typeof task !== 'object' || !PROCESS_TASK_TYPES.has(task.type)) continue;
    const lostRunningOperation = task.status === 'running';
    const lostBrowserReview = task.type === 'browser' && task.status === 'waiting';
    if (!lostRunningOperation && !lostBrowserReview) continue;
    const previousStatus = task.status;
    task.status = 'interrupted';
    task.interruptedAt = at;
    task.runtimeRecovery = {
      previousStatus,
      reason: 'previous-process-ended',
      detectedAt: at,
      resumedAutomatically: false
    };
    count++;
  }
  return count;
}

module.exports = { recoverInterruptedTasks };
