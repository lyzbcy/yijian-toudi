'use strict';
// Only load the local launcher source chosen by the developer. Never load remote code.
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const [root, id, executable, displayName, installed] = process.argv.slice(2);
  const detector = require(path.join(root, 'src/installed.cjs'));
  const portable = require(path.join(root, 'src/portable.cjs'));
  const source = fs.readFileSync(path.join(root, 'src/installed.cjs'), 'utf8');
  const filter = source.match(/DisplayName -match '([^']+)'/);
  if (!filter) throw new Error('注册表筛选实现已变化，请更新自查脚本');
  const result = {
    matchedId: detector.matchExecutable(executable),
    portableExecutable: portable.portableExecutable(id),
    registryNameMatched: new RegExp(filter[1], 'i').test(displayName)
  };
  if (installed === 'true') {
    if (process.platform !== 'win32') throw new Error('--installed 仅支持 Windows');
    const inventory = await detector.detectInstalled();
    result.installedPath = inventory.installed[id] || null;
    result.warnings = inventory.warnings;
  }
  process.stdout.write(JSON.stringify(result));
})().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
