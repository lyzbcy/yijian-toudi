const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const { applyTencentJob } = require(path.join(ROOT, 'electron/adapters/tencent-apply.cjs'));
  const win = new BrowserWindow({ show: true, width: 1200, height: 800 });
  console.log('窗口已创建，开始投递测试...');
  try {
    const result = await applyTencentJob(
      { id: 'tencent-2052374781944315904', title: '公益平台-推荐算法', url: 'https://careers.tencent.com/jobdesc.html?postId=2052374781944315904' },
      { onStep: (info) => console.log(`[${info.step}] ${info.message}`) }
    );
    console.log('RESULT:', JSON.stringify(result));
  } catch(e) { console.error('投递出错:', e.message); }
  app.exit(0);
});
