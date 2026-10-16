# Chrome Web Store listing

Everything to fill in on the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), and how to publish.

## Before you submit: the name

The listing name comes from `"name"` in `manifest.json`: **MRU tab switcher - Smooth like brave browser**.

Brave is another company's trademark. The Web Store's policies on impersonation, intellectual property and keyword spam can lead reviewers to reject a listing whose name uses another product's name, even as a comparison. If it's rejected for that, change `"name"` to something like **MRU Tab Switcher – Smooth Ctrl+Tab**, rebuild, and upload again. Comparing to Brave in the description is less likely to be a problem.

## Publish, step by step

1. **Register as a developer.** Sign in at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the Google account that should own the listing, pay the one-time registration fee, and verify your contact email. On the **Account** page, also declare your trader status (required for EU users): publishing as an individual rather than a business means **non-trader**.
2. **Build the package.** In this repo, run `./scripts/package.sh`. It writes `dist/mru-tab-switcher-<version>.zip` containing only `manifest.json`, `background.js` and the icons, without the local development `"key"` (the store assigns its own ID).
3. **Upload it.** Dashboard → **New item** → upload the zip.
4. **Store listing tab:** paste the description below, pick the category and language, and upload the images listed below.
5. **Privacy tab:** fill it in from the answers below.
6. **Distribution tab:** Free, Public, all regions.
7. **Submit for review.** Reviews usually take from a few days to a couple of weeks. You'll get an email when it's published.
8. **After it's live:** link it from `README.md`. (Done: https://chromewebstore.google.com/detail/ffkjkhogdepleegfoakgihhmcfekdnoa)

**Updating later:** raise `"version"` in `manifest.json` (e.g. `1.0.1`), run `./scripts/package.sh` again, upload the new zip on the item's **Package** tab, and submit for review.

**Optional:** on the item's **Package** tab, "View public key" shows the store's key. Putting that in `"key"` in `manifest.json` (replacing the current one) gives your local unpacked copy the same ID as the store version. Nothing depends on this; the Ctrl+Tab script finds the extension either way.

## Store listing tab

**Description** (paste as is):

```
Switch tabs the way your brain works: Ctrl+Tab takes you back to the tab you were just using, not the next one to the right. It's the smooth, most-recently-used (MRU) tab switching that Brave and Firefox users love, now in Chrome.

Writing an email while checking a document? One tap flips between them, no hunting through the tab bar.

✦ HOW IT WORKS
• Tap once: jump to your previous tab. Tap again later: jump back. Perfect for flipping between two tabs.
• Tap repeatedly: keep going further back through your recent tabs, 2nd, 3rd, 4th most recent and so on. Pause and you stay where you landed.
• Ctrl+Shift+Tab goes the other way through the same list. Pressed on its own, it jumps straight to the tab you've used least recently.
• Brave-style history: every tab you land on while cycling counts as recently used, just like in Brave.
• Stays in your window, or cycles through all windows if you prefer.
• One click on the toolbar icon turns it on or off. The badge shows ON or OFF and the icon goes gray when it's off. While it's off, Ctrl+Tab and Ctrl+Shift+Tab work like Chrome's normal next/previous tab.

✦ MAKE IT YOURS
A simple settings page (right-click the toolbar icon → Options) lets you:
• set the pause that ends a cycle, from 0.3 to 1.5 seconds, to match how fast you tap;
• turn Brave-style history on or off;
• choose between cycling the current window or all windows.

✦ SHORTCUTS
Out of the box: Alt+Y, and Alt+Shift+Y for reverse (Control+Y and Control+Shift+Y on macOS). You can change them any time at chrome://extensions/shortcuts.

Want Ctrl+Tab and Ctrl+Shift+Tab? Chrome doesn't let extensions take those keys by themselves, but the welcome page walks you through it in under a minute: copy the setup code with one click and paste it on Chrome's shortcuts page, the same method QuicKey users rely on. You can reopen it any time from the toolbar icon's right-click menu (Set up Ctrl+Tab).

✦ PRIVATE BY DESIGN
• Nothing on screen while you work: no overlays or popups. It works quietly in the background.
• No access to the pages you visit: no content scripts and no host permissions.
• No network requests, no analytics, no tracking. Your settings and recent-tab order stay on your device.

✦ GOOD TO KNOW
• Chrome doesn't tell extensions when you release Ctrl, so a short pause ends a cycle instead. You choose how long in the settings.
• With Ctrl+Tab taken over, Chrome's own next/previous tab is still on Ctrl+PgDn / Ctrl+PgUp (Cmd+Option+→ / ← on macOS).

Free and open source: https://github.com/Hariprasad-b-s/mru-extension
Questions or ideas? https://github.com/Hariprasad-b-s/mru-extension/issues
```

**Category:** Productivity → Tools (or Workflow & Planning)

**Language:** English

**Graphic assets:**

| Field | File |
| --- | --- |
| Store icon (128×128) | `icons/icon-128.png` |
| Screenshot (1280×800) | `store/screenshot-1280x800.png` |
| Second screenshot (1280×800) | `store/screenshot-settings-1280x800.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |

**Additional fields:**

| Field | Value |
| --- | --- |
| Official URL | None (it needs a site verified in Google Search Console) |
| Homepage URL | https://github.com/Hariprasad-b-s/mru-extension |
| Support URL | https://github.com/Hariprasad-b-s/mru-extension/issues |
| Mature content | Off |

## Test instructions (Access section)

Reviewers read this to know how to try the extension. The field takes at most 500 characters; this is 438:

```
No login needed. Open 5 tabs; click tab 1, 3, then 5.
1. Alt+Y (Mac: Control+Y): goes to tab 3, the last-used tab.
2. Wait 1 s, Alt+Y: back to tab 5.
3. Alt+Y twice quickly: tab 3, then tab 1.
4. Alt+Shift+Y: reverse order (least recently used tab).
5. Only switches within the current window.
6. Click toolbar icon: badge ON/OFF, shortcuts stop when OFF.
7. Right-click icon > Options: pause length, Brave-style history, one/all windows.
```

## Privacy tab

**Single purpose description:**

```
Switch between browser tabs in most-recently-used order with a keyboard shortcut.
```

**Permission justification, `storage`:**

```
Saves whether the extension is switched on, the user's settings (pause length, Brave-style history, one window or all), and the order the user recently used their tabs in (as numeric tab IDs only), so they survive the background service worker being restarted. Nothing is sent anywhere.
```

**Permission justification, `contextMenus`:**

```
Adds three items to the extension's own toolbar icon menu: "Change keyboard shortcuts" (opens chrome://extensions/shortcuts), "Set up Ctrl+Tab" (opens the extension's settings page) and "Help" (opens the project's README). No menus are added to web pages.
```

**Host permissions:** none requested.

**Remote code:** No, I am not using remote code.

**Data usage:** tick none of the data types (it collects none), then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/Hariprasad-b-s/mru-extension/blob/main/PRIVACY.md
