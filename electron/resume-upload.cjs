// Attachment parsing only: never application submission or legal consent.
function installResumeUploadObserver() {
  if (window.__yjtResumeUpload) { window.__yjtResumeUpload.inspectPending?.(); return true; }
  const state = window.__yjtResumeUpload = { phase: 'idle', confirmed: false, startedAt: 0 };
  const dialogSelector = '[role="dialog"],[role="alertdialog"],dialog[open],.ant-modal-content,.el-message-box,.el-dialog,.next-dialog,.semi-modal-content,.arco-modal';
  const buttonSelector = 'button,[role="button"],input[type="button"]';
  const handled = new WeakSet();
  let timer = null, stableAt = 0, signature = '', changed = false, activeDialog = null;
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const label = e => (e.innerText || e.value || '').replace(/[\s，,。.!！?？]/g, '');
  const positive = e => /^(确定|确认|是|刷新|更新|确定刷新|确认刷新|刷新简历|更新简历|使用简历信息|覆盖更新|覆盖|是覆盖掉|是上传并解析)$/.test(label(e));
  const negative = e => /^(取消|否|仅替换简历|仅替换附件|否仅替换附件|否仅上传附件)$/.test(label(e));
  const enabled = e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
  const prompt = d => {
    const text = (d.innerText || '').replace(/\s+/g, '');
    const jdBinding=/简历绑定/.test(text)&&/是否根据您上传的附件信息/.test(text)&&/自动填写至京东简历详情/.test(text)&&/信息自动填写后[，,]?原来的信息将丢失/.test(text);
    return text.length < 600 && /简历|附件/.test(text) && /根据|使用|用|是否/.test(text) && (/刷新|更新|覆盖/.test(text)||jdBinding)
      && !/提交申请|投递岗位|投递职位|申请职位|签署|同意.*协议/.test(text);
  };
  function findDialogs() {
    const dialogs = [...document.querySelectorAll(dialogSelector)].filter(visible);
    // Some sites expose a plain group, not a dialog. Require both the exact
    // overwrite action and attachment-only alternative in a small local container.
    for (const b of [...document.querySelectorAll(buttonSelector)].filter(e => enabled(e) && positive(e))) {
      let d = b.parentElement;
      for (let depth = 0; d && depth < 5 && !d.matches('body,html,main,form'); depth++, d = d.parentElement) {
        const buttons = [...d.querySelectorAll(buttonSelector)].filter(enabled);
        if (visible(d) && prompt(d) && buttons.length <= 4 && buttons.some(negative)) { dialogs.push(d); break; }
      }
    }
    const unique = [...new Set(dialogs)];
    return unique.filter(d => !unique.some(other => other !== d && d.contains(other)));
  }
  function fieldSignature() {
    const fields = [...document.querySelectorAll('input:not([type=file]):not([type=hidden]),textarea,select')]
      .filter(e => !e.closest(dialogSelector) && !activeDialog?.contains(e))
      .map(e => [e.name || e.id, e.value, e.checked]);
    // Alibaba can render parsed sections as read-only text rather than inputs.
    // Limit evidence to resume/form regions; removal of the modal is not evidence.
    const regions = [...document.querySelectorAll('form,main,[role="main"],[class*="resume"],[class*="Resume"]')];
    const text = [];
    for (const root of regions.filter(r => !regions.some(other => other !== r && other.contains(r)))) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || !visible(parent) || activeDialog?.contains(parent) || parent.closest(dialogSelector + ',button,[role="button"],script,style,[aria-live],[role="status"]')) continue;
        const value = node.textContent.trim(); if (value) text.push(value);
      }
    }
    return JSON.stringify([fields, text.join(' ').slice(0, 50000)]);
  }
  function finish(phase) { state.phase = phase; clearInterval(timer); timer = null; }
  function arm(dialog = null) {
    clearInterval(timer); activeDialog = dialog;
    Object.assign(state, { phase: 'awaiting-dialog', confirmed: false, startedAt: Date.now() });
    stableAt = 0; signature = fieldSignature(); changed = false;
    timer = setInterval(inspect, 250);
  }
  function inspect() {
    if (!timer) return;
    if (Date.now() - state.startedAt > 45000) { finish('manual-required'); return; }
    const dialogs = findDialogs(), matches = dialogs.filter(prompt);
    if (!state.confirmed && matches.length === 1) {
      const d = matches[0], candidates = [...d.querySelectorAll(buttonSelector)].filter(e => enabled(e) && positive(e));
      if (handled.has(d)) { finish('manual-required'); return; }
      if (candidates.length !== 1) { finish('manual-required'); return; }
      const rect = candidates[0].getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!top || !(top === candidates[0] || candidates[0].contains(top))) { state.phase = 'manual-required'; return; }
      activeDialog = d; signature = fieldSignature(); changed = false;
      handled.add(d); state.confirmed = true; state.phase = 'refreshing'; stableAt = 0;
      candidates[0].click(); return;
    }
    const busy = [...document.querySelectorAll('[aria-busy="true"],.ant-spin-spinning,.el-loading-mask')].some(visible);
    if (dialogs.length || busy || /正在解析|解析中|正在上传|上传中/.test(document.body?.innerText || '')) { stableAt = 0; return; }
    if (!state.confirmed) { state.phase = 'awaiting-dialog'; return; }
    const next = fieldSignature();
    if (next !== signature) { signature = next; stableAt = Date.now(); changed = true; }
    if (!changed && /解析成功|刷新成功|简历信息已更新/.test(document.body?.innerText || '')) changed = true;
    if (changed && !stableAt) stableAt = Date.now();
    if (changed && Date.now() - stableAt >= 1500) finish('ready');
  }
  function inspectPending() {
    if (timer) return;
    if (state.phase !== 'idle' && state.phase !== 'ready') return;
    const matches = findDialogs().filter(d => prompt(d) && !handled.has(d));
    if (matches.length === 1) { arm(matches[0]); inspect(); }
  }
  Object.defineProperty(state, 'inspectPending', { value: inspectPending });
  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
    const hint = [input.accept, input.name, input.id, input.getAttribute('aria-label'), input.parentElement?.innerText].join(' ');
    if (/pdf|doc|简历|附件|resume/i.test(hint)) arm();
  }, true);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true; queueMicrotask(() => { queued = false; timer ? inspect() : inspectPending(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  inspectPending();
  return true;
}

const INSTALL_RESUME_UPLOAD_OBSERVER = `(${installResumeUploadObserver.toString()})()`;
const READ_RESUME_UPLOAD_STATE = `(()=>{const s=window.__yjtResumeUpload;return s?{phase:s.phase,confirmed:s.confirmed,startedAt:s.startedAt}:null})()`;

async function waitForResumeRefresh(workspace, { timeoutMs = 46000, pollMs = 300 } = {}) {
  const until = Date.now() + timeoutMs;
  let state;
  while (Date.now() < until) {
    state = await workspace.run(READ_RESUME_UPLOAD_STATE);
    if (!state || state.phase === 'idle') return { phase: 'not-observed', confirmed: false };
    if (['ready', 'manual-required'].includes(state.phase)) return state;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { ...state, phase: 'manual-required' };
}
module.exports = { INSTALL_RESUME_UPLOAD_OBSERVER, READ_RESUME_UPLOAD_STATE, waitForResumeRefresh };
