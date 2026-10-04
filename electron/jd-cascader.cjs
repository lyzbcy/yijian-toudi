function normalizeCascaderPath(value) {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split('/') : null;
  if (!parts || !parts.length || parts.length > 6 || parts.some(p => typeof p !== 'string' || !p.trim() || p.trim().length > 100 || p.includes('/'))) return null;
  return parts.map(p => p.trim());
}

// Serialized into the site's own document. No React/internal-state assignment.
async function fillJdCascader(request) {
  const path = normalizeCascaderPath(request.path || request.value);
  const expected = path ? path.join(' / ') : '';
  const base = { written: false, expected, observed: '', changed: false };
  const fail = (error, extra = {}) => ({ ...base, error, ...extra });
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const visible = e => Boolean(e?.getClientRects().length) && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]');
  const menus = () => [...document.querySelectorAll('.ant-cascader-menus')].filter(visible);
  const label = e => (e?.textContent || '').trim();
  const read = () => resolveJdWidgetRow(request)?.querySelector('.ant-cascader-input')?.value || '';
  let picker;
  if (!path) return fail('cascader-path-invalid');
  const row = resolveJdWidgetRow(request);
  if (!row || !visible(row)) return fail('row-missing-hidden-or-ambiguous');
  const pickers = [...row.querySelectorAll('.ant-cascader-picker')];
  if (pickers.length !== 1) return fail('cascader-picker-missing-or-ambiguous');
  picker = pickers[0];
  const input = picker.querySelector('.ant-cascader-input');
  if (!input || input.disabled || picker.classList.contains('ant-cascader-picker-disabled')) return fail('cascader-disabled-or-missing');
  const before = read();
  const samePath = value => { const p = normalizeCascaderPath(value); return p && p.length === path.length && p.every((s, i) => s === path[i]); };
  const alreadyMatching = samePath(before);
  // Ant3 on the real site has no popup ID/ARIA association. Require zero other
  // popups before this exact picker click, then exactly one visible new menu.
  if (menus().length || [...document.querySelectorAll('.ant-select-dropdown,.ant-calendar-picker-container')].some(visible)) return fail('another-popup-open');
  try {
    picker.click();
    let popup; const deadline = Date.now() + 1800;
    while (Date.now() < deadline) { const xs = menus(); if (xs.length > 1) return fail('cascader-popup-ambiguous'); if (xs.length === 1) { popup = xs[0]; break; } await pause(40); }
    if (!popup) return fail('cascader-popup-missing');
    for (let depth = 0; depth < path.length; depth++) {
      if (!resolveJdWidgetRow(request) || !picker.isConnected || menus().length !== 1 || menus()[0] !== popup) return fail('cascader-context-changed', { observed: read(), changed: read() !== before });
      const columns = [...popup.querySelectorAll('.ant-cascader-menu')].filter(visible);
      if (columns.length <= depth) return fail('cascader-column-missing');
      for(let ancestor=0;ancestor<depth;ancestor++){
        const active=[...columns[ancestor].children].filter(e=>e.classList.contains('ant-cascader-menu-item-active'));
        if(active.length!==1||label(active[0])!==path[ancestor])return fail('cascader-ancestor-mismatch');
      }
      const candidates = [...columns[depth].children].filter(e => e.matches('.ant-cascader-menu-item[role="menuitem"]') && label(e) === path[depth]);
      if (candidates.length !== 1) return fail(candidates.length ? 'cascader-option-ambiguous' : 'cascader-option-missing', { depth, optionCount: columns[depth].children.length });
      const option = candidates[0];
      if (!visible(option) || option.classList.contains('ant-cascader-menu-item-disabled') || option.getAttribute('aria-disabled') === 'true') return fail('cascader-option-disabled-or-hidden');
      const branch = option.classList.contains('ant-cascader-menu-item-expand') || Boolean(option.querySelector('.ant-cascader-menu-item-expand-icon'));
      if (depth === path.length - 1) {
        if (branch) return fail('cascader-path-incomplete'); // Never select an ancestor as a leaf.
        if(alreadyMatching&&samePath(read()))return {...base,written:true,observed:expected,rawObserved:read(),action:'already-matching'};
        option.click(); await pause(450);
        const observed = read();
        return { ...base, written: true, observed: samePath(observed) ? expected : observed, rawObserved: observed, changed: observed !== before, action: 'selected-leaf', error: samePath(observed) ? null : 'cascader-readback-mismatch' };
      }
      if (!branch) return fail('cascader-path-too-deep');
      option.click();
      const until = Date.now() + 1800;
      while (Date.now() < until && [...popup.querySelectorAll('.ant-cascader-menu')].filter(visible).length <= depth + 1) await pause(40);
      if (read() !== before) return fail('cascader-intermediate-committed', { observed: read(), changed: true });
    }
    return fail('cascader-path-empty');
  } catch (error) {
    return fail('cascader-control-error', { observed: read(), changed: read() !== before });
  } finally {
    if (menus().length) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      // Site-native outside event on a non-action surface; never save/submit.
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await pause(80);
    }
  }
}
module.exports = { normalizeCascaderPath, fillJdCascader };
