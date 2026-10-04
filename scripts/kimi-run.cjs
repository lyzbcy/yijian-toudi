// 桥式收尾脚本：美团/字节/京东官网投递（CDP trusted click）
// 用法：node scripts/kimi-run.cjs <cmd>
const cmds = {
  meituan_find: async (k) => {
    const snap = await k('snapshot');
    const s = JSON.stringify(snap);
    const re = /"name": "(【LongCat[^"]{5,60})", "ref": "(@e\d+)"/g;
    const out = []; let m;
    while ((m = re.exec(s)) !== null) out.push(`${m[1]} -> ${m[2]}`);
    return out.slice(0, 8).join('\n');
  },
  snap_button: async (k) => {
    const snap = await k('snapshot');
    const s = JSON.stringify(snap);
    const re = /"name": "(立即申请|投递|立即沟通|提交简历)", "ref": "(@e\d+)"/g;
    const out = []; let m;
    while ((m = re.exec(s)) !== null) out.push(`${m[1]} -> ${m[2]}`);
    const url = (snap && snap.data && snap.data.url) || '';
    return `URL: ${url.slice(0, 100)}\n` + (out.join('\n') || 'no button');
  },
  click: async (k, ref) => {
    const r = await k('click', { selector: ref }, 20000);
    return JSON.stringify(r).slice(0, 200);
  },
  snap_url: async (k) => {
    const snap = await k('snapshot');
    return ((snap.data && snap.data.url) || 'no-url').slice(0, 120);
  }
};

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const { execSync } = require('node:child_process');
  const k = (tool, args = {}, timeoutMs = 45000) => new Promise((resolve) => {
    // 通过应用 CDP 调 debugKimi（等价于 window.oneClick.debugKimi）
    const expr = `window.oneClick.debugKimi({ tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)}, timeoutMs: ${timeoutMs} })`;
    const out = execSync(`node scripts/cdp-app.cjs ${JSON.stringify(expr)}`, { cwd: __dirname + '/..', encoding: 'utf8', timeout: 60000 }).trim();
    try { resolve(JSON.parse(out)); } catch { resolve({ raw: out }); }
  });
  const fn = cmds[cmd];
  if (!fn) { console.error('cmds:', Object.keys(cmds).join(',')); process.exit(1); }
  console.log(await fn(k, arg));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
