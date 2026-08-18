const TOP_BAR_HEIGHT = 52;

function calculateWorkspaceBounds(contentWidth, contentHeight) {
  return {
    x: 0,
    y: TOP_BAR_HEIGHT,
    width: Math.max(0, contentWidth),
    height: Math.max(0, contentHeight - TOP_BAR_HEIGHT)
  };
}

module.exports = {
  TOP_BAR_HEIGHT,
  calculateWorkspaceBounds
};
