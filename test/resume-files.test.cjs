const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveResumeFilePath } = require('../electron/resume-files.cjs');

test('简历附件路径只能解析本目录内由应用生成的文件名', () => {
  const directory = path.resolve('/tmp/yjt-resumes');
  assert.equal(
    resolveResumeFilePath(directory, 'resume-123.pdf'),
    path.join(directory, 'resume-123.pdf')
  );
  assert.throws(() => resolveResumeFilePath(directory, '../../secret.txt'), /文件名不合法/);
  assert.throws(() => resolveResumeFilePath(directory, 'other.pdf'), /文件名不合法/);
  assert.throws(() => resolveResumeFilePath(directory, 'resume-123.exe'), /文件名不合法/);
});
