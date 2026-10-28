// Bounded memory and async batched JSONL; persisted content is structural diagnostics.
const fs = require('node:fs');
const path = require('node:path');
const { diagnosticEntries } = require('./diagnostics.cjs');
function createLogger({ directory, intervalMs = 3000, batchSize = 40, maxBytes = 1048576, backups = 3, consoleOutput = true } = {}) {
  const entries = [], queue = [];
  let diagnosticMode = false, timer, writing = null, lastError = null;
  const file = () => path.join(directory, 'runtime.jsonl');
  async function rotate(bytes) {
    let size = 0;
    try { size = (await fs.promises.stat(file())).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!size || size + bytes <= maxBytes) return;
    for (let i = backups; i >= 1; i--) {
      const from = i === 1 ? file() : `${file()}.${i - 1}`;
      await fs.promises.rm(`${file()}.${i}`, { force: true });
      try { await fs.promises.rename(from, `${file()}.${i}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  function flush() {
    if (writing) return writing;
    if (!directory || !queue.length) return Promise.resolve();
    const pending = queue.splice(0);
    writing = (async () => {
      try {
        await fs.promises.mkdir(directory, { recursive: true });
        let chunk = '';
        for (const line of pending) {
          if (chunk && Buffer.byteLength(chunk + line) > maxBytes) {
            await rotate(Buffer.byteLength(chunk)); await fs.promises.appendFile(file(), chunk, { mode: 0o600 }); chunk = '';
          }
          chunk += line;
        }
        if (chunk) { await rotate(Buffer.byteLength(chunk)); await fs.promises.appendFile(file(), chunk, { mode: 0o600 }); }
        lastError = null;
      } catch (error) { lastError = error.code || 'log-write-failed'; }
    })().finally(() => { writing = null; });
    return writing;
  }
  function flushSync() {
    if (!directory || !queue.length) return;
    try {
      fs.mkdirSync(directory, { recursive: true });
      while (queue.length) {
        const line = queue[0];
        if (fs.existsSync(file()) && fs.statSync(file()).size + Buffer.byteLength(line) > maxBytes) {
          for (let i = backups; i >= 1; i--) {
            const from = i === 1 ? file() : `${file()}.${i - 1}`, to = `${file()}.${i}`;
            if (fs.existsSync(to)) fs.unlinkSync(to);
            if (fs.existsSync(from)) fs.renameSync(from, to);
          }
        }
        fs.appendFileSync(file(), line, { mode: 0o600 }); queue.shift();
      }
      lastError = null;
    } catch (error) { lastError = error.code || 'log-write-failed'; }
  }
  function push(level, msg, meta) {
    if (level === 'debug' && !diagnosticMode) return;
    const entry = { ts: new Date().toISOString().replace('T', ' ').slice(0, 19), level, msg: String(msg), meta: meta || undefined };
    entries.push(entry); if (entries.length > 50) entries.shift();
    const safe = diagnosticEntries([entry])[0];
    // Detail adds structural types, never raw messages/values/credential-bearing keys.
    if (diagnosticMode) {
      const callers = (new Error().stack || '').replaceAll('\\', '/').split('\n').map(line => line.match(/electron\/[a-z0-9-]+\.cjs:\d+:\d+/i)?.[0]).filter(line => line && !line.startsWith('electron/logger.cjs:'));
      safe.detail = { level, caller: callers[0] || 'external', types: Object.values(meta && typeof meta === 'object' ? meta : {}).slice(0, 30).map(v => typeof v) };
    }
    if (directory) { queue.push(JSON.stringify(safe) + '\n'); if (queue.length > 1000) queue.shift(); }
    if (consoleOutput) console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${entry.ts}] [${level.toUpperCase()}]`, safe.msg, safe.meta);
    if (level === 'error') void flush().then(() => flush());
    else if (queue.length >= batchSize) void flush();
    return entry;
  }
  function configure(options = {}) {
    if (options.directory && options.directory !== directory) {
      if (writing) throw Error('logger-directory-change-during-write');
      flushSync(); directory = options.directory;
    }
    if (typeof options.diagnosticMode === 'boolean') diagnosticMode = options.diagnosticMode;
    clearInterval(timer);
    if (directory) { timer = setInterval(() => void flush(), intervalMs); timer.unref(); }
  }
  configure();
  return {
    info: (m, x) => push('info', m, x), warn: (m, x) => push('warn', m, x), error: (m, x) => push('error', m, x), debug: (m, x) => push('debug', m, x),
    recent: (n = 50) => entries.slice(-n).map(e => structuredClone(e)), clear: () => { entries.length = 0; }, configure, flush, flushSync,
    status: () => ({ diagnosticMode, queued: queue.length, lastError }),
    close: async () => { clearInterval(timer); await flush(); await flush(); }
  };
}
const logger = createLogger();
process.once('exit', () => logger.flushSync());
process.on('uncaughtExceptionMonitor', () => logger.flushSync());
module.exports = { logger, createLogger };
