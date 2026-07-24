const { app, session } = require('electron');
app.whenReady().then(async () => {
  // 检查所有可能的 partition
  for (const cid of ['tencent', 'alibaba', 'baidu', 'bytedance']) {
    const ses = session.fromPartition(`persist:${cid}`);
    const cookies = await ses.cookies.get({});
    const tencentCookies = await ses.cookies.get({ domain: 'tencent.com' }).catch(()=>[]);
    const alibabaCookies = await ses.cookies.get({ domain: 'alibaba.com' }).catch(()=>[]);
    console.log(`persist:${cid}: 总cookie=${cookies.length}, tencent=${tencentCookies.length}, alibaba=${alibabaCookies.length}`);
    if (cookies.length > 0 && cookies.length < 50) {
      console.log('  cookie名:', cookies.map(c => c.name).slice(0,15).join(', '));
    }
  }
  // 也检查 default session
  const def = session.defaultSession;
  const defCookies = await def.cookies.get({});
  console.log(`default session: 总cookie=${defCookies.length}`);
  app.exit(0);
});
