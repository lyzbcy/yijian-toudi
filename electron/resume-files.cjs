const path = require('node:path');

function resolveResumeFilePath(directory, filename) {
  const name = String(filename || '');
  if (path.basename(name) !== name || !/^resume-\d+\.(pdf|doc|docx)$/i.test(name)) {
    throw new Error('简历文件名不合法');
  }
  const root = path.resolve(directory);
  const resolved = path.resolve(root, name);
  if (path.dirname(resolved) !== root) throw new Error('简历文件名不合法');
  return resolved;
}

module.exports = { resolveResumeFilePath };
