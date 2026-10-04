const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const suites = [
  ['unit', ['--test', ...fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.cjs')).map(f => `test/${f}`)]],
  ['check', ['scripts/check-project.cjs']],
  ...['ui-smoke', 'ui-resume-segments', 'ui-resume-profiles', 'ui-capabilities', 'ui-workspace-exit', 'ui-resume-batch', 'ui-batch-actions', 'ui-login-upload', 'ui-live-window-fixes', 'ui-jd-login', 'ui-auth-frame', 'ui-ai-browser', 'ui-ai-preview', 'ui-reliability', 'ui-boss-recovery', 'ui-delivery-layout', 'ui-feedback', 'ui-update-install-status', 'ui-job-refresh-status']
    .map(name => [name, [`test/${name}.cjs`]])
];
const results = [];
fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
for (const [name, args] of suites) {
  console.log(`运行后台测试：${name}`);
  const start = Date.now();
  const result = spawnSync(process.execPath, args, {
    // Ten loops include real modal input and 30 persisted profile operations.
    // Each UI action stays bounded at 15s; retain failures in the suite report.
    cwd: root, windowsHide: true, timeout: name === 'ui-reliability' ? 300000 : 180000, encoding: 'utf8',
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
