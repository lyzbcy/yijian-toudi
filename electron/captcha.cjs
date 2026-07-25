// 腾讯 tcaptcha 滑块验证码处理（design §7 安全降级 + agent.md「内化、节约 token」）。
//
// 设计原则（基于知识库二期实测结论 memory §8.13）：
//   1. Electron 自带 Chromium = 真有头浏览器，UA 天然是正常 Chrome → 腾讯 tcaptcha 多数情况不弹或轻易放行
//   2. 本模块只作为「偶尔弹了」的兜底，不追求 100% 过码
//   3. 试不过就明确返回 login-required，把控制权交还用户（design §7 不绕过风控）
//
// 算法来源：知识库二期 wework-doc-export.mjs 的拟人轨迹（纯数学，确定有用）+
//   wework-doc-captcha.py 的方法4 GRAY_VARIANCE 简化版（边缘投影，JS Canvas 友好）。
//   同事在 QQ 验证码上实测 CCORR/CCOEFF/EDGE 三种模板匹配「未调通」（captcha.py:28-29 注释），
//   故本模块只用最稳健的「缺口区域比周围暗」特征，不移植不稳定的模板匹配。

const STEALTH_SCRIPT = `(() => {
  // 防御性 stealth：Electron 本身已是有头浏览器，这些多数用不上，但兜底隐藏自动化特征
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true }); } catch (e) {}
  try {
    if (window.outerWidth === 0 || window.outerWidth === window.innerWidth) {
      Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth + 16, configurable: true });
    }
    if (window.outerHeight === 0 || window.outerHeight === window.innerHeight) {
      Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 88, configurable: true });
    }
  } catch (e) {}
})()`;

// 在 webContents 的所有 frame（含 iframe）注入 stealth。
// 在 dom-ready 时注入，早于 tcaptcha 脚本检测 navigator.webdriver。
function attachStealth(webContents) {
  if (!webContents || webContents.isDestroyed?.()) return;
  const inject = () => webContents.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
  webContents.on('dom-ready', inject);
  // 已加载的页面也补一次
  inject();
  return () => {
    try { webContents.removeListener('dom-ready', inject); } catch (e) {}
  };
}

// 检测腾讯 tcaptcha 是否出现。tcaptcha 通常在 iframe 里，选择器基于知识库二期 wework-doc-export.mjs:700。
// 返回 { detected, iframeRect, bgRect, blockRect, btnRect } 或 { detected: false }。
async function detectTencentCaptcha(workspace) {
  if (!workspace?.run) return { detected: false };
  const script = `(() => {
    // tcaptcha 的拖动条按钮在顶层文档（不在 iframe）
    const btn = document.querySelector('#tcaptcha_drag_thumb, .tc-slider-normal, #tcaptcha_drag_button');
    if (!btn) return { detected: false };
    // 背景图和拼图块在 tcaptcha 自身的 iframe 里，但跨 frame 访问受限；
    // 这里只检测拖动按钮出现，图片识别在 solveTencentSlider 里通过 canvas 截图绕过 frame 限制。
    const btnRect = btn.getBoundingClientRect();
    return {
      detected: true,
      btnRect: { x: btnRect.x, y: btnRect.y, w: btnRect.width, h: btnRect.height }
    };
  })()`;
  try {
    return await workspace.run(script);
  } catch (e) {
    return { detected: false, error: e.message };
  }
}

// 在页面端通过 canvas 读取 tcaptcha 背景图，按「缺口列像素方差最大」找缺口 X（方法4 GRAY_VARIANCE 简化）。
// 跨 frame 限制：tcaptcha 的 bg 在 iframe 里，直接 DOM 访问受限，但 executeJavaScript 会在
// 页面主上下文执行，无法跨 frame 操作 iframe DOM。所以实际拖动前要先用 capturePage 截图，
// 或在 tcaptcha iframe 的 webContents 上执行。本函数提供一个纯前端实现（在能拿到 img 元素时用）。
const FIND_GAP_SCRIPT = `(() => {
  // 尝试在当前 frame 找 #slideBg（tcaptcha 标准 id）
  const bg = document.querySelector('#slideBg, .tc-bg-img, img[src*="captcha"]');
  if (!bg || !bg.complete || bg.naturalWidth === 0) return { ok: false, reason: 'no-bg-image' };
  const bgRect = bg.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  // 用图片真实像素绘制，提高识别精度
  canvas.width = bg.naturalWidth;
  canvas.height = bg.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bg, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // 转灰度，按列计算方差。缺口区域（被挖空的部分通常颜色偏暗或偏亮）边界处方差大。
  const cols = canvas.width;
  const rows = canvas.height;
  const gray = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  // 按列统计方差，缺口处方差显著
  const colVar = new Float32Array(cols);
  for (let x = 0; x < cols; x++) {
    let sum = 0, sumSq = 0;
    for (let y = 0; y < rows; y++) {
      const v = gray[y * cols + x];
      sum += v; sumSq += v * v;
    }
    const mean = sum / rows;
    colVar[x] = sumSq / rows - mean * mean;
  }
  // 平滑（滑动窗口），窗口宽度约为图片宽的 8%（拼图块宽度比例）
  const win = Math.max(8, Math.floor(cols * 0.08));
  const smoothed = new Float32Array(cols);
  let runSum = 0;
  for (let x = 0; x < cols + win; x++) {
    runSum += colVar[Math.min(x, cols - 1)];
    if (x >= win) runSum -= colVar[x - win];
    if (x >= win - 1) smoothed[x - Math.floor(win / 2)] = runSum / win;
  }
  // 找方差最大的列（跳过最左 5%，那里通常是拼图块初始位置）
  let bestX = Math.floor(cols * 0.2);
  let bestVar = -1;
  for (let x = Math.floor(cols * 0.15); x < cols; x++) {
    if (smoothed[x] > bestVar) { bestVar = smoothed[x]; bestX = x; }
  }
  // 把图片坐标换算回页面坐标（用于拖动距离）
  const scaleX = bgRect.width / cols;
  return {
    ok: true,
    gapCenterXImage: bestX,
    gapCenterXPage: bgRect.x + bestX * scaleX,
    bgRect: { x: bgRect.x, y: bgRect.y, w: bgRect.width, h: bgRect.height },
    confidence: bestVar
  };
})()`;

// 拟人轨迹拖动：把 startElX 的滑块拖到 gapCenterXPage。
// 算法直接移植自知识库二期 wework-doc-export.mjs:648-717（纯数学，已实测有效）。
// 用 webContents 的 mouseInput（Electron 无 page.mouse，但 webContents.sendInputEvent 支持 mouseDown/mouseMove/mouseUp）。
async function humanizedDrag(webContents, { startX, startY, distance }) {
  const { setTimeout: delay } = require('node:timers/promises');
  const send = (type, x, y, button = 'left') => webContents.sendInputEvent({ type, x, y, button });
  const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

  await send('mouseMove', startX, startY);
  await delay(rand(200, 350));
  await send('mouseDown', startX, startY);
  await delay(rand(100, 180));

  const overshoot = 3 + Math.random() * 5;
  const totalDist = distance + overshoot;
  const totalSteps = 35 + Math.floor(Math.random() * 15);
  for (let i = 1; i <= totalSteps; i++) {
    const t = i / totalSteps;
    let x;
    if (t < 0.15) {
      const lt = t / 0.15;
      x = startX + totalDist * 0.15 * lt * lt;
    } else if (t < 0.75) {
      const lt = (t - 0.15) / 0.6;
      x = startX + totalDist * (0.15 + 0.7 * lt);
    } else {
      const lt = (t - 0.75) / 0.25;
      const eased = 1 - Math.pow(1 - lt, 2);
      x = startX + totalDist * (0.85 + 0.15 * eased);
    }
    const yNoise = (Math.random() - 0.5) * 2.5;
    const hasJitter = Math.random() < 0.08;
    const xJitter = hasJitter ? (Math.random() - 0.5) * 1.2 : 0;
    await send('mouseMove', x + xJitter, startY + yNoise);
    let dt;
    if (t < 0.15) dt = rand(25, 45);
    else if (t < 0.75) dt = rand(10, 25);
    else dt = rand(20, 45);
    if (hasJitter) dt += rand(30, 80);
    await delay(dt);
  }

  await delay(rand(40, 70));
  // 过冲修正：回到 finalX
  const finalX = startX + distance;
  const correctionSteps = 4 + Math.floor(Math.random() * 3);
  for (let i = 1; i <= correctionSteps; i++) {
    const t = i / correctionSteps;
    const x = (startX + totalDist) + (finalX - (startX + totalDist)) * t;
    const yNoise = (Math.random() - 0.5) * 0.8;
    await send('mouseMove', x, startY + yNoise);
    await delay(rand(15, 35));
  }
  await send('mouseMove', finalX, startY + (Math.random() - 0.5) * 0.3);
  await delay(rand(80, 140));
  await send('mouseUp', finalX, startY);
  return { dragged: true, distance };
}

// 尝试解腾讯滑块验证码。最多试 maxAttempts 次，每次：找缺口 → 拖动 → 等待验证结果。
// 失败返回 { solved: false }，调用方应降级为 login-required 让用户接管。
async function solveTencentCaptcha(workspace, { maxAttempts = 2, onStep } = {}) {
  const step = (s, msg) => onStep?.({ step: s, message: msg });
  const webContents = workspace?.getWebContents?.() || workspace?.currentView?.webContents;
  if (!webContents || webContents.isDestroyed?.()) return { solved: false, reason: 'no-webcontents' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    step('detect', `检测验证码（第 ${attempt}/${maxAttempts} 次）…`);
    const detected = await detectTencentCaptcha(workspace);
    if (!detected.detected) {
      // 没检测到验证码，可能已通过或本就没弹
      return { solved: true, reason: 'no-captcha-detected' };
    }

    step('find-gap', '正在识别滑块缺口位置…');
    const gap = await workspace.run(FIND_GAP_SCRIPT).catch(() => ({ ok: false }));
    if (!gap.ok) {
      step('manual', '无法自动识别缺口，请手动拖动滑块');
      return { solved: false, reason: gap.reason || 'find-gap-failed', attempt };
    }

    const btnRect = detected.btnRect;
    const dragStartX = btnRect.x + btnRect.w / 2;
    const dragStartY = btnRect.y + btnRect.h / 2;
    // 拖动距离 = 缺口中心 - 滑块中心（滑块初始在 btnRect 中心）
    // 注意：gap.gapCenterXPage 是缺口在背景图上的 X，滑块要移动这个距离
    const distance = gap.gapCenterXPage - dragStartX;
    step('drag', `拟人拖动 ${Math.round(distance)}px…`);
    try {
      await humanizedDrag(webContents, { startX: dragStartX, startY: dragStartY, distance });
    } catch (e) {
      step('manual', `拖动失败：${e.message}，请手动完成`);
      return { solved: false, reason: 'drag-failed', error: e.message, attempt };
    }

    // 等待验证结果（tcaptcha 拖动后约 1-2 秒出结果）
    step('verify', '等待验证结果…');
    await new Promise((r) => setTimeout(r, 2500));
    const stillThere = await detectTencentCaptcha(workspace);
    if (!stillThere.detected) {
      step('done', '验证码已通过');
      return { solved: true, attempt };
    }
    // 还在，说明这次没过，继续重试
    step('retry', `第 ${attempt} 次未通过，准备重试…`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  step('manual', `${maxAttempts} 次尝试均未通过，请手动完成验证码`);
  return { solved: false, reason: 'max-attempts-exceeded', attempts: maxAttempts };
}

module.exports = {
  attachStealth,
  detectTencentCaptcha,
  solveTencentCaptcha,
  FIND_GAP_SCRIPT,
  STEALTH_SCRIPT
};
