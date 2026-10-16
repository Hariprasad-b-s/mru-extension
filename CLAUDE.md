# MRU Tab Switcher — notes for Claude

Chrome extension (Manifest V3) that switches tabs in most-recently-used order, like Ctrl+Tab in Brave. Published on the Chrome Web Store as "MRU tab switcher - Smooth like brave browser" (item ID `ffkjkhogdepleegfoakgihhmcfekdnoa`). The README describes the features; this file is how to work on it.

## Rules from the owner

- After every change: commit, push the working branch, then fast-forward `main` to it (`git push origin HEAD:main`). Always merge to main; don't ask.
- Every package uploaded to the store needs a **higher** `"version"` in `manifest.json` than the last upload. Bump it with any user-facing change.
- Keep `README.md`, `PRIVACY.md` and `store/listing.md` in step with the behaviour; the store listing's privacy-policy URL points at `PRIVACY.md` on `main`.
- Updates must be smooth: every new feature is an opt-in setting, off by default. With it off, an updated install behaves exactly like the previous version, keeps its settings and shortcuts, and gets no new permission warning. `tests/update.mjs` checks this against the previous store version (`FROM_COMMIT`, default 1.1.0's `8e26dbb`); point it at the newest submitted version when one ships.
- No overlays or UI injected into pages. No access to web pages by default: the "let go of Ctrl" listener is opt-in (optional host permission), so installs and updates show no permission warning.
- Store field limits: manifest `description` ≤ 132 characters; store description ≤ 16,000; test instructions ≤ 500.

## Store versions

| Version | Commit | Status |
| --- | --- | --- |
| 1.0.2 | `9965b31` | Live (1.0.1 code, re-uploaded as 1.0.2) |
| 1.1.0 | `8e26dbb` | Submitted for review: settings/welcome page, reverse cycling, Brave-style history |
| 1.2.0 | latest `main` | Not submitted: 1.1.0 plus the optional "end the cycle when I let go of Ctrl" (off by default) |

(Git tags can't be pushed from the cloud sandbox, hence the commit IDs.)

## Files

- `background.js`: service worker. MRU stack (mirrored to `chrome.storage.session`), cycling, settings, ON/OFF badge and icon, toolbar menu, optional release detection.
- `content.js`: optional page listener that reports Ctrl being released during a cycle; registered with `chrome.scripting` only after the user grants `<all_urls>` on the settings page.
- `options.html` / `options.js`: settings page, also opened once after install as a welcome page.
- `scripts/set-ctrl-tab-shortcut.js`: code users paste into DevTools on `chrome://extensions/shortcuts` to bind Ctrl+Tab and Ctrl+Shift+Tab. Shown on the settings page too.
- `scripts/package.sh`: builds `dist/mru-tab-switcher-<version>.zip` for the store (strips the dev `"key"`). Add any new runtime file to it.
- `store/`: listing text (`listing.md`, all dashboard fields), screenshots, promo tile.
- `tests/`: Playwright suites; `./tests/run.sh` runs them all.

## Testing

`./tests/run.sh` (needs `xvfb-run` and `xdotool` on Linux; in the cloud sandbox Playwright is at `/opt/node-tools/node_modules/playwright`, picked up automatically). Most suites drive a real Chromium with real key presses under Xvfb. Run it before every push and say what passed.

## Chrome behaviour learned the hard way

- Extensions can't ship Tab shortcuts: a manifest `suggested_key` of Ctrl+Tab is silently dropped and the shortcuts page refuses Tab. `chrome.developerPrivate.updateExtensionCommand` on `chrome://extensions/shortcuts` accepts it.
- In that API "Ctrl" already means the Control key on macOS; "MacCtrl" exists only in the manifest and fails silently there (the old shortcut is cleared and no error is reported, so read the result back).
- The service worker is stopped after ~30 s idle, so in-memory state must be restored from `chrome.storage.session`.
- Extensions never learn about key releases; only a page script (content.js) can see Ctrl being let go. It can't run on `chrome://` pages, the New Tab page or the Web Store, so the pause fallback stays.
- Without the `tabs` permission, `tab.url` is unavailable even for the extension's own pages; use `chrome.runtime.getContexts`.
- In tests: the permission prompt has "Deny" focused (use Tab, Enter); `chrome.runtime.reload()` only works with Developer mode on; Playwright doesn't hand back a restarted service worker; `data:` pages don't get content scripts (serve pages over local HTTP to test release detection); the welcome tab opened on install must be closed first.
