const fs = require('node:fs');
const path = require('node:path');

// Authenticate in AgentServer before calling. Inspect only this store's file;
// no caller-controlled paths, mutations, secret values or secret fingerprints.
function storageDiagnostics(store) {
  if (typeof store?.file !== 'string' || typeof store?.get !== 'function') {
    return { supported: false, readable: false, reason: 'store-file-unavailable' };
  }
  const base = { supported: true, directory: path.dirname(store.file), fileName: path.basename(store.file) };
  try {
    const memory = store.get();
    const bytes = fs.readFileSync(store.file);
    let disk;
    try { disk = JSON.parse(bytes.toString('utf8')); }
    catch { return { ...base, readable: false, reason: 'invalid-state-json' }; }
    if (!disk || typeof disk !== 'object' || !disk.settings || !disk.resume) {
      return { ...base, readable: false, reason: 'invalid-state-shape' };
    }
    return {
      ...base,
      readable: true,
      bytes: bytes.length,
      tokenMatchesMemory: disk.settings.apiToken === memory.settings?.apiToken,
      resumeMatchesMemory: JSON.stringify(disk.resume) === JSON.stringify(memory.resume),
      jobs: { memory: Array.isArray(memory.jobs) ? memory.jobs.length : null, disk: Array.isArray(disk.jobs) ? disk.jobs.length : null }
    };
  } catch (error) {
    return { ...base, readable: false, reason: error.code === 'ENOENT' ? 'state-file-missing' : 'state-file-unreadable' };
  }
}

module.exports = { storageDiagnostics };
