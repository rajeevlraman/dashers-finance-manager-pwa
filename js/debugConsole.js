// js/debugConsole.js
//
// Bug fixes to the long-press-the-title debug console:
//
// 1. POSITIONING: the toggle button/panel used flat `bottom: 10px/60px`,
//    which on any phone doesn't account for .bottom-nav (a fixed, 54px-tall
//    bar pinned to the very bottom of the screen — see .bottom-nav in
//    styles.css) or the iOS home-indicator safe area. That put the 🪵
//    button sitting right on top of/behind the bottom nav's own icons —
//    exactly the kind of thing that looks like "doesn't open properly"
//    even though the element genuinely exists in the DOM. Both now sit
//    above the bottom nav's height plus env(safe-area-inset-bottom).
//
// 2. TEXT-SELECTION CALLOUT: the header's <h1> title is normal selectable
//    text, so holding a finger on it for ~2s is exactly the gesture that
//    triggers the OS's own text-selection magnifier/"Copy" callout on iOS —
//    which pops up on top of, and steals the gesture from, this custom
//    long-press timer. -webkit-touch-callout/user-select are now disabled
//    specifically on the title text (not the whole header, so the
//    hamburger/Backup/Restore buttons keep their normal tap behaviour).
//
// 3. DESKTOP: this only ever listened for touchstart/touchend, so on a
//    mouse-driven browser (no touch events at all) the gesture could never
//    fire in the first place. mousedown/mouseup now arm the same timer.
//
// 4. TWO-STEP REVEAL: a long-press used to only unhide the small 🪵 toggle
//    button — the actual console panel needed a second, separate tap on
//    that button to open. From a person's perspective doing the long-press
//    once, that looked identical to "nothing happened". It now opens the
//    panel directly the first time it's revealed.
//
// 5. STRAY FIRES: no movement/scroll cancellation existed, so starting a
//    scroll gesture from the header (finger drifts rather than staying
//    still) could still fire the 2s timer. touchmove/touchcancel now clear
//    it, same as a normal press-and-hold implementation should.

let debugVisible = false;
let panel, btn;

// Kept out of styles.css (this module creates and styles its own elements
// entirely in JS, on purpose, so it stays a single drop-in file with no
// separate CSS to keep in sync) but expressed as a real calc() so it tracks
// .bottom-nav's actual 54px height + safe-area inset instead of a guess.
const ABOVE_BOTTOM_NAV = 'calc(54px + 12px + env(safe-area-inset-bottom, 0px))';

export function setupDebugConsole() {
  // --- Create hidden elements
  btn = document.createElement('button');
  btn.textContent = '🪵';
  btn.id = 'debugToggle';
  btn.type = 'button';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: ABOVE_BOTTOM_NAV,
    right: '10px',
    zIndex: '10500', // above header's 10200 and .bottom-nav's 1000
    fontSize: '20px',
    borderRadius: '50%',
    border: 'none',
    background: '#3498db',
    color: '#fff',
    width: '44px',
    height: '44px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    display: 'none'
  });
  document.body.appendChild(btn);

  panel = document.createElement('div');
  panel.id = 'debugPanel';
  Object.assign(panel.style, {
    display: 'none',
    position: 'fixed',
    bottom: `calc(${ABOVE_BOTTOM_NAV} + 50px)`,
    right: '10px',
    zIndex: '10499',
    width: '90%',
    maxHeight: '40%',
    overflowY: 'auto',
    background: 'rgba(0,0,0,0.85)',
    color: '#0f0',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '8px',
    borderRadius: '6px',
    boxShadow: '0 0 10px rgba(0,0,0,0.5)',
    // Without an explicit min-height, an empty/near-empty panel (see the
    // "nothing was ever captured" note below) just collapses down to its
    // padding — a couple of pixels tall, which reads as "a single line" —
    // rather than looking like an actual open console.
    minHeight: '120px'
  });

  const panelHeader = document.createElement('div');
  Object.assign(panelHeader.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
    paddingBottom: '6px',
    borderBottom: '1px solid rgba(255,255,255,0.25)',
    color: '#fff',
    fontWeight: 'bold'
  });
  panelHeader.innerHTML = `<span>🪵 Debug Console</span>`;
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.type = 'button';
  Object.assign(clearBtn.style, {
    background: 'rgba(255,255,255,0.15)',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
    cursor: 'pointer'
  });
  clearBtn.addEventListener('click', () => { logList.innerHTML = ''; });
  panelHeader.appendChild(clearBtn);
  panel.appendChild(panelHeader);

  const logList = document.createElement('div');
  panel.appendChild(logList);

  document.body.appendChild(panel);

  // Stop the header <h1> from triggering the OS text-selection callout on
  // a long press — see fix #2 above. Scoped to the title only.
  const title = document.querySelector('header h1');
  if (title) {
    Object.assign(title.style, {
      webkitTouchCallout: 'none',
      webkitUserSelect: 'none',
      userSelect: 'none'
    });
  }

  // --- Toggle console visibility (the 🪵 button, once revealed)
  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // --- Long-press on header to reveal + open the console
  let pressTimer = null;

  function arm(target) {
    // Don't arm from a header button (hamburger / Backup / Restore) — a
    // long-press-then-release on those should just behave like a normal
    // tap, not also toggle the debug console underneath it.
    if (!target.closest('header') || target.closest('button')) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(toggleButton, 2000);
  }

  function disarm() {
    clearTimeout(pressTimer);
    pressTimer = null;
  }

  document.addEventListener('touchstart', e => arm(e.target), { passive: true });
  document.addEventListener('touchmove', disarm, { passive: true });
  document.addEventListener('touchend', disarm);
  document.addEventListener('touchcancel', disarm);

  // Mouse equivalent, for desktop browsers (no touch events fire there at
  // all, so the gesture previously couldn't work outside a touchscreen).
  document.addEventListener('mousedown', e => arm(e.target));
  document.addEventListener('mouseup', disarm);
  document.addEventListener('mouseleave', disarm);

  function toggleButton() {
    debugVisible = !debugVisible;
    btn.style.display = debugVisible ? 'flex' : 'none';
    // Open (or close) the panel itself in the same gesture — see fix #4
    // above. Without this, revealing the button for the first time looked
    // exactly like nothing had happened.
    panel.style.display = debugVisible ? 'block' : 'none';
  }

  // --- Mirror console output (and uncaught errors) to the on-screen panel
  //
  // This codebase doesn't actually call console.log anywhere (0 hits) — its
  // diagnostics are almost entirely console.error (76 call sites) and
  // console.warn (25 call sites), e.g. every catch block across
  // transactions.js/vehicles.js/vehicleMatchTool.js/etc. Only patching
  // console.log meant this panel was capturing essentially nothing, which
  // is why it looked like an empty single line with no content. It now
  // mirrors log/warn/error, plus window 'error' and 'unhandledrejection'
  // (uncaught exceptions and rejected promises never go through any
  // console.* call at all, and are usually the most useful thing to see
  // when something's actually gone wrong).
  function addLine(level, args) {
    if (!logList) return;
    const line = document.createElement('div');
    const colors = { log: '#0f0', warn: '#facc15', error: '#f87171' };
    line.style.color = colors[level] || '#0f0';
    line.style.whiteSpace = 'pre-wrap';
    line.style.wordBreak = 'break-word';
    line.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
    line.style.padding = '2px 0';
    const time = new Date().toLocaleTimeString();
    const text = args
      .map(a => {
        if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      })
      .join(' ');
    line.textContent = `[${time}] ${text}`;
    logList.appendChild(line);
    if (logList.childNodes.length > 300) logList.removeChild(logList.firstChild);
    panel.scrollTop = panel.scrollHeight;
  }

  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => { originalConsole.log(...args); addLine('log', args); };
  console.warn = (...args) => { originalConsole.warn(...args); addLine('warn', args); };
  console.error = (...args) => { originalConsole.error(...args); addLine('error', args); };

  window.addEventListener('error', e => {
    addLine('error', [`Uncaught: ${e.message} (${e.filename}:${e.lineno})`]);
  });
  window.addEventListener('unhandledrejection', e => {
    addLine('error', [`Unhandled rejection: ${e.reason?.message || e.reason}`]);
  });
}
