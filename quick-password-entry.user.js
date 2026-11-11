// ==UserScript==
// @name         快捷随机密码填写
// @namespace    local.password-hotkey
// @version      1.1.1
// @description  在管理器菜单录制自己的快捷键，随机生成密码覆盖输入内容，并交替包含特殊符号。
// @author       ZOUYIQAQ
// @license      MIT
// @homepageURL  https://github.com/ZOUYIQAQ/quick-password-entry-js
// @supportURL   https://github.com/ZOUYIQAQ/quick-password-entry-js/issues
// @updateURL    https://raw.githubusercontent.com/ZOUYIQAQ/quick-password-entry-js/main/quick-password-entry.user.js
// @downloadURL  https://raw.githubusercontent.com/ZOUYIQAQ/quick-password-entry-js/main/quick-password-entry.user.js
// @match        *://*/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// ==/UserScript==

(() => {
  'use strict';
  const PASSWORD_LENGTH = 20;
  const GROUPS = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789'];
  const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
  const STORAGE_KEY = 'passwordHotkey.v1';
  const DEFAULT_SHORTCUT = ['ControlLeft', 'AltLeft', 'Enter'];
  const MODIFIERS = ['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight'];
  const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const pressed = new Set();
  let shortcut = validateShortcut(GM_getValue(STORAGE_KEY, null)) || [...DEFAULT_SHORTCUT];
  let settings = null;
  let latched = false;
  let includeSymbols = true;

  // 将两种 Enter 统一处理，其他按键保留物理位置。
  function normalizeCode(code) {
    return code === 'NumpadEnter' ? 'Enter' : code;
  }

  // 校验存储和录制结果，只允许包含修饰键的组合，避免普通打字触发。
  function validateShortcut(value) {
    if (!Array.isArray(value) || value.length < 2 || value.length > 8) return null;
    if (!value.every(code => typeof code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(code) && code !== 'Unidentified')) return null;
    const codes = [...new Set(value.map(normalizeCode))];
    return codes.length >= 2 && codes.some(code => MODIFIERS.includes(code)) ? codes : null;
  }

  // 用当前平台的键名显示组合，明确区分左右按键。
  function formatShortcut(codes) {
    const names = {
      ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl',
      AltLeft: IS_MAC ? '左 Option（⌥）' : '左 Alt', AltRight: IS_MAC ? '右 Option（⌥）' : '右 Alt',
      MetaLeft: IS_MAC ? '左 Command（⌘）' : '左 Win', MetaRight: IS_MAC ? '右 Command（⌘）' : '右 Win',
      ShiftLeft: '左 Shift', ShiftRight: '右 Shift', Enter: 'Enter', Space: '空格',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '退格',
    };
    return codes.map(code => names[code] || code.replace(/^(Key|Digit)/, '')).join(' ＋ ');
  }

  // 同时核对按下的物理键和系统修饰状态，避免多按一个键仍触发。
  function matchesShortcut(event) {
    if (pressed.size !== shortcut.length || !shortcut.every(code => pressed.has(code))) return false;
    return [['Control', 'ctrlKey'], ['Alt', 'altKey'], ['Shift', 'shiftKey'], ['Meta', 'metaKey']]
      .every(([prefix, flag]) => Boolean(event[flag]) === shortcut.some(code => code.startsWith(prefix)));
  }

  // 将录制状态同步到弹窗，只有合法组合才允许保存。
  function updateSettings(message = '', visualState = '') {
    if (!settings) return;
    settings.current.textContent = formatShortcut(shortcut);
    renderShortcut(settings.preview, settings.draft);
    settings.recordLabel.textContent = settings.recording ? '正在聆听按键' : '录制快捷键';
    settings.record.disabled = settings.recording;
    settings.save.disabled = settings.recording || !validateShortcut(settings.draft);
    const validDraft = validateShortcut(settings.draft);
    const changed = validDraft && (validDraft.length !== shortcut.length || validDraft.some(code => !shortcut.includes(code)));
    const state = visualState || (settings.recording ? 'recording' : settings.draft?.length && !validDraft ? 'invalid' : changed ? 'ready' : 'idle');
    settings.dialog.dataset.state = state;
    settings.badge.textContent = { idle: '等待录制', recording: '录制中', ready: '待保存', saved: '已保存', invalid: '请重新录制' }[state];
    settings.status.textContent = message;
  }

  // 使用独立按键色块展示组合，保留中文左右键名和无障碍读法。
  function renderShortcut(output, codes) {
    output.replaceChildren();
    if (!codes?.length) {
      const placeholder = document.createElement('span');
      placeholder.className = 'placeholder';
      placeholder.textContent = settings.recording ? '按下你的组合键' : '尚未录制';
      output.append(placeholder);
      return;
    }
    for (const [index, code] of codes.entries()) {
      if (index) {
        const plus = document.createElement('span');
        plus.className = 'plus';
        plus.setAttribute('aria-hidden', 'true');
        plus.textContent = '+';
        output.append(plus);
      }
      const key = document.createElement('kbd');
      key.textContent = formatShortcut([code]);
      output.append(key);
    }
  }

  // 开始录制时清空按键状态；密码填写在弹窗打开期间暂停。
  function startRecording() {
    resetKeys();
    settings.recording = true;
    settings.draft = null;
    updateSettings('请按住完整组合键，再松开任一键。Esc 取消录制。');
  }

  // 取消当前录制，保留原来已保存的快捷键。
  function cancelRecording() {
    settings.recording = false;
    settings.draft = [...shortcut];
    resetKeys();
    updateSettings('录制已取消，原快捷键未变。');
  }

  // 用户明确保存后写入管理器存储，其他网站和标签页通过变更监听同步。
  function saveShortcut() {
    const next = validateShortcut(settings?.draft);
    if (!next || settings.recording) return;
    try {
      GM_setValue(STORAGE_KEY, next);
      shortcut = next;
      resetKeys();
      updateSettings('已保存，所有网站均使用这个快捷键。', 'saved');
    } catch {
      updateSettings('保存失败，请检查油猴管理器权限后重试。');
    }
  }

  // 恢复默认只修改预览，需要点击保存才应用。
  function previewDefault() {
    settings.recording = false;
    settings.draft = [...DEFAULT_SHORTCUT];
    resetKeys();
    updateSettings('已选择默认组合，点击保存后生效。');
  }

  // 关闭弹窗并恢复原焦点，不保存尚未确认的录制结果。
  function closeSettings() {
    if (!settings) return;
    const { host, dialog, previousFocus } = settings;
    settings = null;
    dialog.close();
    host.remove();
    resetKeys();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  // 防止原页面样式和交互干扰设置面板，使用隔离样式的原生模态对话框。
  function openSettings() {
    if (settings) { settings.dialog.focus(); return; }
    const host = document.createElement('div');
    host.dataset.passwordHotkeySettings = '';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{all:initial;color-scheme:light dark}
      *{box-sizing:border-box}
      dialog{--surface:#f9ebe9;--container:#f0ddda;--key:#fff7f5;--primary:#8e4d52;--on-primary:#fff;--tonal:#f3d0ce;--on-tonal:#663b3d;--text:#302020;--muted:#735d5c;--scrim:#2d1a1c66;--error:#9c3030;--error-surface:#ffdad6;--shadow:#44252720;width:min(472px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain;padding:28px;border:0;border-radius:28px;background:var(--surface);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 12px 48px var(--shadow);outline:none}
      dialog::backdrop{background:var(--scrim)}
      h2,p{margin:0}h2{font-size:24px;line-height:32px;font-weight:550;letter-spacing:-.5px}
      svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none;pointer-events:none}
      .heading{display:flex;align-items:flex-start;gap:16px}.heading-copy{flex:1;padding-top:2px}.heading-copy p{color:var(--muted);margin-top:4px;font-size:13px}
      .icon-container{display:grid;place-items:center;width:48px;height:48px;border-radius:16px;color:var(--on-tonal);background:var(--tonal);flex:none}.icon-container svg{width:26px;height:26px}
      button{position:relative;isolation:isolate;display:inline-flex;justify-content:center;align-items:center;gap:8px;min-height:44px;padding:10px 20px;border:0;border-radius:999px;outline:none;font:inherit;font-size:14px;font-weight:500;line-height:20px;letter-spacing:.1px;background:transparent;color:var(--primary);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color 150ms ease,opacity 150ms ease,transform 150ms ease}
      button::after{content:'';position:absolute;inset:0;z-index:-1;border-radius:inherit;background:currentColor;opacity:0;pointer-events:none;transition:opacity 150ms ease}
      button:hover:not(:disabled)::after{opacity:.08}button:active:not(:disabled)::after{opacity:.12}button:active:not(:disabled){transform:scale(.98)}button:focus-visible{outline:3px solid var(--primary);outline-offset:4px}button:disabled{opacity:.4;cursor:default}
      button.primary{background:var(--primary);color:var(--on-primary)}button.tonal{background:var(--tonal);color:var(--on-tonal)}button.icon-button{width:40px;height:40px;min-height:40px;padding:8px;margin:-4px -8px 0 0;color:var(--muted)}
      .current{margin:24px 0 20px;font-size:12px;line-height:20px;color:var(--muted)}.current-label{display:block;margin-bottom:4px}#current{color:var(--text);font-size:13px;font-weight:500;overflow-wrap:anywhere}
      .recorder{background:var(--container);padding:20px;border-radius:24px;transition:background-color 180ms ease}
      .recorder-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:500;color:var(--muted)}.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;color:var(--on-tonal);background:var(--tonal);font-size:11px;line-height:16px;white-space:nowrap}.badge::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}
      #preview{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:8px;min-height:100px;padding:20px 0;overflow-wrap:anywhere}
      kbd{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 12px;border:0;border-radius:12px;background:var(--key);color:var(--text);font:inherit;font-size:13px;font-weight:500;line-height:20px;max-width:100%;overflow-wrap:anywhere}.plus{color:var(--muted);font-size:16px;font-weight:400}.placeholder{color:var(--muted);font-size:15px;line-height:24px;text-align:center}
      #record{display:flex;margin:0 auto;min-width:164px}.record-dot{display:block;width:8px;height:8px;border-radius:50%;background:currentColor}
      #help{margin-top:16px;color:var(--muted);font-size:12px;line-height:20px}.secondary-help{display:block;margin-top:4px;font-size:11px;opacity:.9}
      #status{min-height:44px;padding:14px 0 0;color:var(--muted);font-size:12px;line-height:20px}.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px}.actions #default{margin-left:-12px;padding-inline:12px}.actions #save{min-width:120px}
      dialog[data-state=recording] .recorder{background:var(--tonal)}dialog[data-state=recording] #record{opacity:1;color:var(--primary);background:var(--key)}dialog[data-state=recording] .badge::before{animation:pulse 1.2s ease-in-out infinite}dialog[data-state=ready] #status,dialog[data-state=saved] #status{color:var(--primary)}dialog[data-state=invalid] .badge{background:var(--error-surface);color:var(--error)}
      @keyframes pulse{50%{opacity:.25}}
      @media(prefers-color-scheme:dark){dialog{--surface:#2b2021;--container:#3b2b2d;--key:#50383b;--primary:#f1b6b7;--on-primary:#532328;--tonal:#603e43;--on-tonal:#ffdad9;--text:#f6e1df;--muted:#d5bebb;--scrim:#0009;--error:#ffb4a7;--error-surface:#5d302a;--shadow:#0004}}
      @media(max-width:400px){dialog{padding:24px}.heading{gap:12px}.icon-container{width:40px;height:40px;border-radius:14px}h2{font-size:22px;line-height:28px}.heading-copy p{font-size:12px}.recorder{padding:16px}#preview{gap:6px}kbd{padding:8px 10px;font-size:12px}.actions{gap:8px}}
      @media(prefers-reduced-motion:reduce){*,*::after{animation:none!important;transition:none!important}}
      @media(forced-colors:active){button{outline:1px solid ButtonText}.recorder,kbd{outline:1px solid CanvasText}}
    </style><dialog aria-labelledby="title" aria-describedby="help" tabindex="-1">
      <header class="heading"><span class="icon-container" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10"/></svg></span><div class="heading-copy"><h2 id="title">快捷键设置</h2><p>一键填写密码，用你顺手的组合</p></div><button id="close" class="icon-button" type="button" aria-label="关闭设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
      <div class="current"><span class="current-label">当前使用</span><output id="current"></output></div>
      <section class="recorder" aria-label="快捷键录制"><div class="recorder-heading"><span>新的快捷键</span><span id="badge" class="badge" aria-hidden="true">等待录制</span></div><output id="preview" aria-label="待保存的快捷键" aria-live="polite"></output><button id="record" class="tonal" type="button"><span class="record-dot" aria-hidden="true"></span><span id="record-label">录制快捷键</span></button></section>
      <p id="help">点击录制，按住完整组合键，再松开任一键。<span class="secondary-help">至少包含一个修饰键 · 区分左右键 · 两种 Enter 通用</span></p>
      <p id="status" role="status" aria-live="polite"></p>
      <footer class="actions"><button id="default" type="button">恢复默认</button><button id="save" class="primary" type="button">保存快捷键<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button></footer>
    </dialog>`;
    settings = {
      host, dialog: root.querySelector('dialog'), previousFocus: document.activeElement,
      current: root.getElementById('current'), preview: root.getElementById('preview'),
      record: root.getElementById('record'), save: root.getElementById('save'), status: root.getElementById('status'),
      recordLabel: root.getElementById('record-label'), badge: root.getElementById('badge'),
      recording: false, draft: [...shortcut],
    };
    settings.record.addEventListener('click', startRecording);
    settings.save.addEventListener('click', saveShortcut);
    root.getElementById('default').addEventListener('click', previewDefault);
    root.getElementById('close').addEventListener('click', closeSettings);
    settings.dialog.addEventListener('cancel', onDialogCancel);
    document.documentElement.append(host);
    resetKeys();
    updateSettings('设置仅保存快捷键，不保存生成的密码。');
    settings.dialog.showModal();
    settings.dialog.focus();
  }

  // 原生对话框收到 Esc 时按当前状态取消录制或关闭。
  function onDialogCancel(event) {
    event.preventDefault();
    if (settings.recording) cancelRecording();
    else closeSettings();
  }

  // 录制期间拦截网页按键，松键前持续展示当前完整组合。
  function recordKeyDown(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === 'Escape') { cancelRecording(); return; }
    const code = normalizeCode(event.code);
    if (!code || code === 'Unidentified') return;
    pressed.add(code);
    settings.draft = [...pressed];
    updateSettings('松开任一键完成录制，然后点击保存。');
  }

  // 按键首次松开即结束录制，不让设置界面里的按键生成密码。
  function finishRecording(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!pressed.has(normalizeCode(event.code))) return;
    settings.recording = false;
    resetKeys();
    updateSettings(validateShortcut(settings.draft) ? '录制完成，点击保存后生效。' : '组合无效：至少两个键，并包含 Ctrl、Option/Alt、Shift 或 Command/Win。请重新录制。');
    settings.record.focus();
  }

  // 标签页之间同步用户已保存的设置，不覆盖面板中尚未保存的草稿。
  function onShortcutChanged(name, oldValue, newValue) {
    shortcut = validateShortcut(newValue) || [...DEFAULT_SHORTCUT];
    resetKeys();
    if (settings && !settings.recording) updateSettings('已同步保存的快捷键。');
  }

  // 使用密码学随机源和拒绝采样，避免取模偏差。
  function randomIndex(limit) {
    const buffer = new Uint32Array(1);
    const ceiling = 0x100000000 - (0x100000000 % limit);
    do { crypto.getRandomValues(buffer); } while (buffer[0] >= ceiling);
    return buffer[0] % limit;
  }

  // 保证各类别至少出现一次，再随机打乱密码。
  function generatePassword(length, symbols) {
    const groups = symbols ? [...GROUPS, SYMBOLS] : GROUPS;
    const alphabet = groups.join('');
    const result = [];
    for (const group of groups) result.push(group[randomIndex(group.length)]);
    while (result.length < length) result.push(alphabet[randomIndex(alphabet.length)]);
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result.join('');
  }

  // 从事件路径定位焦点，兼容开放的 Shadow DOM 和可编辑区域子节点。
  function findEditor(event) {
    for (const node of event.composedPath()) {
      if (node?.nodeType !== 1) continue;
      if (node.matches('input, textarea')) {
        if (node.disabled || node.readOnly || node.closest('[inert]')) return null;
        // 不要求密码类型；仅排除按钮、文件选择等不能打字的控件。
        if (node.tagName === 'INPUT' && ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'range', 'color', 'image'].includes(node.type)) return null;
        return node;
      }
      if (node.isContentEditable) {
        let editor = node;
        while (editor.parentElement?.isContentEditable) editor = editor.parentElement;
        return editor.closest('[inert]') ? null : editor;
      }
    }
    return null;
  }

  // 发送可冒泡且能跨 Shadow DOM 的输入事件，供框架更新绑定状态。
  function dispatchInput(editor, type, value, cancelable = false) {
    const view = editor.ownerDocument.defaultView;
    return editor.dispatchEvent(new view.InputEvent(type, {
      bubbles: true, composed: true, cancelable,
      inputType: 'insertReplacementText', data: value,
    }));
  }

  // 使用原生 setter 绕过 React 的实例值跟踪，并通知 React/Vue 常见绑定。
  function fillEditor(editor, value) {
    const doc = editor.ownerDocument;
    const view = doc.defaultView;
    if (editor.matches('input, textarea')) {
      if (!dispatchInput(editor, 'beforeinput', value, true)) return false;
      const prototype = editor.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      const previous = editor.value;
      setter.call(editor, value);
      // 数字或日期等控件可能由浏览器拒绝密码，恢复原值，避免误清空。
      if (editor.value !== value) {
        setter.call(editor, previous);
        return false;
      }
      dispatchInput(editor, 'input', value);
      editor.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
      return true;
    }
    const selection = editor.getRootNode().getSelection?.() || doc.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    // 优先使用浏览器编辑命令，让富文本编辑器接收到自身编辑流程。
    if (doc.execCommand('insertText', false, value)) return true;
    if (!dispatchInput(editor, 'beforeinput', value, true)) return false;
    editor.textContent = value;
    dispatchInput(editor, 'input', value);
    return true;
  }

  // 清理按键状态，防止切换窗口或页面后残留按下状态。
  function resetKeys() {
    pressed.clear();
    latched = false;
  }

  // 只在输入框聚焦且已录制的物理键完整匹配时填写密码。
  function onKeyDown(event) {
    if (!event.isTrusted) return;
    if (settings) {
      if (settings.recording) recordKeyDown(event);
      return;
    }
    if (event.isComposing) return;
    pressed.add(normalizeCode(event.code));
    if (!matchesShortcut(event)) return;
    const editor = findEditor(event);
    if (!editor) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (latched || event.repeat) return;
    latched = true;
    const length = editor.maxLength >= 0 ? Math.min(PASSWORD_LENGTH, editor.maxLength) : PASSWORD_LENGTH;
    if (length < 4) return;
    if (fillEditor(editor, generatePassword(length, includeSymbols))) includeSymbols = !includeSymbols;
  }

  // 松开任一组合键后允许下一次触发，保留其他仍按下的键。
  function onKeyUp(event) {
    if (!event.isTrusted) return;
    if (settings?.recording) { finishRecording(event); return; }
    const code = normalizeCode(event.code);
    pressed.delete(code);
    if (shortcut.includes(code)) latched = false;
  }

  // 窗口失焦时取消未完成的录制，避免遗留不可用的按键状态。
  function onWindowBlur() {
    if (settings?.recording) cancelRecording();
    else resetKeys();
  }

  // 页面隐藏时重置组合键状态。
  function onVisibilityChange() {
    if (document.hidden) onWindowBlur();
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  // 只处理窗口自身失焦，不能因输入框之间切换而清空仍按住的修饰键。
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('visibilitychange', onVisibilityChange, true);
  GM_addValueChangeListener(STORAGE_KEY, onShortcutChanged);
  if (window.top === window.self) GM_registerMenuCommand('设置密码填写快捷键', openSettings);
})();
