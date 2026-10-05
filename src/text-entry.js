// Electron does not support native prompt(). Keep text entry in the app window.
(function () {
  let active = false;
  window.TextEntry = {
    request({ title, label, value = '', hint = '', required = false, maxLength = 80, pattern } = {}) {
      if (active) return Promise.resolve(null);
      active = true;
      const previousFocus = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.id = 'textEntryDialog';
      dialog.className = 'dialog text-entry-dialog';
      dialog.setAttribute('aria-labelledby', 'textEntryTitle');
      const form = document.createElement('form');
      const heading = document.createElement('h2');
      heading.id = 'textEntryTitle';
      heading.textContent = title || '填写信息';
      const field = document.createElement('label');
      field.htmlFor = 'textEntryInput';
      field.textContent = label || title || '内容';
      const input = document.createElement('input');
      input.id = 'textEntryInput';
      input.type = 'text';
      input.value = value;
      input.maxLength = maxLength;
      input.required = required;
      input.autocomplete = 'off';
      if (pattern) input.pattern = pattern;
      const description = document.createElement('p');
      description.id = 'textEntryHint';
      description.className = 'text-entry-hint';
      description.textContent = hint;
      description.hidden = !hint;
      if (hint) input.setAttribute('aria-describedby', description.id);
      const actions = document.createElement('div');
      actions.className = 'dialog-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ghost-button';
      cancel.textContent = '取消';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'primary-button';
      submit.textContent = '确定';
      actions.append(cancel, submit);
      form.append(heading, field, input, description, actions);
      dialog.append(form);
      return new Promise((resolve, reject) => {
        let finished = false;
        function finish(result) {
          if (finished) return;
          finished = true;
          if (dialog.open) dialog.close();
          dialog.remove();
          active = false;
          if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
          resolve(result);
        }
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (required && !input.value.trim()) {
            input.setCustomValidity('请填写内容');
            input.reportValidity();
            return;
          }
          finish(input.value.trim());
        });
        input.addEventListener('input', () => input.setCustomValidity(''));
        // Enter during Chinese IME composition selects a candidate, not submit.
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
        });
        cancel.addEventListener('click', () => finish(null));
        dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
        dialog.addEventListener('close', () => finish(null));
        try {
          document.body.append(dialog);
          dialog.showModal();
          input.focus();
          input.select();
        } catch (error) {
          dialog.remove();
          active = false;
          reject(error);
        }
      });
    }
  };
})();
