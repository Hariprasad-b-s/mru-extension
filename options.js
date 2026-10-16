/**
 * MRU Tab Switcher — settings and welcome page (options.html).
 *
 * Shows the current shortcuts, walks through the Ctrl+Tab setup, and edits
 * the settings and ON/OFF state the background service worker reads from
 * chrome.storage.local.
 */

// Keep in sync with DEFAULT_SETTINGS in background.js.
const DEFAULT_SETTINGS = { pauseMs: 700, braveHistory: true, scope: 'window' };

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
  const status = $('ctrl-tab-status');
  if (/Tab|⇥/.test(forward)) {
    status.textContent = `✓ Set up: the shortcut is ${forward}.`;
    status.className = 'status ok';
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
  renderEnabled(stored.isEnabled);

  $('pause').addEventListener('input', (e) => showPause(Number(e.target.value)));
  $('pause').addEventListener('change', (e) => saveSettings({ pauseMs: Number(e.target.value) }));
  $('brave-history').addEventListener('change', (e) => saveSettings({ braveHistory: e.target.checked }));
  for (const radio of document.querySelectorAll('input[name="scope"]')) {
    radio.addEventListener('change', (e) => saveSettings({ scope: e.target.value }));
  }
  $('enabled').addEventListener('change', (e) => {
    chrome.storage.local.set({ isEnabled: e.target.checked });
    renderEnabled(e.target.checked);
  });

  // The toolbar icon can toggle ON/OFF while this page is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isEnabled) renderEnabled(changes.isEnabled.newValue !== false);
  });

  $('open-shortcuts').addEventListener('click', openShortcutsPage);
  $('open-shortcuts-2').addEventListener('click', openShortcutsPage);
  $('copy-code').addEventListener('click', copySetupCode);

  // Coming back from the shortcuts page: show the new shortcuts.
  addEventListener('focus', renderShortcuts);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderShortcuts(); });

  await Promise.all([renderShortcuts(), loadSetupCode()]);
  if (location.hash === '#ctrl-tab') $('ctrl-tab').scrollIntoView();
}

init();
