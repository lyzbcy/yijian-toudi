const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const suites = [
  ['unit', ['--test', '--test-concurrency=1', ...fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.cjs')).map(f => `test/${f}`)]],
  ['check', ['scripts/check-project.cjs']],
  ['skill-daily-http', ['test/skill-daily-http.cjs']],
  ['agent-shutdown-http', ['test/agent-shutdown-contract.cjs']],
  ['agent-shutdown-routes-http', ['test/agent-shutdown-routes.cjs']],
  ['ui-ai-native', ['test/ui-ai-native.cjs']],
  ['ui-login-gate', ['test/ui-login-gate.cjs']],
  ['ui-resume-autosave', ['test/ui-resume-autosave.cjs']],
  ['ui-log-self-confirm', ['test/ui-log-self-confirm.cjs']],
  ['ui-viewport', ['test/ui-viewport.cjs']],
  ['ui-public-defaults', ['test/ui-public-defaults.cjs']],
  ['ui-job-filters', ['test/ui-job-filters.cjs']],
  ['ui-resume-directory', ['test/ui-resume-directory.cjs']],
  ['ui-report-dialog', ['test/ui-report-dialog.cjs']],
  ...['ui-smoke', 'ui-onboarding', 'ui-feedback', 'ui-resume-segments', 'ui-resume-profiles', 'ui-capabilities', 'ui-workspace-exit', 'ui-resume-batch', 'ui-resume-history', 'ui-batch-actions', 'ui-login-upload', 'ui-live-window-fixes', 'ui-jd-login', 'ui-jd-auth-status', 'ui-jd-resume', 'ui-jd-widgets', 'ui-jd-required', 'ui-auth-frame', 'ui-ai-browser', 'ui-ai-preview', 'ui-reliability', 'ui-boss-recovery']
    .concat(['ui-resume-editor','ui-jd-cascader','ui-desktop-update','ui-kimi-daemon','ui-boss-binding','ui-meituan-jobs','ui-widget-review','ui-resume-target','ui-resume-layout','ui-meituan-groups','ui-meituan-dates','ui-project-reconcile','ui-single-profile','ui-local-preview','ui-boss-account-entry','ui-meituan-retry','ui-wecom-notice','ui-task-recovery','ui-meituan-persistence','ui-generic-control-guard','ui-login-track','ui-bytedance-dates','ui-bytedance-projects','ui-bytedance-project-replace']).map(name => [name, [`test/${name}.cjs`]])
];
const results = [];
fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
for (const [name, args] of suites) {
  console.log(`运行后台测试：${name}`);
  const start = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: root, windowsHide: true, timeout: 180000, encoding: 'utf8',
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: '1' }
  });
  fs.writeFileSync(path.join(root, 'test-output', `background-${name}.log`), `${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`);
  results.push({ name, ok: result.status === 0 && !result.error, exitCode: result.status, ms: Date.now() - start });
  console.log(`${name}: ${results.at(-1).ok ? '通过' : '失败，见 test-output 日志'}`);
  if (!results.at(-1).ok) break;
}
const report = { at: new Date().toISOString(), ok: results.length === suites.length && results.every(r => r.ok), results };
fs.writeFileSync(path.join(root, 'test-output', 'background-tests.json'), JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
