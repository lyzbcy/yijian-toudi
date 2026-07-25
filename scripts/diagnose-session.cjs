// 诊断脚本：在真实 electron 主进程里跑，找出腾讯登录态到底存在哪个 session。
//
// 运行方式：
//   PATH="/Users/zeen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
//     ./node_modules/.bin/electron --no-sandbox scripts/diagnose-session.cjs
//
// 关键验证点：
//   1. persist:tencent session 的 cookie 数（apply/fill 期望读这个）
//   2. default session 的 cookie 数
//   3. 磁盘上 Partitions/tencent 有没有 Cookies 文件
//   4. 【核心】用两种方式建 WebContentsView 各自属于哪个 session（通过 webContents.session 暴露的 partition 名）
//      - 方式A（错误，apply/fill 当前用法）: new WebContentsView({ session: ses })  ← 顶层 session
//      - 方式B（正确，login-manager 用法）: new WebContentsView({ webPreferences: { partition } })
//   5. 实际加载 careers.tencent.com，看哪种方式能拿到登录态

const { app, session, BrowserWindow, WebContentsView } = require('electron');
const path = require('path');
const fs = require('fs');

// 关键：当以 `electron scripts/diagnose-session.cjs` 方式运行时，Electron 不会读项目
// package.json 的 name（默认 "Electron"），userData 会落到 ~/Library/Application Support/Electron。
// 这里强制指向真实 app 的 userData（= ~/Library/Application Support/yijian-toudi），
// 这样才能读到用户登录后写到磁盘的 persist:tencent cookie。
app.setPath('userData', path.join(require('os').homedir(), 'Library', 'Application Support', 'yijian-toudi'));

const TARGET_URL = 'https://careers.tencent.com/';
const PARTITION = 'persist:tencent';

function fmtCookies(cs) {
  return cs.map((c) => `${c.name}=${String(c.value).slice(0, 12)}${c.value.length > 12 ? '…' : ''}(${c.domain})`);
}

async function dumpSession(tag, ses) {
  console.log(`\n----- session [${tag}] -----`);
  try {
    const part = ses.getPartition ? ses.getPartition() : '(no getPartition)';
    console.log('  partition:', part);
  } catch (e) {
    console.log('  partition: <err>', e.message);
  }
  const all = await ses.cookies.get({}).catch((e) => []);
  console.log(`  cookies(all): ${all.length}`);
  const tencent = await ses.cookies.get({ url: TARGET_URL }).catch((e) => []);
  console.log(`  cookies(${TARGET_URL}): ${tencent.length}`);
  if (tencent.length) console.log('    ', fmtCookies(tencent).join('\n    '));
  const loginish = all.filter((c) => /login|session|token|uid|passport|wlf|stk|p_skey|skey|pt2gguin|uin|p_uin/i.test(c.name));
  if (loginish.length) console.log(`  login-like cookies: ${loginish.length}\n    `, fmtCookies(loginish.slice(0, 15)).join('\n    '));
}

// 加载页面后，在页面里查登录态
const PROBE_JS = `(function(){
  try {
    var body = document.body ? document.body.innerText : '';
    var loginBtn = !!document.querySelector('.tis-login, [class*="login-btn"], a[href*="login"]');
    var hasUserName = !!document.querySelector('.user-name, .user-info, [class*="userName"], [class*="header-user"]');
    var cookieKeys = document.cookie.split(';').map(function(s){ return (s.split('=')[0]||'').trim(); });
    var loginCookies = cookieKeys.filter(function(k){ return /login|session|token|uid|passport|skey|uin|p_uin|p_skey|pt2gguin/i.test(k); });
    return {
      url: location.href,
      title: document.title,
      docCookieCount: cookieKeys.length,
      loginCookies: loginCookies,
      hasLoginBtn: loginBtn,
      hasUserName: hasUserName,
      bodyHead: body.slice(0, 200).replace(/\\s+/g, ' ')
    };
  } catch (e) { return { error: e.message }; }
})()`;

async function loadAndProbe(tag, view) {
  console.log(`\n##### 加载 ${TARGET_URL} [${tag}] #####`);
  try {
    await view.webContents.loadURL(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch (e) {
    console.log('  load error:', e.message);
  }
  await new Promise((r) => setTimeout(r, 4000));
  const r = await view.webContents.executeJavaScript(PROBE_JS).catch((e) => ({ error: e.message }));
  console.log('  probe:', JSON.stringify(r, null, 2).slice(0, 1200));
  // 用 webContents.session 看这个 view 到底用的哪个 session
  try {
    const wcSession = view.webContents.session;
    const part = wcSession.getPartition ? wcSession.getPartition() : '(no getPartition)';
    console.log(`  webContents.session.partition = ${JSON.stringify(part)}`);
  } catch (e) {
    console.log('  webContents.session 读不到:', e.message);
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  console.log('userData:', userData);

  // 1. 磁盘检查
  console.log('\n=== 磁盘 Partitions ===');
  const partDir = path.join(userData, 'Partitions');
  if (fs.existsSync(partDir)) {
    for (const d of fs.readdirSync(partDir)) {
      const sub = path.join(partDir, d);
      const cookieFile = path.join(sub, 'Cookies');
      let cookieSize = -1;
      try { cookieSize = fs.statSync(cookieFile).size; } catch {}
      console.log(`  ${d}/: Cookies=${cookieSize >= 0 ? cookieSize + 'B' : '(无)'}`);
    }
  } else {
    console.log('  Partitions 目录不存在');
  }
  console.log('  userData/Cookies:', fs.existsSync(path.join(userData, 'Cookies')) ? fs.statSync(path.join(userData, 'Cookies')).size + 'B' : '(无)');

  // 2. 各 session 的 cookie
  await dumpSession('default', session.defaultSession);
  await dumpSession(PARTITION, session.fromPartition(PARTITION));

  // 3. 构造一个隐藏窗口承载 WebContentsView
  const win = new BrowserWindow({ width: 1280, height: 900, show: false });

  // 方式A：apply/fill 当前的错误用法 —— 顶层 session（Electron 43 WebContentsView 不接受）
  const sesPersist = session.fromPartition(PARTITION);
  const viewA = new WebContentsView({ session: sesPersist });
  win.contentView.addChildView(viewA);
  viewA.setBounds({ x: 0, y: 0, width: 1280, height: 900 });
  await loadAndProbe('方式A: new WebContentsView({ session })  [apply/fill 当前用法]', viewA);

  // 方式B：login-manager 的正确用法 —— webPreferences.partition
  const viewB = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true } });
  win.contentView.addChildView(viewB);
  viewB.setBounds({ x: 0, y: 0, width: 1280, height: 900 });
  await loadAndProbe('方式B: new WebContentsView({ webPreferences: { partition } })  [login-manager 用法]', viewB);

  app.exit(0);
});
