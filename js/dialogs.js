// js/dialogs.js
// Replaces the browser's native alert() with a centred in-app message box so
// notices look consistent (especially in the installed phone app, where the
// native popup shows the page address and blocks everything).
//
// alert() never returns a value and callers don't depend on it blocking, so
// it is safe to make non-blocking. Messages are queued so none are lost.
// confirm()/prompt() are NOT replaced: they must return an answer
// synchronously, so swapping them needs per-call-site changes.
// Falls back to the native alert if the page isn't ready yet.

const nativeAlert = window.alert ? window.alert.bind(window) : () => {};
const queue = [];
let showing = false;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showNext() {
  if (showing || !queue.length) return;
  showing = true;
  const msg = queue.shift();
  const prevFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.5);';
  overlay.innerHTML =
    '<div style="background:var(--card-bg,#fff);color:var(--text-color,#222);max-width:420px;width:100%;border-radius:14px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.35);font-family:inherit;">' +
      '<div class="dlg-msg" style="white-space:pre-wrap;word-break:break-word;line-height:1.45;font-size:15px;max-height:60vh;overflow:auto;">' + esc(msg) + '</div>' +
      '<div style="text-align:right;margin-top:16px;"><button type="button" class="dlg-ok" style="min-width:88px;min-height:40px;padding:8px 18px;border:0;border-radius:8px;background:var(--accent,#2563eb);color:#fff;font-size:15px;cursor:pointer;">OK</button></div>' +
    '</div>';
  document.body.appendChild(overlay);

  const ok = overlay.querySelector('.dlg-ok');
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    showing = false;
    try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) { /* ignore */ }
    showNext();
  };
  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  document.addEventListener('keydown', onKey, true);
  ok.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  ok.focus();
}

window.alert = function (message) {
  const text = message === undefined ? '' : String(message);
  if (!document.body) { nativeAlert(text); return; }
  queue.push(text);
  showNext();
};
