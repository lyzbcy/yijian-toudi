'use strict';

// Acquire after app.setPath('userData'), before initializing any store or service.
// Electron's native lock belongs to this userData directory, not the preview script.
function installSingleProfileGate(app, getWindow) {
  const ownsProfile = app.requestSingleInstanceLock();
  if (!ownsProfile) {
    console.info('PROFILE_ALREADY_RUNNING; foreground_requested=true');
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return true;
}

module.exports = { installSingleProfileGate };
