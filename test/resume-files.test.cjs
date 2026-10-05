const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveResumeFilePath } = require('../electron/resume-files.cjs');

test('简历附件兼容本目录内旧版原始文件名，并拒绝路径和非文档', () => {
  const directory = path.resolve('/tmp/yjt-resumes');
  assert.equal(
    resolveResumeFilePath(directory, 'resume-123.pdf'),
    path.join(directory, 'resume-123.pdf')
  );
  assert.throws(() => resolveResumeFilePath(directory, '../../secret.txt'), /文件名不合法/);
  assert.equal(resolveResumeFilePath(directory, '我的简历（旧版）.pdf'), path.join(directory, '我的简历（旧版）.pdf'));
  assert.equal(resolveResumeFilePath(directory, 'other.DOCX'), path.join(directory, 'other.DOCX'));
  for (const name of ['..\\secret.pdf', '/absolute.pdf', 'C:\\private.pdf', 'a/b.pdf', 'a.pdf:stream', 'nul.pdf', 'resume.pdf ', 'resume.pdf\0']) {
    assert.throws(() => resolveResumeFilePath(directory, name), /文件名不合法/);
  }
  assert.throws(() => resolveResumeFilePath(directory, 'resume-123.exe'), /文件名不合法/);
});
