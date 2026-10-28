const {inspectPageAuthentication}=require('./page-auth-probe.cjs');
const LOGIN_AND_FORM_PROBE = `(() => new Promise((resolve) => {
  const inspectAuthentication = ${inspectPageAuthentication.toString()};
  const inspect = () => {
    const bodyText = document.body?.innerText || '';
    const inputCount = document.querySelectorAll('input, textarea, select').length;
    const isNotFound = /404|页面不存在|没有找到|Whitelabel Error Page|Not Found/i.test(document.title + bodyText.slice(0, 500));
    return { loginRequired: inspectAuthentication().loginRequired, isNotFound, inputCount };
  };
  const initial = inspect();
  // SPA 跳转登录页存在竞态：首帧可能还停在原路径且带残留输入框，立即按 inputCount 返回会漏判登录。
  // 至少观察 1.2s，只有连续两次都「无登录迹象且有表单」才认为表单页就绪。
  const startedAt = Date.now();
  const settleDelay = 1200;
  const timer = setInterval(() => {
    const result = inspect();
    const settled = Date.now() - startedAt >= settleDelay;
    if (result.inputCount > 0 && !result.loginRequired && !settled) return;
    if (result.inputCount > 0 || result.isNotFound || result.loginRequired || Date.now() - startedAt > 6000) {
      clearInterval(timer);
      resolve(result);
    }
  }, 250);
}))()`;

const {getJdFormContext}=require('./jd-form-context.cjs');
const {getByteDanceFormContext}=require('./bytedance-form-context.cjs');
const {getMeituanFormContext}=require('./meituan-form-context.cjs');
const INSPECT_FORM_FIELDS = `(() => {
  const jdContext = ${getJdFormContext.toString()};
  const byteContext = ${getByteDanceFormContext.toString()};
  const meituanContext = ${getMeituanFormContext.toString()};
  function describe(control) {
    const meituan=meituanContext(control);if(meituan)return meituan.label;
    const byte=byteContext(control);if(byte)return byte.matchLabel;
    const labelByFor = control.id ? document.querySelector('label[for="' + CSS.escape(control.id) + '"]')?.innerText : '';
    const ancestorTexts = [];
    let node = control.parentElement;
    for (let depth = 0; depth < 5 && node; depth += 1) {
      try {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('input,textarea,select').forEach((element) => element.remove());
        const text = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text && text.length < 100) ancestorTexts.push(text);
      } catch (error) {}
      node = node.parentElement;
    }
    return [
      jdContext(control)?.label, labelByFor, control.closest('label')?.innerText, control.placeholder, control.name, control.id,
      control.getAttribute('aria-label'), control.getAttribute('autocomplete'), control.className,
      ancestorTexts.join(' ')
    ].filter(Boolean).join(' ').trim();
  }
  const controls = [...document.querySelectorAll('input, textarea, select')]
    .filter((control) => !control.disabled && control.type !== 'hidden' && control.type !== 'button' && control.type !== 'submit')
    .filter((control) => !control.closest('form[action*="login"], [class*="login"], [class*="captcha"], [class*="auth"], [role="dialog"]'));
  // 字段所在的经历区块（如「实习经历-1」「项目经历-2」）：供按段匹配，避免兄弟字段的祖先文本互相污染。
  // 区块标题不是输入框的祖先节点，用「标题叶子节点按视觉位置分区」：每个字段归属它上方最近的区块标题。
  // 区块标题节点形如「实习经历-1 删除…」：遍历文本节点找「X经历-N」标题（线性复杂度，避免全量元素扫描），
  // 同一区块只留一个标题，按视觉位置（top）分区
  const headerCandidates = new Map();
  try {
  if (typeof document.createTreeWalker !== 'function') throw new Error('no-walker');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const match = String(textNode.textContent || '').match(/((?:实习|项目|游戏|教育|工作)经历)\\s*[-－]?\\s*(\\d+)/);
    if (!match) continue;
    const key = match[1] + '-' + match[2];
    const length = String(textNode.textContent).trim().length;
    const existing = headerCandidates.get(key);
    if (!existing || length < existing.length) {
      const rect = textNode.parentElement.getBoundingClientRect();
      headerCandidates.set(key, { key, length, top: rect.top });
    }
  }
  } catch (error) {}
  const headerNodes = [...headerCandidates.values()].sort((a, b) => a.top - b.top);
  const sectionOf = (control) => {
    const meituan=meituanContext(control);if(meituan)return meituan.section==='basic'?'':meituan.section;
    const byte=byteContext(control);if(byte)return byte.section==='basic'?'':byte.section;
    const jd=jdContext(control);
    const aliases={edu:'教育经历',experience:'实习经历',program:'项目经历'};
    if(jd&&aliases[jd.sectionId])return aliases[jd.sectionId]+'-'+jd.groupNumber;
    if (typeof control.getBoundingClientRect !== 'function') return '';
    const top = control.getBoundingClientRect().top;
    let section = '';
    for (const header of headerNodes) {
      if (header.top <= top) section = header.key; else break;
    }
    return section;
  };
  return controls.map((control, index) => ({
    index,
    jdLocator: jdContext(control),
    byteLocator: byteContext(control),
    meituanLocator: meituanContext(control),
    readOnly: Boolean((typeof location!=='undefined'&&location.origin==='https://jobs.bytedance.com'&&location.pathname==='/campus/resume/edit'&&document.querySelector('.ud-formily-item')&&(!byteContext(control)||!(['text','email','tel','textarea'].includes(control.type))||byteContext(control)?.label==='起止时间')) || (typeof location!=='undefined'&&location.origin==='https://zhaopin.meituan.com'&&location.pathname==='/web/personal-center/resume-detail'&&document.querySelector('.resume_detail_edit .mtd-form')&&!meituanContext(control)?.writable) || control.readOnly || (jdContext(control)&&control.matches('.ant-select-search__field'))),
    section: sectionOf(control),
    label: describe(control).slice(0, 240),
    type: control.tagName.toLowerCase() + (control.type ? ':' + control.type : ''),
    value: control.type === 'radio'
      ? (control.checked ? (control.value || describe(control).split(/\\s+/).at(-1) || '是') : '')
      : (control.type === 'checkbox' ? (control.checked ? '是' : '否') : (control.value || '')),
    controlValue: control.value || '',
    name: control.name || '', id: control.id || '', placeholder: control.placeholder || '',
    ariaLabel: control.getAttribute('aria-label') || '', autocomplete: control.getAttribute('autocomplete') || '',
    options: control.tagName === 'SELECT' ? [...control.options].map((option) => option.textContent.trim()).slice(0, 30) : null
  }));
})()`;

module.exports = { LOGIN_AND_FORM_PROBE, INSPECT_FORM_FIELDS };
