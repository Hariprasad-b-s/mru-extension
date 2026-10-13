# Privacy policy

_MRU tab switcher - Smooth like brave browser ("MRU Tab Switcher"). Last updated: 13 October 2026._

MRU Tab Switcher does not collect, transmit, sell or share any personal data or browsing data.

## What it stores, and where

- **The order you used your tabs in**, as a list of Chrome's numeric tab IDs. It's kept in `chrome.storage.session`, which lives in the browser's memory on your device and is cleared when the browser closes. It contains no URLs, page titles or page content.
- **Whether the extension is switched on**, as a single true/false value in `chrome.storage.local` on your device.

Nothing else is stored.

## The listener in web pages

To end a tab switch when you let go of Ctrl, the way Brave does, the extension runs a small listener (`content.js`) in each web page. Chrome describes this permission as "read and change all your data on all websites", because that's the broad access any page script gets. This listener uses very little of it:

- It does nothing until you're switching tabs with the extension's shortcut.
- While you are, it only notices when modifier keys (Ctrl, Alt, Cmd) are released or pressed and when the mouse is pressed. It doesn't record which other keys you press.
- When one of those happens, it sends the extension a single "stop cycling" signal. Nothing else is sent, and nothing it sees is stored.
- It never reads page content (text, forms, cookies or URLs) and never changes the page.

## What it does not do

- It doesn't read or change the content of the pages you visit.
- It makes no network requests: no analytics, no tracking, no remote code.
- It doesn't use your browsing history, and it doesn't share data with anyone.

## Permissions

- `storage`: to keep the two items above across the background service worker restarting.
- Access to all websites (`host_permissions` and the `content_scripts` entry): to run the listener described above.
- `scripting`: to add that listener to tabs that were already open when the extension was installed or updated, so they don't need reloading.

The extension also uses Chrome's `tabs`, `windows` and `commands` APIs to switch tabs when you press its shortcut. It doesn't request the `tabs` permission or read tab URLs or titles.

## Contact

Questions or concerns: open an issue at https://github.com/Hariprasad-b-s/mru-extension/issues.
