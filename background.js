/**
 * MRU Tab Switcher — background service worker.
 *
 * Tracks tabs in Most-Recently-Used order and, when the keyboard command
 * fires, switches to the previously used tab; pressing it again before a
 * short pause goes one tab further back, and the reverse command
 * (Ctrl+Shift+Tab once set up) walks the same list the other way. Settings
 * (options.html) choose the pause, whether tabs passed through count as used
 * (as in Brave), and whether cycling stays in the focused window or spans all
 * windows. Optionally (a setting that asks the user for site access),
 * content.js reports when Ctrl is released, so a cycle lasts while Ctrl is
 * held and ends on release, as in Brave. It never changes page content and
 * shows no overlays.
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
  settings: 'settings',   // chrome.storage.local: see DEFAULT_SETTINGS
  mruStack: 'mruStack',   // chrome.storage.session: survives worker suspension
};

/** User settings, edited on options.html. */
const DEFAULT_SETTINGS = {
  pauseMs: 700,        // presses closer together than this keep cycling
  braveHistory: true,  // tabs shown while cycling count as used, as in Brave
  scope: 'window',     // 'window': cycle the focused window; 'all': every window
};

const BADGE = {
  on: { text: 'ON', color: '#2E7D32', icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
  off: { text: 'OFF', color: '#757575', icon: { 16: 'icons/icon-off-16.png', 32: 'icons/icon-off-32.png' } },
};

const HELP_URL = 'https://github.com/Hariprasad-b-s/mru-extension#readme';

/** Optional site access for content.js, requested from options.html. */
const RELEASE_ACCESS = { origins: ['<all_urls>'] };
const RELEASE_SCRIPT_ID = 'release-watcher';

const MENU = {
  shortcuts: 'open-shortcuts',
  ctrlTab: 'set-up-ctrl-tab',
  help: 'help',
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
// Settings
// ---------------------------------------------------------------------------

let settings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  const { [STORAGE_KEYS.settings]: saved } = await chrome.storage.local.get(STORAGE_KEYS.settings);
  settings = { ...DEFAULT_SETTINGS, ...saved };
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
  const { text, color, icon } = isEnabled ? BADGE.on : BADGE.off;
  const hint = isEnabled ? 'click to turn OFF' : 'click to turn ON';

  await Promise.all([
    chrome.action.setIcon({ path: icon }),
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
 * The cycle in progress, or null. The order is fixed at the first press and
 * later presses walk it in either direction. With release detection on and a
 * page that can report it (content.js), the cycle lasts until Ctrl is
 * released, as in Brave. Otherwise presses closer together than
 * settings.pauseMs keep cycling and a longer pause ends it.
 *   id:           distinguishes this cycle from earlier ones (see content.js)
 *   order:        the tabs to cycle through, fixed at the first press (see below)
 *   position:     index in `order` of the tab currently shown
 *   windowId:     the window of the tab currently shown
 *   visited:      tab IDs this cycle activated (their tab events are ignored)
 *   watched:      tabs asked to report the release
 *   lastPressAt:  time of the latest press
 *   releaseAware: whether the tab on screen will report the release
 */
let cycle = null;
let cycleTimer;
let cycleCount = 0;

/** Whether the user granted site access for release detection. */
let releaseDetection = false;

/**
 * The tabs to cycle through, starting with the one on screen and then most
 * recently used first: those of the focused window, or of every window when
 * settings.scope is 'all'.
 */
async function cycleOrder() {
  const [shown] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!shown) return { order: [] };

  const allWindows = settings.scope === 'all';
  const tabs = await chrome.tabs.query(allWindows ? {} : { windowId: shown.windowId });
  const inScope = new Set(tabs.map((tab) => tab.id));
  const used = mruStack.filter((id) => inScope.has(id) && id !== shown.id);

  // Tabs opened in the background and never visited aren't in the stack yet;
  // they come last, in tab-strip order.
  const neverUsed = tabs
    .sort((a, b) => a.windowId - b.windowId || a.index - b.index)
    .map((tab) => tab.id)
    .filter((id) => id !== shown.id && !used.includes(id));

  return { order: [shown.id, ...used, ...neverUsed], windowId: shown.windowId };
}

/**
 * Shows the tab one step along the cycle order (step 1: older, -1: newer),
 * skipping tabs that have closed. Wraps around at either end.
 */
async function stepCycle(step) {
  const { order } = cycle;

  for (let tries = 1; tries < order.length; tries++) {
    cycle.position = (cycle.position + step + order.length) % order.length;
    const tabId = order[cycle.position];
    cycle.visited.add(tabId);
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab.windowId !== cycle.windowId) {
        // Only when cycling across all windows: bring the tab's window forward.
        await chrome.windows.update(tab.windowId, { focused: true });
        cycle.windowId = tab.windowId;
      }
      if (settings.braveHistory) {
        // As in Brave, a tab shown while cycling counts as used.
        moveToFront(tabId);
        await saveStack();
      }
      return tabId;
    } catch {
      removeFromStack(tabId); // stale ID; try the next one
    }
  }
}

/**
 * Asks the page in a tab to report when Ctrl is released (content.js).
 * Resolves true if release detection is on and that page has keyboard focus,
 * so the release will reach it; false where no page script runs (chrome://
 * pages, the New Tab page, the Web Store) or focus is elsewhere, such as the
 * address bar.
 */
async function watchForRelease(tabId) {
  if (!releaseDetection) return false;
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

  // Record the tab the cycle stopped on (with Brave-style history stepCycle
  // already did). If it has since closed or the user clicked another tab in
  // its window, record what's shown instead.
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
  if (cycle && !cycle.releaseAware && Date.now() - cycle.lastPressAt >= settings.pauseMs) {
    await finishCycle();
  }
}

/** Another app took focus, as Brave checks; a passing focus change between our own windows doesn't count. */
async function finishCycleIfChromeUnfocused() {
  if (!cycle) return;
  const window = await chrome.windows.getLastFocused().catch(() => null);
  if (!window?.focused) await finishCycle();
}

/**
 * One press. Forward (step 1): the previous tab, or one further back if
 * mid-cycle. Reverse (step -1): the other way, so from a standing start it
 * jumps to the least recently used tab, as Ctrl+Shift+Tab does in Brave.
 */
async function cycleRecentTabs(pressedAt, step) {
  const paused = cycle && !cycle.releaseAware && pressedAt - cycle.lastPressAt >= settings.pauseMs;
  if (!cycle || paused) {
    await finishCycle();
    const { order, windowId } = await cycleOrder();
    if (order.length < 2) return;
    cycle = {
      id: ++cycleCount,
      order,
      position: 0,
      windowId,
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

  // Like Brave, keep cycling for as long as Ctrl is held where the page can
  // report its release; elsewhere a pause ends the cycle.
  cycle.releaseAware = shown !== undefined && (await watchForRelease(shown));
  clearTimeout(cycleTimer);
  if (!cycle.releaseAware) {
    cycleTimer = setTimeout(() => enqueue(finishCycleIfPaused), settings.pauseMs);
  }
}

/** Records a tab the user switched to by any means other than cycling. */
async function recordActivation(tabId) {
  if (cycle) {
    if (cycle.visited.has(tabId)) return; // a cycle step, not the user's own switch
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
// Optional release detection (content.js)
// ---------------------------------------------------------------------------

/**
 * Registers content.js while the user has granted site access (from
 * options.html) and unregisters it once they withdraw it.
 */
async function syncReleaseWatcher({ addToOpenTabs = false } = {}) {
  releaseDetection = await chrome.permissions.contains(RELEASE_ACCESS);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [RELEASE_SCRIPT_ID] });

  if (releaseDetection && registered.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: RELEASE_SCRIPT_ID,
      matches: ['<all_urls>'],
      js: ['content.js'],
      runAt: 'document_start',
      allFrames: true,
    }]);
  } else if (!releaseDetection && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [RELEASE_SCRIPT_ID] });
  }

  if (releaseDetection && addToOpenTabs) await addReleaseWatcherToOpenTabs();
}

/** Registered content scripts only reach pages loaded after registration. */
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

// ---------------------------------------------------------------------------
// Toolbar menu and pages
// ---------------------------------------------------------------------------

function openPage(url) {
  return chrome.tabs.create({ url });
}

/** Items added to the toolbar icon's right-click menu (Chrome adds "Options"). */
function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.shortcuts, title: 'Change keyboard shortcuts', contexts: ['action'] });
    chrome.contextMenus.create({ id: MENU.ctrlTab, title: 'Set up Ctrl+Tab', contexts: ['action'] });
    chrome.contextMenus.create({ id: MENU.help, title: 'Help', contexts: ['action'] });
  });
}

// ---------------------------------------------------------------------------
// Event wiring (listeners must be registered synchronously at top level)
// ---------------------------------------------------------------------------

// Load settings and the saved stack before any queued event touches them.
enqueue(loadSettings);
enqueue(restoreStack);
enqueue(() => syncReleaseWatcher());

chrome.runtime.onInstalled.addListener(({ reason }) => {
  enqueue(seedFromOpenTabs);
  enqueue(() => syncReleaseWatcher({ addToOpenTabs: true }));
  getIsEnabled().then(renderBadge);
  createMenus();
  // First install: show how it works and how to set up Ctrl+Tab.
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) openPage('options.html#welcome');
});

// Settings and the ON/OFF state can also change from options.html.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE_KEYS.settings]) {
    settings = { ...DEFAULT_SETTINGS, ...changes[STORAGE_KEYS.settings].newValue };
  }
  if (changes[STORAGE_KEYS.isEnabled]) renderBadge(changes[STORAGE_KEYS.isEnabled].newValue !== false);
});

chrome.contextMenus.onClicked.addListener(({ menuItemId }) => {
  if (menuItemId === MENU.shortcuts) openPage('chrome://extensions/shortcuts');
  if (menuItemId === MENU.ctrlTab) openPage('options.html#ctrl-tab');
  if (menuItemId === MENU.help) openPage(HELP_URL);
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
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Some systems report "no window" briefly while focus moves between our
    // own windows, so check again shortly before ending a cycle.
    setTimeout(() => enqueue(finishCycleIfChromeUnfocused), 200);
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

// Site access for release detection granted or withdrawn (options.html, or
// the extension's site access settings in Chrome).
chrome.permissions.onAdded.addListener(() => {
  enqueue(() => syncReleaseWatcher({ addToOpenTabs: true }));
});
chrome.permissions.onRemoved.addListener(() => {
  enqueue(() => syncReleaseWatcher());
});

// content.js: Ctrl was released (or the mouse pressed) during a cycle.
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
