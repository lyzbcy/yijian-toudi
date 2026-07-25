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

function applyResultToCart({
  cart = [],
  applied = [],
  result,
  today
}) {
  if (!result?.id) return { cart: [...cart], applied: [...applied] };
  const job = cart.find((item) => item.id === result.id);
  if (!job) return { cart: [...cart], applied: [...applied] };

  const snapshot = {
    ...job,
    applyStatus: STATUS_LABELS[result.status] || result.status,
    applyMessage: result.message || ''
  };
  if (result.status === 'submitted') {
    return {
      cart: cart.filter((item) => item.id !== result.id),
      applied: applied.some((item) => item.id === result.id)
        ? [...applied]
        : [{ ...snapshot, appliedAt: today }, ...applied]
    };
  }
  return {
    cart: cart.map((item) => item.id === result.id ? snapshot : item),
    applied: [...applied]
  };
}

function isSubmissionSuccess(snapshot) {
  const text = String(snapshot?.text || '');
  if (/提交失败|投递失败|申请失败|未成功/.test(text)) return false;
  return /申请成功|提交成功|投递成功|已成功投递|已投递/.test(text);
}

// 购物车前置检查：①每家公司的投递数量限制（applyRule.maxActive）
// ②每家公司的投递能力（capabilities.apply：unsupported 的不能自动投，manual/degraded 提示需手动）
// 返回 { ok, blockers: [...], warnings: [...] }，blockers 阻止一键投递，warnings 提示但不阻止
function validateCartRules({ cart = [], companies = [] }) {
  const countByCompany = new Map();
  for (const job of cart) {
    countByCompany.set(job.companyId, (countByCompany.get(job.companyId) || 0) + 1);
  }
  const blockers = [];
  const warnings = [];
  for (const company of companies) {
    const count = countByCompany.get(company.id) || 0;
    if (count === 0) continue;
    // 数量限制
    if (company.applyRule?.maxActive && count > company.applyRule.maxActive) {
      blockers.push({
        companyId: company.id,
        type: 'rule-exceeded',
        message: company.applyRule.note || `${company.name} 当前最多处理 ${company.applyRule.maxActive} 个岗位`
      });
    }
    // 投递能力
    const applyCap = company.capabilities?.apply;
    if (applyCap === 'unsupported' || !applyCap) {
      blockers.push({
        companyId: company.id,
        type: 'apply-unsupported',
        message: `${company.name} 暂未支持自动投递，需手动在官网完成`
      });
    } else if (applyCap === 'manual') {
      warnings.push({
        companyId: company.id,
        type: 'apply-manual',
        message: `${company.name} 投递需要你在浏览器工作区确认后手动提交`
      });
    }
  }
  // 兼容旧调用：ok 字段表示是否有 blocker
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    // 旧的 message 字段（取第一个 blocker）保持向后兼容
    message: blockers[0]?.message
  };
}

function taskStatusForAutomation(status) {
  if (status === 'submitted' || status === 'done') return 'done';
  if (status === 'review-required') return 'waiting';
  return 'error';
}

module.exports = {
  STATUS_LABELS,
  settleCart,
  applyResultToCart,
  isSubmissionSuccess,
  validateCartRules,
  taskStatusForAutomation
};
