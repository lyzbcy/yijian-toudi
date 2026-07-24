const { app, session } = require('electron');
app.whenReady().then(async () => {
  // 遍历所有 partition 检查 cookie
  for (const cid of ['tencent', 'alibaba', 'baidu', 'bytedance']) {
    const ses = session.fromPartition(`persist:${cid}`);
    // 等待 cookie 从磁盘加载
    await new Promise(r => setTimeout(r, 500));
    const cookies = await ses.cookies.get({});
    if (cookies.length > 0) {
      console.log(`persist:${cid}: ${cookies.length} cookies`);
      console.log('  名字:', cookies.slice(0,8).map(c=>c.name).join(', '));
    }
  }
  // 也检查 default
  const def = await session.defaultSession.cookies.get({});
  console.log(`default: ${def.length} cookies`);
  if (def.length > 0) console.log('  名字:', def.slice(0,8).map(c=>c.name).join(', '));
  app.exit(0);
});
