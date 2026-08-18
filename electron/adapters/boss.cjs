const { resolvePlatformUrl } = require('../platform-manifests.cjs');

const BOSS_JOBS_URL = resolvePlatformUrl('boss', 'social', 'jobs');

async function listBossJobs({ onProgress } = {}) {
  const error = new Error('受 BOSS 直聘用户协议限制，未获平台许可前不启用第三方自动抓取；请使用软件内的官方入口手动查看');
  error.code = 'PLATFORM_PERMISSION_REQUIRED';
  error.officialUrl = BOSS_JOBS_URL;
  onProgress?.({ error: error.message, officialUrl: error.officialUrl });
  throw error;
}

module.exports = { BOSS_JOBS_URL, listBossJobs };
