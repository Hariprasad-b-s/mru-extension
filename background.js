/**
 * Pure MRU Tab Switcher — background service worker.
 *
 * Tracks tabs in Most-Recently-Used order and, when the keyboard command
 * fires, switches to the previously used tab in the current window; pressing
 * it again within a second goes one tab further back (see CYCLE_PAUSE_MS).
 * Switching never leaves the focused window. It never touches page content:
 * no content scripts, no DOM injection, no overlays.
 *
 * MV3 service workers are shut down when idle, so the MRU stack is mirrored
 * to chrome.storage.session (in-memory, cleared on browser restart) and
 * restored whenever the worker wakes up.
 *
 * USING CTRL+TAB (one-time setup)
 * Chrome won't let an extension ship Ctrl+Tab as its default shortcut (the
 * manifest's suggested key is dropped because it clashes with Chrome's own
 * "next tab"), and the chrome://extensions/shortcuts page refuses Tab. The
 * page's own API does accept it, though, and the binding then overrides
 * Chrome's Ctrl+Tab and survives restarts. scripts/set-ctrl-tab-shortcut.js
 * sets it: open chrome://extensions/shortcuts, open DevTools (Ctrl+Shift+J,
 * or Cmd+Option+J on macOS), and paste that whole file into the Console.
 *
 * The extension's ID (olophmoglokjdojcacoihjcepmlhafag) is fixed by the "key"
 * in manifest.json, so the script works whatever folder it's loaded from.
 */

const COMMAND_SWITCH = 'switch-to-previous-tab';

const STORAGE_KEYS = {
  isEnabled: 'isEnabled', // chrome.storage.local: persists across restarts
  mruStack: 'mruStack',   // chrome.storage.session: survives worker suspension
};

const BADGE = {
  on: { text: 'ON', color: '#2E7D32' },
  off: { text: 'OFF', color: '#757575' },
};

// ---------------------------------------------------------------------------
// MRU stack
// ---------------------------------------------------------------------------

/** Tab IDs, most recently used first. Index 0 is the current tab. */
let mruStack = [];

/**
 * Tab events can arrive faster than storage reads/writes complete. Running
 * every stack operation through one promise chain keeps them in event order.
 */
let queue = Promise.resolve();

function enqueue(task) {
  queue = queue.then(task).catch((error) => console.error('[MRU]', error));
  return queue;
}

function saveStack() {
  return chrome.storage.session.set({ [STORAGE_KEYS.mruStack]: mruStack });
}

/** Moves a tab to index 0, adding it if it isn't tracked yet. */
function moveToFront(tabId) {
  mruStack = [tabId, ...mruStack.filter((id) => id !== tabId)];
}

function removeFromStack(tabId) {
  mruStack = mruStack.filter((id) => id !== tabId);
}

/** Rebuilds the stack from every open tab across all windows. */
async function seedFromOpenTabs() {
  const tabs = await chrome.tabs.query({});

  // `lastAccessed` (Chrome 121+) gives a faithful recency order. On older
  // versions it's undefined, so active tabs are ranked ahead of the rest.
  tabs.sort(
    (a, b) =>
      (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) ||
      Number(b.active) - Number(a.active),
  );

  mruStack = tabs
    .map((tab) => tab.id)
    .filter((id) => id !== undefined && id !== chrome.tabs.TAB_ID_NONE);

  // Whatever the user is looking at right now is, by definition, index 0.
  const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (current) moveToFront(current.id);

  await saveStack();
}

/** Restores the stack after the worker wakes up, seeding it if none was saved. */
async function restoreStack() {
  const { [STORAGE_KEYS.mruStack]: saved } = await chrome.storage.session.get(
    STORAGE_KEYS.mruStack,
  );

  if (Array.isArray(saved) && saved.length > 0) {
    mruStack = saved;
  } else {
    await seedFromOpenTabs();
  }
}

// ---------------------------------------------------------------------------
// ON/OFF state and badge
// ---------------------------------------------------------------------------

async function getIsEnabled() {
  const { [STORAGE_KEYS.isEnabled]: isEnabled } = await chrome.storage.local.get({
    [STORAGE_KEYS.isEnabled]: true, // default when nothing is stored yet
  });
  return isEnabled;
}

async function renderBadge(isEnabled) {
  const { text, color } = isEnabled ? BADGE.on : BADGE.off;
  const hint = isEnabled ? 'click to turn OFF' : 'click to turn ON';

  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' }),
    chrome.action.setTitle({ title: `Pure MRU Tab Switcher: ${text} (${hint})` }),
  ]);
}

async function toggleEnabled() {
  const isEnabled = !(await getIsEnabled());
  await chrome.storage.local.set({ [STORAGE_KEYS.isEnabled]: isEnabled });
  await renderBadge(isEnabled);
}

// ---------------------------------------------------------------------------
// Switching and cycling
// ---------------------------------------------------------------------------

/**
 * Presses closer together than this keep walking back through the MRU list,
 * like tapping Tab while holding Alt on Windows; a longer pause ends the
 * cycle. A pause is the only signal available: noticing that Ctrl was
 * released would need a script injected into every page.
 */
const CYCLE_PAUSE_MS = 1000;

/**
 * The cycle in progress, or null. Tabs merely passed through mid-cycle
 * aren't "used", so the stack is left alone until the cycle ends.
 *   order:       the current window's tabs at the first press (see below)
 *   position:    index in `order` of the tab currently shown
 *   visited:     tab IDs this cycle activated (their tab events are ignored)
 *   lastPressAt: time of the latest press
 */
let cycle = null;
let cycleTimer;

/**
 * The tabs of the window the user is in, starting with the one on screen and
 * then most recently used first. Cycling never leaves this window.
 */
async function currentWindowOrder() {
  const [shown] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!shown) return [];

  const tabs = await chrome.tabs.query({ windowId: shown.windowId });
  const inWindow = new Set(tabs.map((tab) => tab.id));
  const used = mruStack.filter((id) => inWindow.has(id) && id !== shown.id);

  // Tabs opened in the background and never visited aren't in the stack yet;
  // they come last, in tab-strip order.
  const neverUsed = tabs
    .sort((a, b) => a.index - b.index)
    .map((tab) => tab.id)
    .filter((id) => id !== shown.id && !used.includes(id));

  return [shown.id, ...used, ...neverUsed];
}

/** Shows the next tab in the cycle order, skipping tabs that have closed. */
async function stepCycle() {
  const { order } = cycle;

  // Wraps past the oldest tab back to where the cycle started.
  for (let tries = 1; tries < order.length; tries++) {
    cycle.position = (cycle.position + 1) % order.length;
    const tabId = order[cycle.position];
    cycle.visited.add(tabId);
    try {
      await chrome.tabs.update(tabId, { active: true });
      return;
    } catch {
      removeFromStack(tabId); // stale ID; try the next one
    }
  }
}

/** Ends the cycle and records the tab it left on screen as most recently used. */
async function finishCycle() {
  if (!cycle) return;
  const landedOn = cycle.order[cycle.position];
  cycle = null;
  clearTimeout(cycleTimer);

  // Record the tab the cycle stopped on directly, since its onActivated was
  // ignored as a cycle step. If it has since closed or the user clicked
  // another tab in its window, record what's shown instead.
  const tab = await chrome.tabs.get(landedOn).catch(() => null);
  if (tab?.active) {
    moveToFront(landedOn);
  } else {
    const [shown] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (shown) moveToFront(shown.id);
  }
  await saveStack();
}

async function finishCycleIfPaused() {
  if (cycle && Date.now() - cycle.lastPressAt >= CYCLE_PAUSE_MS) await finishCycle();
}

/** One press: the previous tab, or one tab further back if mid-cycle. */
async function cycleRecentTabs(pressedAt) {
  if (!cycle || pressedAt - cycle.lastPressAt >= CYCLE_PAUSE_MS) {
    await finishCycle();
    const order = await currentWindowOrder();
    if (order.length < 2) return;
    cycle = { order, position: 0, visited: new Set(), lastPressAt: pressedAt };
  }

  cycle.lastPressAt = pressedAt;
  await stepCycle();

  clearTimeout(cycleTimer);
  cycleTimer = setTimeout(() => enqueue(finishCycleIfPaused), CYCLE_PAUSE_MS);
}

/** Records a tab the user switched to by any means other than cycling. */
async function recordActivation(tabId) {
  if (cycle) {
    if (cycle.visited.has(tabId)) return; // a cycle step; recorded when it ends
    await finishCycle(); // the user went somewhere else mid-cycle
  }
  moveToFront(tabId);
  await saveStack();
}

/** Chrome's native Ctrl+Tab: the next tab to the right, wrapping around. */
async function switchToNextTabInWindow() {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  tabs.sort((a, b) => a.index - b.index);

  const current = tabs.findIndex((tab) => tab.active);
  if (current === -1 || tabs.length < 2) return;

  await chrome.tabs.update(tabs[(current + 1) % tabs.length].id, { active: true });
}

/** True when the command has been rebound to Ctrl+Tab (shown as "⌃⇥" on macOS). */
async function isBoundToCtrlTab() {
  const commands = await chrome.commands.getAll();
  const { shortcut = '' } = commands.find((c) => c.name === COMMAND_SWITCH) ?? {};
  return /Tab|⇥/.test(shortcut);
}

async function onSwitchCommand(pressedAt) {
  if (await getIsEnabled()) {
    await cycleRecentTabs(pressedAt);
  } else if (await isBoundToCtrlTab()) {
    // While OFF, the command still owns Ctrl+Tab, so doing nothing would leave
    // the key dead. Give it Chrome's default behavior back instead.
    await switchToNextTabInWindow();
  }
  // OFF with any other shortcut (e.g. Alt+Y): do nothing.
}

// ---------------------------------------------------------------------------
// Event wiring (listeners must be registered synchronously at top level)
// ---------------------------------------------------------------------------

// Load the saved stack before any queued event touches it.
enqueue(restoreStack);

chrome.runtime.onInstalled.addListener(() => {
  enqueue(seedFromOpenTabs);
  getIsEnabled().then(renderBadge);
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(seedFromOpenTabs);
  getIsEnabled().then(renderBadge);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(() => recordActivation(tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => {
    removeFromStack(tabId);
    return saveStack();
  });
});

// Chrome can swap a tab's ID (e.g. when a prerendered page is shown).
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  const swap = (id) => (id === removedTabId ? addedTabId : id);
  enqueue(() => {
    mruStack = mruStack.map(swap);
    if (cycle) cycle.order = cycle.order.map(swap);
    return saveStack();
  });
});

// Switching windows doesn't fire tabs.onActivated (the other window's tab is
// already active), so record the newly focused window's active tab here.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  enqueue(async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) await recordActivation(tab.id);
  });
});

chrome.action.onClicked.addListener(() => {
  toggleEnabled().catch((error) => console.error('[MRU]', error));
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== COMMAND_SWITCH) return;
  const pressedAt = Date.now(); // stamped on arrival; queued work can lag behind
  enqueue(() => onSwitchCommand(pressedAt));
});
