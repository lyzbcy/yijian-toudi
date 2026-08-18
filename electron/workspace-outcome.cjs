function manualApplicationOutcome(action, jobId) {
  if (action === 'finish') {
    return {
      id: jobId,
      status: 'manual-completed-unverified',
      taskStatus: 'done',
      toastType: 'warn',
      message: '已结束官网手动投递页面；软件未验证投递是否成功，岗位继续保留在购物车'
    };
  }
  return {
    id: jobId,
    status: 'cancelled',
    taskStatus: 'error',
    toastType: 'error',
    message: '已取消官网手动投递，岗位仍保留在购物车'
  };
}

module.exports = { manualApplicationOutcome };
