/**
 * Pure MRU Tab Switcher — background service worker.
 *
 * Tracks tabs in Most-Recently-Used order and switches to the previous tab
 * when the keyboard command fires. It never touches page content: no content
 * scripts, no DOM injection, no overlays.
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
 * Chrome's Ctrl+Tab and survives restarts. To set it:
 *   1. Open chrome://extensions/shortcuts
 *   2. Open DevTools (F12 / Cmd+Opt+J) and go to the Console tab
 *   3. Paste this and press Enter (Chrome may ask you to type "allow pasting"):
 *
 * chrome.developerPrivate.getExtensionsInfo({}, (exts) => {
 *   const ext = exts.find((e) => e.name === 'Pure MRU Tab Switcher');
 *   chrome.developerPrivate.updateExtensionCommand({
 *     extensionId: ext.id,
 *     commandName: 'switch-to-previous-tab',
 *     keybinding: navigator.platform.startsWith('Mac') ? 'MacCtrl+Tab' : 'Ctrl+Tab',
 *   }, () => console.log(chrome.runtime.lastError?.message ?? 'Ctrl+Tab is now bound'));
 * });
 *
 * To undo it, set a different shortcut on that page as usual.
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
// Switching
// ---------------------------------------------------------------------------

/** Activates a tab and focuses its window, in case it lives in another one. */
async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function switchToPreviousTab() {
  // Index 1 is the previously used tab. If its ID has gone stale, drop it and
  // fall through to the next candidate instead of doing nothing.
  for (const tabId of mruStack.slice(1)) {
    try {
      await focusTab(tabId);
      // Record the switch directly: if the tab was already active in its own
      // window, Chrome fires no onActivated, and onFocusChanged isn't
      // guaranteed on every platform.
      moveToFront(tabId);
      await saveStack();
      return;
    } catch {
      removeFromStack(tabId);
      await saveStack();
    }
  }
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

async function onSwitchCommand() {
  if (await getIsEnabled()) {
    await switchToPreviousTab();
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
  enqueue(() => {
    moveToFront(tabId);
    return saveStack();
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => {
    removeFromStack(tabId);
    return saveStack();
  });
});

// Chrome can swap a tab's ID (e.g. when a prerendered page is shown).
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  enqueue(() => {
    mruStack = mruStack.map((id) => (id === removedTabId ? addedTabId : id));
    return saveStack();
  });
});

// Switching windows doesn't fire tabs.onActivated (the other window's tab is
// already active), so record the newly focused window's active tab here.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  enqueue(async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (!tab) return;
    moveToFront(tab.id);
    await saveStack();
  });
});

chrome.action.onClicked.addListener(() => {
  toggleEnabled().catch((error) => console.error('[MRU]', error));
});

chrome.commands.onCommand.addListener((command) => {
  if (command === COMMAND_SWITCH) enqueue(onSwitchCommand);
});
