# Privacy policy

_MRU tab switcher - Smooth like brave browser ("MRU Tab Switcher"). Last updated: 16 October 2026._

MRU Tab Switcher does not collect, transmit, sell or share any personal data or browsing data.

## What it stores, and where

- **The order you used your tabs in**, as a list of Chrome's numeric tab IDs. It's kept in `chrome.storage.session`, which lives in the browser's memory on your device and is cleared when the browser closes. It contains no URLs, page titles or page content.
- **Whether the extension is switched on, and your settings** (the pause length, Brave-style history on or off, and whether to cycle through one window or all), in `chrome.storage.local` on your device.

Nothing else is stored.

## What it does not do

- It doesn't read, change or inject anything into the pages you visit. It has no host permissions and no content scripts.
- It makes no network requests: no analytics, no tracking, no remote code.
- It doesn't use your browsing history, and it doesn't share data with anyone.

## Permissions

- `storage`: to keep the items above, and to keep them across the background service worker restarting.
- `contextMenus`: to add "Change keyboard shortcuts", "Set up Ctrl+Tab" and "Help" to the toolbar icon's right-click menu.

The extension also uses Chrome's `tabs`, `windows` and `commands` APIs to switch tabs when you press its shortcut. It doesn't request the `tabs` permission, so it can't see tab URLs or titles.

## Contact

Questions or concerns: open an issue at https://github.com/Hariprasad-b-s/mru-extension/issues.
