/**
 * MRU Tab Switcher — release watcher.
 *
 * An extension is told when its shortcut is pressed but never when the keys
 * are released. Brave ends a tab cycle when you let go of Ctrl, so this
 * listener reports that moment to the background. It only runs if the user
 * turned on "End the cycle when I let go of Ctrl" in the settings and allowed
 * the site access that needs (background.js registers it then).
 *
 * It is idle except while a cycle is in progress (the background asks it to
 * watch), it never reads or changes the page, and the only thing it sends is
 * "the cycle should end now":
 *   - every held modifier (Ctrl, Alt, Cmd) has been released,
 *   - a modifier was pressed afresh, which means it was released somewhere this
 *     page couldn't see, such as the address bar,
 *   - or the mouse was pressed, which also ends a cycle in Brave.
 */

(() => {
  const MODIFIERS = new Set(['Control', 'Alt', 'Meta']);

  /** The cycle being watched, or null when idle. */
  let watchedCycle = null;

  function endCycle() {
    const cycleId = watchedCycle;
    watchedCycle = null;
    try {
      chrome.runtime.sendMessage({ type: 'cycle-end', cycleId }).catch(() => {});
    } catch {
      // The extension was reloaded or removed, so this copy is orphaned.
    }
  }

  // Capture phase on the window, so the page can't hide these events from us.
  addEventListener('keyup', (event) => {
    if (watchedCycle !== null && !event.ctrlKey && !event.altKey && !event.metaKey) endCycle();
  }, true);

  addEventListener('keydown', (event) => {
    if (watchedCycle !== null && MODIFIERS.has(event.key) && !event.repeat) endCycle();
  }, true);

  addEventListener('mousedown', () => {
    if (watchedCycle !== null) endCycle();
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'cycle-watch') {
      watchedCycle = message.cycleId;
      // Only the top frame answers: its hasFocus() also covers focus inside
      // child frames, and tells the background whether keys will reach us.
      if (window === top) reply({ focused: document.hasFocus() });
    } else if (message?.type === 'cycle-unwatch') {
      watchedCycle = null;
    }
  });
})();
