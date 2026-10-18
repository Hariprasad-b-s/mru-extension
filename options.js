/**
 * MRU Tab Switcher — settings, welcome and what's-new page (options.html).
 *
 * Shows the current shortcuts, walks through the Ctrl+Tab setup, and edits
 * the settings and ON/OFF state the background service worker reads from
 * chrome.storage.local.
 */

// Keep in sync with DEFAULT_SETTINGS and RELEASE_ACCESS in background.js.
const DEFAULT_SETTINGS = { pauseMs: 700, braveHistory: true, scope: 'window', showWhatsNew: true };
const RELEASE_ACCESS = { origins: ['<all_urls>'] };

const $ = (id) => document.getElementById(id);

if (location.hash === '#welcome') document.body.classList.add('is-welcome');

// ---------------------------------------------------------------------------
// Shortcuts and Ctrl+Tab setup
// ---------------------------------------------------------------------------

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  const byName = Object.fromEntries(commands.map((c) => [c.name, c.shortcut]));

  for (const kbd of document.querySelectorAll('[data-shortcut]')) {
    kbd.textContent = byName[kbd.dataset.shortcut] || 'not set';
  }

  const forward = byName['switch-to-previous-tab'] || '';
  const reverse = byName['cycle-in-reverse'] || '';
  const usesTab = (shortcut) => /Tab|⇥/.test(shortcut);
  // Ctrl+Tab set up before Ctrl+Shift+Tab existed (version 1.0), so the
  // reverse command still has its default, Alt+Shift+Y.
  const halfDone = usesTab(forward) && !usesTab(reverse);
  $('ctrl-tab-nudge').hidden = !halfDone;

  const status = $('ctrl-tab-status');
  if (usesTab(forward) && usesTab(reverse)) {
    status.textContent = `✓ Set up: ${forward} and ${reverse}.`;
    status.className = 'status ok';
  } else if (halfDone) {
    status.textContent = `${forward} is set up, but Ctrl+Shift+Tab isn't yet (the reverse shortcut is ${reverse || 'not set'}). ` +
      'Run the setup code once more to add it.';
    status.className = 'status';
  } else {
    status.textContent = `Not set up yet: the shortcut is ${forward || 'not set'}.`;
    status.className = 'status';
  }
}

function openShortcutsPage() {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

async function loadSetupCode() {
  const response = await fetch(chrome.runtime.getURL('scripts/set-ctrl-tab-shortcut.js'));
  $('setup-code').textContent = await response.text();
}

async function copySetupCode() {
  await navigator.clipboard.writeText($('setup-code').textContent);
  const button = $('copy-code');
  button.textContent = 'Copied ✓';
  setTimeout(() => { button.textContent = 'Copy setup code'; }, 2000);
}

// ---------------------------------------------------------------------------
// What's new, after an update
// ---------------------------------------------------------------------------

/**
 * After a feature update, background.js opens this page as #whats-new in a
 * background tab and shows NEW on the toolbar icon. However the page is
 * reached while that's pending, it lists what's new, and the notice counts as
 * seen once its tab is the one on screen.
 */
async function renderWhatsNew() {
  const { whatsNew } = await chrome.storage.local.get('whatsNew');
  if (!whatsNew && location.hash !== '#whats-new') return;
  document.body.classList.add('is-whats-new');
  document.title = "What's new in MRU Tab Switcher";
  $('whats-new-version').textContent = chrome.runtime.getManifest().version;
  if (!whatsNew) return;

  const markSeen = () => chrome.storage.local.remove('whatsNew');
  const tab = await chrome.tabs.getCurrent();
  if (!tab || tab.active) return markSeen();
  chrome.tabs.onActivated.addListener(function onActivated({ tabId }) {
    if (tabId !== tab.id) return;
    chrome.tabs.onActivated.removeListener(onActivated);
    markSeen();
  });
}

// ---------------------------------------------------------------------------
// Optional release detection: site access for content.js
// ---------------------------------------------------------------------------

async function renderReleaseDetection(message) {
  const on = await chrome.permissions.contains(RELEASE_ACCESS);
  $('release-detection').checked = on;
  const status = $('release-status');
  status.textContent = message ?? (on ? '✓ On: letting go of Ctrl ends the cycle.' : '');
  status.className = on ? 'status ok' : 'status';
}

function onReleaseDetectionChange(event) {
  // permissions.request only works straight from the click, before any await.
  const turningOn = event.target.checked;
  const change = turningOn
    ? chrome.permissions.request(RELEASE_ACCESS)
    : chrome.permissions.remove(RELEASE_ACCESS);
  change
    .then((done) => {
      if (turningOn && !done) return renderReleaseDetection('Site access not allowed, so the pause is used.');
      return renderReleaseDetection(turningOn ? '✓ On: letting go of Ctrl ends the cycle, in tabs already open too.' : 'Off: the pause ends the cycle.');
    })
    .catch((error) => renderReleaseDetection(`Couldn't change site access: ${error.message}`));
}

// ---------------------------------------------------------------------------
// Settings and ON/OFF
// ---------------------------------------------------------------------------

let settings = { ...DEFAULT_SETTINGS };

function showPause(ms) {
  $('pause-value').textContent = `${(ms / 1000).toFixed(2)} s`;
}

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ settings });
  const saved = $('saved');
  saved.classList.add('show');
  clearTimeout(saveSettings.timer);
  saveSettings.timer = setTimeout(() => saved.classList.remove('show'), 1200);
}

function renderEnabled(isEnabled) {
  $('enabled').checked = isEnabled;
  $('enabled-label').textContent = isEnabled ? 'On' : 'Off';
}

async function init() {
  const stored = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS, isEnabled: true });
  settings = { ...DEFAULT_SETTINGS, ...stored.settings };

  $('pause').value = settings.pauseMs;
  showPause(settings.pauseMs);
  $('brave-history').checked = settings.braveHistory;
  document.querySelector(`input[name="scope"][value="${settings.scope}"]`).checked = true;
  $('show-whats-new').checked = settings.showWhatsNew;
  renderEnabled(stored.isEnabled);

  $('pause').addEventListener('input', (e) => showPause(Number(e.target.value)));
  $('pause').addEventListener('change', (e) => saveSettings({ pauseMs: Number(e.target.value) }));
  $('brave-history').addEventListener('change', (e) => saveSettings({ braveHistory: e.target.checked }));
  for (const radio of document.querySelectorAll('input[name="scope"]')) {
    radio.addEventListener('change', (e) => saveSettings({ scope: e.target.value }));
  }
  $('show-whats-new').addEventListener('change', (e) => saveSettings({ showWhatsNew: e.target.checked }));
  $('enabled').addEventListener('change', (e) => {
    chrome.storage.local.set({ isEnabled: e.target.checked });
    renderEnabled(e.target.checked);
  });

  // The toolbar icon can toggle ON/OFF while this page is open, and an update
  // can add a what's-new notice.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isEnabled) renderEnabled(changes.isEnabled.newValue !== false);
    if (area === 'local' && changes.whatsNew?.newValue) renderWhatsNew();
  });

  $('release-detection').addEventListener('change', onReleaseDetectionChange);
  // Site access can also be changed from the extension's details in Chrome.
  chrome.permissions.onAdded.addListener(() => renderReleaseDetection());
  chrome.permissions.onRemoved.addListener(() => renderReleaseDetection());

  $('open-shortcuts').addEventListener('click', openShortcutsPage);
  $('open-shortcuts-2').addEventListener('click', openShortcutsPage);
  $('copy-code').addEventListener('click', copySetupCode);

  // Coming back from the shortcuts page: show the new shortcuts.
  addEventListener('focus', renderShortcuts);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderShortcuts(); });

  await Promise.all([renderShortcuts(), loadSetupCode(), renderReleaseDetection(), renderWhatsNew()]);
  if (location.hash === '#ctrl-tab') $('ctrl-tab').scrollIntoView();
}

init();
