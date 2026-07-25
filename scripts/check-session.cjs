const { app, session } = require('electron');
const path = require('path');
const fs = require('fs');
app.whenReady().then(async () => {
  // 检查 browser-profile（automation.cjs 用的 launchPersistentContext）
  const profilePath = path.join(app.getPath('userData'), 'browser-profile', 'Default');
  console.log('browser-profile 存在:', fs.existsSync(profilePath));
  // 用 browser-profile 创建 session
  try {
    const ses = session.fromPath(path.join(app.getPath('userData'), 'browser-profile', 'Default'));
    const cookies = await ses.cookies.get({url: 'https://careers.tencent.com'}).catch(()=>[]);
    console.log('browser-profile tencent cookie:', cookies.length);
    if (cookies.length) console.log('  名字:', cookies.slice(0,10).map(c=>c.name).join(', '));
  } catch(e) { console.log('fromPath 失败:', e.message); }
  // 列出所有 disk partition
  const partDir = path.join(app.getPath('userData'), 'Partitions');
  if (fs.existsSync(partDir)) {
    for (const d of fs.readdirSync(partDir)) {
      const cf = path.join(partDir, d, 'Cookies');
      try { console.log(`Partition/${d}/Cookies:`, fs.statSync(cf).size, 'bytes'); } catch {}
    }
  }
  app.exit(0);
});
