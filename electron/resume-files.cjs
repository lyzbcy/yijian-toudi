const path = require('node:path');

function resolveResumeFilePath(directory, filename) {
  const name = String(filename || '');
  // Older imports kept the user's original filename. Validate a single local
  // document name rather than requiring the newer generated-name convention.
  if (!name || path.basename(name) !== name || /[\\/:\x00-\x1f<>"|?*]/.test(name) ||
      /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
      !/\.(pdf|doc|docx)$/i.test(name)) {
    throw new Error('简历文件名不合法');
  }
  const root = path.resolve(directory);
  const resolved = path.resolve(root, name);
  if (path.dirname(resolved) !== root) throw new Error('简历文件名不合法');
  return resolved;
}

module.exports = { resolveResumeFilePath };
