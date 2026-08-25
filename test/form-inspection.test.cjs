const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
  LOGIN_AND_FORM_PROBE,
  INSPECT_FORM_FIELDS
} = require('../electron/form-inspection.cjs');

test('注入浏览器的表单探测脚本可以被真实 JavaScript 引擎编译', () => {
  assert.doesNotThrow(() => new vm.Script(LOGIN_AND_FORM_PROBE));
  assert.doesNotThrow(() => new vm.Script(INSPECT_FORM_FIELDS));
});

test('根路径手机号登录页会判定为需要登录，不能当成简历表单', async () => {
  const phone = { autocomplete: 'tel' };
  const document = {
    title: '账号登录',
    body: { innerText: '手机号登录 获取验证码' },
    querySelectorAll(selector) {
      return selector === 'input, textarea, select' ? [phone] : [];
    },
    querySelector(selector) {
      if (selector.includes('signin')) return { className: 'signin-button' };
      if (selector.includes('autocomplete="tel"')) return phone;
      return null;
    }
  };
  const result = await vm.runInNewContext(LOGIN_AND_FORM_PROBE, {
    document,
    location: { pathname: '/', search: '' },
    Promise,
    Date,
    setInterval,
    clearInterval
  });
  assert.equal(result.loginRequired, true);
  assert.equal(result.inputCount, 1);
});

test('简历页普通联系电话输入框不会单独触发登录态', async () => {
  const phone = { autocomplete: 'tel' };
  const document = {
    title: '编辑简历',
    body: { innerText: '基本信息 联系电话 教育经历 工作经历' },
    querySelectorAll(selector) { return selector === 'input, textarea, select' ? [phone] : []; },
    querySelector(selector) { return selector.includes('autocomplete="tel"') ? phone : null; }
  };
  const result = await vm.runInNewContext(LOGIN_AND_FORM_PROBE, {
    document,
    location: { pathname: '/resume/edit', search: '' },
    Promise,
    Date,
    setInterval,
    clearInterval
  });
  assert.equal(result.loginRequired, false);
});

test('单选项回读返回被选中的语义值，不把“否”误读为“是”', () => {
  const radio = {
    disabled: false,
    type: 'radio',
    checked: true,
    value: '否',
    name: 'previouslyInterviewed',
    id: '',
    placeholder: '',
    className: '',
    tagName: 'INPUT',
    parentElement: null,
    closest: () => null,
    getAttribute: () => ''
  };
  const document = {
    body: { innerText: '简历信息' },
    title: '编辑简历',
    querySelectorAll: () => [radio],
    querySelector: () => null
  };
  const fields = vm.runInNewContext(INSPECT_FORM_FIELDS, { document, location: { pathname: '/resume/edit', search: '' } });
  assert.equal(fields[0].value, '否');
});

test('竞态兜底：首帧残留输入框后跳转登录页，最终仍判定为需要登录', async () => {
  // 复现腾讯校招真站 bug：探测首帧还停在 resumeedit.html 且带 1 个输入框，
  // 随后 SPA 跳到 login.html。旧实现立即按 inputCount 返回导致漏判登录。
  let pathname = '/resumeedit.html';
  let inputs = [{ type: 'checkbox' }];
  const document = {
    title: '登录 | 腾讯校招',
    body: { innerText: '使用社交账号一键登录 QQ账号登录 微信账号登录' },
    querySelectorAll(selector) {
      return selector === 'input, textarea, select' ? inputs : [];
    },
    querySelector() { return null; }
  };
  setTimeout(() => {
    pathname = '/login.html';
    inputs = [];
  }, 300);
  const result = await vm.runInNewContext(LOGIN_AND_FORM_PROBE, {
    document,
    location: { get pathname() { return pathname; }, search: '' },
    Promise, Date, setInterval, clearInterval, setTimeout
  });
  assert.equal(result.loginRequired, true);
});

test('Whitelabel/英文 404 错误页识别为 isNotFound（阿里真实案例）', () => {
  const document = {
    title: '',
    body: { innerText: 'Whitelabel Error Page This application has no explicit mapping for /error ... (type=Not Found, status=404).' },
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const result = vm.runInNewContext(LOGIN_AND_FORM_PROBE, { document, location: { pathname: '/campus/personal/resume', search: '' }, Promise, Date, setInterval, clearInterval });
  return result.then((r) => assert.equal(r.isNotFound, true));
});
