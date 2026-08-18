// 简历 JSON 导出/导入（统一模板格式）
//
// 导出格式：
// {
//   "format": "yijian-toudi-resume",
//   "version": 1,
//   "exportedAt": "2026-08-18T00:00:00.000Z",
//   "appVersion": "0.3.0",
//   "resume": { ...完整简历数据（含多 profile）... }
// }
//
// 导入同时接受：
//   1. 上述完整模板（校验 format/version）
//   2. 裸简历对象（直接导出模板里的 resume 字段内容）
// 导入只替换简历数据，不触碰 Token、邮箱授权码、岗位、购物车等其它状态。

const RESUME_FORMAT = 'yijian-toudi-resume';
const RESUME_FORMAT_VERSION = 1;

// 简历必须包含的结构性字段（store 迁移器会补齐其余字段）
const REQUIRED_RESUME_KEYS = ['basic'];

function createResumeExport(resume, appVersion) {
  if (!resume || typeof resume !== 'object') throw new Error('简历数据为空，无法导出');
  for (const key of REQUIRED_RESUME_KEYS) {
    if (resume[key] === undefined) throw new Error(`简历缺少 ${key} 字段，数据不完整，无法导出`);
  }
  return {
    format: RESUME_FORMAT,
    version: RESUME_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: appVersion || null,
    resume: JSON.parse(JSON.stringify(resume))
  };
}

function parseResumeImport(rawText) {
  let payload;
  try {
    payload = JSON.parse(String(rawText));
  } catch {
    throw new Error('不是有效的 JSON 文件，请检查文件内容');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('JSON 内容不是对象，无法识别为简历数据');
  }
  let resume = payload;
  if (payload.format !== undefined || payload.resume !== undefined) {
    // 完整模板：校验格式标识与版本
    if (payload.format !== RESUME_FORMAT) {
      throw new Error(`格式标识不匹配：期望 ${RESUME_FORMAT}，实际 ${String(payload.format)}`);
    }
    if (!Number.isInteger(payload.version) || payload.version > RESUME_FORMAT_VERSION) {
      throw new Error(`模板版本 ${String(payload.version)} 高于当前软件支持的 ${RESUME_FORMAT_VERSION}，请先升级软件`);
    }
    resume = payload.resume;
  }
  if (!resume || typeof resume !== 'object' || Array.isArray(resume)) {
    throw new Error('文件中没有简历数据（缺少 resume 字段）');
  }
  for (const key of REQUIRED_RESUME_KEYS) {
    if (resume[key] === undefined || resume[key] === null) {
      throw new Error(`简历缺少 ${key} 字段，不是有效的统一简历数据`);
    }
  }
  // 深拷贝隔离导入源，避免外部对象与内存状态共享引用
  return JSON.parse(JSON.stringify(resume));
}

module.exports = {
  RESUME_FORMAT,
  RESUME_FORMAT_VERSION,
  createResumeExport,
  parseResumeImport
};
