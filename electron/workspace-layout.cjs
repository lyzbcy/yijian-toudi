const TOP_BAR_HEIGHT = 52;
// 填写进度侧边栏宽度：resume-review 模式下内嵌页面右侧收窄这么多，把这块真实空间留给日志面板。
// 原生 WebContentsView 永远盖在网页 UI 之上，面板必须渲染在预留空档里，否则会被完全遮挡。
const FILL_LOG_RAIL_WIDTH = 296;

function calculateWorkspaceBounds(contentWidth, contentHeight, { reserveFillLogRail = false } = {}) {
  const railWidth = reserveFillLogRail ? FILL_LOG_RAIL_WIDTH : 0;
  return {
    x: 0,
    y: TOP_BAR_HEIGHT,
    width: Math.max(0, contentWidth - railWidth),
    height: Math.max(0, contentHeight - TOP_BAR_HEIGHT)
  };
}

module.exports = {
  TOP_BAR_HEIGHT,
  FILL_LOG_RAIL_WIDTH,
  calculateWorkspaceBounds
}
