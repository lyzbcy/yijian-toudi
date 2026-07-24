// 通过 electron 主进程入口探测（在 app ready 后用 persist:alibaba session）
const { app, session, BrowserWindow, WebContentsView } = require('electron');
const path = require('path');

app.on('ready', async () => {
  try {
    const ses = session.fromPartition('persist:alibaba');
    // 检查 session 里有没有登录 cookie
    const cookies = await ses.cookies.get({ domain: 'alibaba.com' });
    console.log('tencent cookies 数量:', cookies.length);
    const hasLogin = cookies.some(c => /login|session|token|uid|passport/i.test(c.name));
    console.log('有登录态cookie:', hasLogin);

    const view = new WebContentsView({ session: ses });
    // 用一个隐藏窗口承载 view
    const win = new BrowserWindow({ width: 1200, height: 800, show: false });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });

    // 1. 简历页
    console.log('\n=== 简历页 ===');
    await view.webContents.loadURL('https://careers.alibaba.com/jobresume/resume.html', { waitUntil: 'networkidle2' || 'networkidle', timeout: 20000 }).catch(e => console.log('load:', e.message.slice(0,50)));
    await new Promise(r => setTimeout(r, 3000));
    const r1 = await view.webContents.executeJavaScript(`(() => {
      try {
        const inputs = [...document.querySelectorAll('input,select,textarea')];
        return { url: location.href, title: document.title, is404: /404|没有找到/.test(document.title+document.body.innerText), inputCount: inputs.length, inputs: inputs.slice(0,25).map(i => ({tag:i.tagName,type:i.type,name:i.name,id:i.id,ph:i.placeholder})), bodyText: document.body.innerText.slice(0,200) };
      } catch(e) { return {error: e.message}; }
    })()`).catch(e => ({error:e.message}));
    console.log(JSON.stringify(r1, null, 2));

    app.exit(0);
  } catch(e) {
    console.error('出错:', e.message);
    app.exit(1);
  }
});
