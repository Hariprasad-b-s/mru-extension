/**
 * MRU Tab Switcher — background service worker.
 *
 * Tracks tabs in Most-Recently-Used order and works like Ctrl+Tab in Brave:
 * the keyboard command switches to the previously used tab in the current
 * window, pressing it again while the modifier is still held goes one tab
 * further back, and the reverse command (Ctrl+Shift+Tab once set up) walks the
 * same list the other way. Every tab shown while cycling counts as used.
 * A cycle ends when the modifier is released, which content.js reports from
 * the page, or on a mouse press, focus leaving the window, or a tab opening or
 * closing. Where no page script can run (chrome:// pages, the New Tab page,
 * the Web Store), a pause of CYCLE_PAUSE_MS ends it instead. Switching never
 * leaves the focused window. It never changes page content and shows no
 * overlays.
 *
 * MV3 service workers are shut down when idle, so the MRU stack is mirrored
 * to chrome.storage.session (in-memory, cleared on browser restart) and
 * restored whenever the worker wakes up.
 *
 * USING CTRL+TAB AND CTRL+SHIFT+TAB (one-time setup)
 * Chrome won't let an extension ship Tab shortcuts as defaults (the
 * manifest's suggested keys are dropped because they clash with Chrome's own
 * "next/previous tab"), and the chrome://extensions/shortcuts page refuses
 * Tab. The page's own API does accept them, though, and the bindings then
 * override Chrome's and survive restarts. scripts/set-ctrl-tab-shortcut.js
 * sets both: open chrome://extensions/shortcuts, open DevTools (Ctrl+Shift+J,
 * or Cmd+Option+J on macOS), and paste that whole file into the Console. It
 * finds the extension by its command, so it works for a Chrome Web Store
 * install and an unpacked one alike, whatever their IDs.
 */

const COMMAND_SWITCH = 'switch-to-previous-tab';
const COMMAND_SWITCH_REVERSE = 'cycle-in-reverse';

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
    chrome.action.setTitle({ title: `MRU Tab Switcher: ${text} (${hint})` }),
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
 * Fallback for tabs where content.js can't report the modifier's release
 * (chrome:// pages, the New Tab page, the Web Store, or keyboard focus in the
 * address bar): there, presses closer together than this keep cycling and a
 * longer pause ends the cycle.
 */
const CYCLE_PAUSE_MS = 700;

/**
 * The cycle in progress, or null. Like Brave, the order is fixed at the first
 * press and later presses walk it in either direction, while every tab shown
 * along the way is recorded as used.
 *   order:       the current window's tabs at the first press (see below)
 *   position:    index in `order` of the tab currently shown
 *   id:           distinguishes this cycle from earlier ones (see content.js)
 *   visited:      tab IDs this cycle activated (recorded by stepCycle itself)
 *   watched:      tabs asked to report the modifier's release
 *   lastPressAt:  time of the latest press
 *   releaseAware: whether the tab on screen will report the release; if not,
 *                 the cycle ends after a CYCLE_PAUSE_MS pause instead
 */
let cycle = null;
let cycleTimer;
let cycleCount = 0;

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

/**
 * Shows the tab one step along the cycle order (step 1: older, -1: newer),
 * skipping tabs that have closed. Wraps around at either end. Returns the ID
 * of the tab shown, if any.
 */
async function stepCycle(step) {
  const { order } = cycle;

  for (let tries = 1; tries < order.length; tries++) {
    cycle.position = (cycle.position + step + order.length) % order.length;
    const tabId = order[cycle.position];
    cycle.visited.add(tabId);
    try {
      await chrome.tabs.update(tabId, { active: true });
      // As in Brave, a tab shown while cycling counts as used.
      moveToFront(tabId);
      await saveStack();
      return tabId;
    } catch {
      removeFromStack(tabId); // stale ID; try the next one
    }
  }
}

/**
 * Asks the page in a tab to report when the modifier is released (content.js).
 * Resolves true if that page has keyboard focus, so the release will reach it;
 * false where no page script can run or focus is elsewhere, e.g. the address
 * bar.
 */
async function watchForRelease(tabId) {
  const { id } = cycle;
  cycle.watched.add(tabId);
  const reply = await chrome.tabs
    .sendMessage(tabId, { type: 'cycle-watch', cycleId: id })
    .catch(() => null);
  return reply?.focused === true;
}

/** Ends the cycle and records the tab it left on screen as most recently used. */
async function finishCycle() {
  if (!cycle) return;
  const landedOn = cycle.order[cycle.position];
  const { watched } = cycle;
  cycle = null;
  clearTimeout(cycleTimer);
  for (const tabId of watched) {
    chrome.tabs.sendMessage(tabId, { type: 'cycle-unwatch' }).catch(() => {});
  }

  // Normally a no-op, as stepCycle already recorded the tab the cycle stopped
  // on. If it has since closed or the user clicked another tab in its window,
  // record what's shown instead.
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
  if (cycle && !cycle.releaseAware && Date.now() - cycle.lastPressAt >= CYCLE_PAUSE_MS) {
    await finishCycle();
  }
}

/**
 * One press. Forward (step 1): the previous tab, or one further back if
 * mid-cycle. Reverse (step -1): the other way, so from a standing start it
 * jumps to the least recently used tab, as Ctrl+Shift+Tab does in Brave.
 */
async function cycleRecentTabs(pressedAt, step) {
  const paused = cycle && !cycle.releaseAware && pressedAt - cycle.lastPressAt >= CYCLE_PAUSE_MS;
  if (!cycle || paused) {
    await finishCycle();
    const order = await currentWindowOrder();
    if (order.length < 2) return;
    cycle = {
      id: ++cycleCount,
      order,
      position: 0,
      visited: new Set(),
      watched: new Set(),
      lastPressAt: pressedAt,
      releaseAware: false,
    };
    // A quick release can still land on the tab the cycle started from.
    watchForRelease(order[0]);
  }

  cycle.lastPressAt = pressedAt;
  const shown = await stepCycle(step);

  // Like Brave, keep cycling for as long as the modifier is held. Only where
  // the page can't report the release does a pause end the cycle instead.
  cycle.releaseAware = shown !== undefined && (await watchForRelease(shown));
  clearTimeout(cycleTimer);
  if (!cycle.releaseAware) {
    cycleTimer = setTimeout(() => enqueue(finishCycleIfPaused), CYCLE_PAUSE_MS);
  }
}

/** Static content scripts only reach pages loaded after install or update. */
async function addReleaseWatcherToOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) =>
      chrome.scripting
        .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] })
        .catch(() => {}), // chrome:// pages, the Web Store, discarded tabs
    ),
  );
}

/** Records a tab the user switched to by any means other than cycling. */
async function recordActivation(tabId) {
  if (cycle) {
    if (cycle.visited.has(tabId)) return; // a cycle step; stepCycle recorded it
    await finishCycle(); // the user went somewhere else mid-cycle
  }
  moveToFront(tabId);
  await saveStack();
}

/**
 * Chrome's native Ctrl+Tab (offset 1: the next tab to the right) and
 * Ctrl+Shift+Tab (offset -1: the next tab to the left), wrapping around.
 */
async function switchToAdjacentTab(offset) {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  tabs.sort((a, b) => a.index - b.index);

  const current = tabs.findIndex((tab) => tab.active);
  if (current === -1 || tabs.length < 2) return;

  const next = (current + offset + tabs.length) % tabs.length;
  await chrome.tabs.update(tabs[next].id, { active: true });
}

/** True when the command has been bound to a Tab shortcut ("⇥" on macOS). */
async function isBoundToTabKey(command) {
  const commands = await chrome.commands.getAll();
  const { shortcut = '' } = commands.find((c) => c.name === command) ?? {};
  return /Tab|⇥/.test(shortcut);
}

async function onSwitchCommand(command, pressedAt) {
  const step = command === COMMAND_SWITCH_REVERSE ? -1 : 1;
  if (await getIsEnabled()) {
    await cycleRecentTabs(pressedAt, step);
  } else if (await isBoundToTabKey(command)) {
    // While OFF, the command still owns Ctrl+Tab / Ctrl+Shift+Tab, so doing
    // nothing would leave the key dead. Give it Chrome's default back instead.
    await switchToAdjacentTab(step);
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
  addReleaseWatcherToOpenTabs().catch((error) => console.error('[MRU]', error));
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(seedFromOpenTabs);
  getIsEnabled().then(renderBadge);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(() => recordActivation(tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    removeFromStack(tabId);
    await saveStack();
    await finishCycle(); // as in Brave, closing a tab ends a cycle
  });
});

// As in Brave, opening a tab ends a cycle.
chrome.tabs.onCreated.addListener(() => {
  enqueue(finishCycle);
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
  // Another app took focus: as in Brave, that ends a cycle.
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    enqueue(finishCycle);
    return;
  }

  enqueue(async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) await recordActivation(tab.id);
  });
});

chrome.action.onClicked.addListener(() => {
  toggleEnabled().catch((error) => console.error('[MRU]', error));
});

// content.js: the modifier was released (or the mouse pressed) during a cycle.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'cycle-end') return;
  enqueue(async () => {
    if (cycle?.id === message.cycleId) await finishCycle();
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== COMMAND_SWITCH && command !== COMMAND_SWITCH_REVERSE) return;
  const pressedAt = Date.now(); // stamped on arrival; queued work can lag behind
  enqueue(() => onSwitchCommand(command, pressedAt));
});
