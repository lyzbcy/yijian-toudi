const STATUS_LABELS = {
  queued: '等待处理',
  'login-required': '需登录',
  'review-required': '待确认',
  submitted: '已投递',
  'manual-required': '需手动完成',
  failed: '失败',
  cancelled: '已取消'
};

function settleCart({ cart = [], applied = [], results = [], today }) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const nextCart = [];
  const nextApplied = [...applied];

  for (const job of cart) {
    const result = byId.get(job.id) || {
      status: 'failed',
      message: '没有执行结果'
    };
    const snapshot = {
      ...job,
      applyStatus: STATUS_LABELS[result.status] || result.status,
      applyMessage: result.message || ''
    };

    if (result.status === 'submitted') {
      if (!nextApplied.some((item) => item.id === job.id)) {
        nextApplied.unshift({ ...snapshot, appliedAt: today });
      }
    } else {
      nextCart.push(snapshot);
    }
  }

  return { cart: nextCart, applied: nextApplied };
}

module.exports = { STATUS_LABELS, settleCart };
