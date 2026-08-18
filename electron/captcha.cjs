// 验证码只做存在性检测，始终交给用户本人处理。
// 不隐藏自动化特征、不识别缺口、不模拟拖动，避免绕过招聘网站风控。

async function detectTencentCaptcha(workspace) {
  if (!workspace?.run) return { detected: false };
  const script = `(() => {
    const control = document.querySelector('#tcaptcha_drag_thumb, .tc-slider-normal, #tcaptcha_drag_button, iframe[src*="captcha"]');
    if (!control) return { detected: false };
    const rect = control.getBoundingClientRect();
    return { detected: true, btnRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
  })()`;
  try {
    return await workspace.run(script);
  } catch (error) {
    return { detected: false, error: error.message };
  }
}

async function requireManualCaptcha(workspace, { onStep } = {}) {
  const result = await detectTencentCaptcha(workspace);
  if (!result.detected) return { detected: false, manualRequired: false };
  const message = '检测到验证码，请在当前内嵌页面手动完成；软件不会尝试绕过风控';
  onStep?.({ step: 'captcha-manual', message });
  return { ...result, manualRequired: true, message };
}

module.exports = { detectTencentCaptcha, requireManualCaptcha };
