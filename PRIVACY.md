# Privacy policy

_MRU tab switcher - Smooth like brave browser ("MRU Tab Switcher"). Last updated: 17 October 2026._

MRU Tab Switcher does not collect, transmit, sell or share any personal data or browsing data.

## What it stores, and where

- **The order you used your tabs in**, as a list of Chrome's numeric tab IDs. It's kept in `chrome.storage.session`, which lives in the browser's memory on your device and is cleared when the browser closes. It contains no URLs, page titles or page content.
- **Whether the extension is switched on, and your settings** (the pause length, Brave-style history on or off, and whether to cycle through one window or all), in `chrome.storage.local` on your device.

Nothing else is stored.

## Optional: the listener in web pages

The setting *End the cycle when I let go of Ctrl* is off by default. Only if you turn it on does the extension ask Chrome for access to all websites (Chrome words this as "read and change all your data on all websites") and run a small listener, `content.js`, in web pages. That listener:

- does nothing until you're switching tabs with the extension's shortcut;
- while you are, only notices modifier keys (Ctrl, Alt, Cmd) being released or pressed and the mouse being pressed, and doesn't record which other keys you press;
- then sends the extension a single "stop cycling" signal; nothing else is sent and nothing it sees is stored;
- never reads page content (text, forms, cookies or URLs) and never changes the page.

Turning the setting off gives the site access back and stops the listener.

## What it does not do

- It doesn't read or change the content of the pages you visit. Without the optional setting above it has no access to them at all.
- It makes no network requests: no analytics, no tracking, no remote code.
- It doesn't use your browsing history, and it doesn't share data with anyone.

## Permissions

- `storage`: to keep the items above, and to keep them across the background service worker restarting.
- `contextMenus`: to add "Change keyboard shortcuts", "Set up Ctrl+Tab" and "Help" to the toolbar icon's right-click menu.
- `scripting`: to start and stop the optional listener above, and to add it to tabs that are already open when you turn it on.
- Access to all websites (`optional_host_permissions`): requested only when you turn on the optional setting above, to run its listener.

The extension also uses Chrome's `tabs`, `windows` and `commands` APIs to switch tabs when you press its shortcut. It doesn't request the `tabs` permission, so it can't see tab URLs or titles.

## Contact

Questions or concerns: open an issue at https://github.com/Hariprasad-b-s/mru-extension/issues.
