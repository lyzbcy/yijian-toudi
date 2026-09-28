const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'site');
const assetsSource = path.resolve(__dirname, '..', 'src', 'assets');
const port = Number(process.env.SITE_PREVIEW_PORT || 4173);

// 介绍页只维护 src/assets 这一份源，预览前同步到 site/assets。
// Node 24 在部分 Windows 目录上递归 cpSync 会触发进程崩溃，逐文件复制更稳定。
function syncAssets(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) syncAssets(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}
syncAssets(assetsSource, path.join(root, 'assets'));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(target, (statError, stats) => {
    const file = !statError && stats.isDirectory() ? path.join(target, 'index.html') : target;
    fs.readFile(file, (error, content) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      response.end(content);
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`一键投递介绍页：http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
