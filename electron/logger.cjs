// 内存日志系统：环形缓冲，固定 50 条，零磁盘写入。
//
// 设计目标（见 doc/specs/2026-07-24 子项目 A）：
//   - 开发调试用，不写文件，避免臃肿和重复 IO
//   - 固定长度数组，满 50 条自动挤掉最老的
//   - 主进程单例，通过 IPC log:get 暴露给前端
//
// 用法：
//   const { logger } = require('./logger.cjs');
//   logger.info('抓取完成', { company: 'tencent', count: 1571 });
//   logger.error('抓取失败', { company: 'baidu', error: 'timeout' });

const MAX_ENTRIES = 50;

// 环形缓冲：用数组 + shift 实现，50 条规模下 shift 开销可忽略
const entries = [];

function push(level, msg, meta) {
  const entry = {
    ts: new Date().toISOString().replace('T', ' ').slice(0, 19),
    level,
    msg: typeof msg === 'string' ? msg : String(msg),
    meta: meta || undefined
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();
  // 同步打到 console，开发期即使不打开日志面板也能在终端看到
  const prefix = `[${entry.ts}] [${level.toUpperCase()}]`;
  if (level === 'error') console.error(prefix, entry.msg, meta || '');
  else if (level === 'warn') console.warn(prefix, entry.msg, meta || '');
  else console.log(prefix, entry.msg, meta || '');
  return entry;
}

const logger = {
  info: (msg, meta) => push('info', msg, meta),
  warn: (msg, meta) => push('warn', msg, meta),
  error: (msg, meta) => push('error', msg, meta),
  // 返回最近 N 条（默认全部 50 条），最新在后
  recent: (n = MAX_ENTRIES) => entries.slice(-n).map((e) => ({ ...e })),
  clear: () => { entries.length = 0; }
};

module.exports = { logger };
