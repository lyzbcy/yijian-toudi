// 从日常 Edge profile 提取 Kimi 扩展到 app userData/extensions/kimi（一次性，account-browser 依赖）
// 用法：node scripts/extract-kimi-extension.cjs [目标目录]
// 逻辑：扫描 %LOCALAPPDATA%/Microsoft/Edge/User Data/*/Extensions/*/，按 manifest.json 的
// name/description 匹配 Kimi（不写死扩展 ID，防止上游换 ID），取版本最高的拷贝。
const fs = require('node:fs');
const path = require('node:path');

function findKimiExtensionInProfiles() {
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data')
  ];
  const hits = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const profiles = fs.readdirSync(root).filter((name) =>
      name === 'Default' || name.startsWith('Profile ')
    );
    for (const profile of profiles) {
      const extRoot = path.join(root, profile, 'Extensions');
      if (!fs.existsSync(extRoot)) continue;
      for (const extId of fs.readdirSync(extRoot)) {
        const extDir = path.join(extRoot, extId);
        if (!fs.statSync(extDir).isDirectory()) continue;
        for (const ver of fs.readdirSync(extDir)) {
          const manifestPath = path.join(extDir, ver, 'manifest.json');
          if (!fs.existsSync(manifestPath)) continue;
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const text = `${manifest.name || ''} ${manifest.description || ''}`;
            // Kimi 扩展 name 可能是 __MSG_xxx__（本地化），同时用 _locales 的 manifest 消息兜底
            let resolved = text;
            const msgMatch = /__MSG_(.+)__/.exec(manifest.name || '');
            if (msgMatch) {
              for (const locale of ['zh_CN', 'zh_CN', 'en']) {
                const msgFile = path.join(extDir, ver, '_locales', locale, 'messages.json');
                if (fs.existsSync(msgFile)) {
                  try {
                    const msgs = JSON.parse(fs.readFileSync(msgFile, 'utf8'));
                    const key = msgMatch[1].toLowerCase();
                    const entry = Object.entries(msgs).find(([k]) => k.toLowerCase() === key);
                    if (entry) { resolved = `${entry[1].message || ''} ${manifest.description || ''}`; break; }
                  } catch {}
                }
              }
            }
            if (/kimi/i.test(resolved)) {
              hits.push({ dir: path.join(extDir, ver), version: ver, name: resolved.slice(0, 60) });
            }
          } catch {}
        }
      }
    }
  }
  return hits.sort((a, b) => b.version.localeCompare(a.version));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  const hits = findKimiExtensionInProfiles();
  if (!hits.length) {
    console.error('未在日常 Edge 中找到 Kimi 扩展。请先在 Edge 应用商店安装 Kimi 扩展并确认可用，再运行本脚本。');
    process.exit(1);
  }
  const best = hits[0];
  const target = process.argv[2] || path.join(process.env.APPDATA || '.', 'yijian-toudi', 'extensions', 'kimi');
  fs.rmSync(target, { recursive: true, force: true });
  copyDir(best.dir, target);
  const size = fs.readdirSync(target).length;
  console.log(`OK 已提取 Kimi 扩展: ${best.name} (v${best.version})`);
  console.log(`来源: ${best.dir}`);
  console.log(`目标: ${target} (${size} 个顶层条目)`);
}

main();
